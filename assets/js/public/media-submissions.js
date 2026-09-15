(() => {
  'use strict';

  const elements = {
    panel: document.getElementById('mediaPanel'),
    close: document.getElementById('mediaClose'),
    triggers: [...document.querySelectorAll('.media-trigger')],
    locked: document.getElementById('mediaLocked'),
    workspace: document.getElementById('mediaWorkspace'),
    loginButton: document.getElementById('mediaLoginButton'),
    tabs: [...document.querySelectorAll('[data-media-tab]')],
    views: [...document.querySelectorAll('[data-media-view]')],
    notice: document.getElementById('mediaNotice'),
    form: document.getElementById('mediaForm'),
    dropzone: document.getElementById('mediaDropzone'),
    fileInput: document.getElementById('mediaFileInput'),
    selected: document.getElementById('mediaSelected'),
    title: document.getElementById('mediaSubmissionTitle'),
    comment: document.getElementById('mediaSubmissionComment'),
    submitButton: document.getElementById('mediaSubmitButton'),
    submitHint: document.getElementById('mediaSubmitHint'),
    refreshButton: document.getElementById('mediaRefreshButton'),
    publicList: document.getElementById('mediaQueue'),
    adminPanel: document.getElementById('adminMediaPanel'),
    adminRefresh: document.getElementById('adminMediaRefresh'),
    adminList: document.getElementById('adminMediaList'),
    adminTypeTabs: [...document.querySelectorAll('[data-admin-media-type]')],
    adminStatusTabs: [...document.querySelectorAll('[data-admin-media-status]')],
    adminVideoCount: document.getElementById('adminMediaVideoCount'),
    adminPhotoCount: document.getElementById('adminMediaPhotoCount'),
    adminPendingCount: document.getElementById('adminMediaPendingCount'),
    adminDownloadedCount: document.getElementById('adminMediaDownloadedCount')
  };

  if (!elements.panel) return;

  const BUCKET = 'stream-submissions';
  const MAX_FILES = 8;
  const MAX_FILE_SIZE = 100 * 1024 * 1024;
  const ALLOWED_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]);
  const ALLOWED_EXTENSIONS = /\.(?:jpe?g|png|webp|gif|mp4|webm|mov)$/i;

  const state = {
    client: null,
    session: null,
    isAdmin: false,
    selectedFiles: [],
    selectedMosaicExpanded: false,
    replacingId: null,
    currentTab: 'upload',
    published: [],
    adminItems: [],
    adminStatus: 'pending',
    adminFormats: [],
    adminCategories: [],
    noticeTimer: null,
    lastFocused: null,
    started: false,
    eventsBound: false,
    submitting: false,
    previewIndex: -1,
    previewItems: [],
    previewAuthor: '',
    previewDetails: null,
    previewExpanded: false,
    previewMediaWidth: 47,
    previewResizePointerId: null,
    previewLastFocused: null,
    localMode: window.location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(window.location.hostname)
  };

  const LOCAL_MEDIA_KEY = 'cr7-local-media-submissions-v2';
  const LOCAL_MEDIA_DB = 'cr7-local-media-files-v1';
  const LOCAL_MEDIA_STORE = 'files';

  function readLocalMediaItems() {
    try {
      const value = JSON.parse(window.localStorage.getItem(LOCAL_MEDIA_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function writeLocalMediaItems(items) {
    try {
      window.localStorage.setItem(LOCAL_MEDIA_KEY, JSON.stringify(Array.isArray(items) ? items : []));
    } catch (error) {
      console.warn('Не удалось сохранить локальную очередь медиа:', error);
    }
  }

  function localAdminUser() {
    return {
      id: 'local-admin',
      email: 'local@preview',
      is_anonymous: false,
      user_metadata: { name: 'Local Preview' }
    };
  }

  function openLocalMediaDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB недоступен в этом браузере.'));
        return;
      }
      const request = window.indexedDB.open(LOCAL_MEDIA_DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(LOCAL_MEDIA_STORE)) db.createObjectStore(LOCAL_MEDIA_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Не удалось открыть локальное хранилище.'));
    });
  }

  async function localDbPut(key, value) {
    const db = await openLocalMediaDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LOCAL_MEDIA_STORE, 'readwrite');
      tx.objectStore(LOCAL_MEDIA_STORE).put(value, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { const error = tx.error; db.close(); reject(error); };
    });
  }

  async function localDbGet(key) {
    const db = await openLocalMediaDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LOCAL_MEDIA_STORE, 'readonly');
      const request = tx.objectStore(LOCAL_MEDIA_STORE).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  }

  async function localDbDelete(key) {
    const db = await openLocalMediaDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LOCAL_MEDIA_STORE, 'readwrite');
      tx.objectStore(LOCAL_MEDIA_STORE).delete(key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { const error = tx.error; db.close(); reject(error); };
    });
  }

  async function hydrateLocalMediaItems(items) {
    const hydrated = [];
    for (const item of Array.isArray(items) ? items : []) {
      const copy = { ...item, media_submission_files: [] };
      for (const file of Array.isArray(item.media_submission_files) ? item.media_submission_files : []) {
        const hydratedFile = { ...file };
        if (file.local_blob_key) {
          try {
            const blob = await localDbGet(file.local_blob_key);
            if (blob) hydratedFile.signed_url = URL.createObjectURL(blob);
          } catch (error) {
            console.warn('Не удалось восстановить локальный файл:', error);
          }
        }
        copy.media_submission_files.push(hydratedFile);
      }
      hydrated.push(copy);
    }
    return hydrated;
  }

  function configuredClient() {
    const config = window.CR7_CONFIG || {};
    const url = String(config.supabaseUrl || '');
    const key = String(config.supabasePublishableKey || '');
    if (!window.supabase?.createClient || !url.startsWith('https://') || !key) return null;
    if (window.CR7_SUPABASE_CLIENT) return window.CR7_SUPABASE_CLIENT;
    window.CR7_SUPABASE_CLIENT = window.supabase.createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    return window.CR7_SUPABASE_CLIENT;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    })[character]);
  }

  function errorMessage(error, fallback = 'Не удалось выполнить действие.') {
    const message = String(error?.message || error?.error_description || fallback);
    if (/media_submissions|media_submission_files|schema cache|PGRST205|42P01/i.test(message)) {
      return 'Медиапредложка ещё не подключена. Выполни supabase/media_submissions.sql в Supabase.';
    }
    if (/bucket.*not found|stream-submissions/i.test(message)) {
      return 'Хранилище файлов ещё не настроено. Выполни supabase/media_submissions.sql.';
    }
    if (/row-level security|permission denied|site_admin/i.test(message)) {
      return 'Это действие доступно только администратору.';
    }
    if (/payload too large|maximum allowed size|exceeded.*size/i.test(message)) {
      return 'Файл превышает разрешённый размер хранилища.';
    }
    return message;
  }

  function showNotice(message, type = 'info') {
    clearTimeout(state.noticeTimer);
    elements.notice.textContent = message;
    elements.notice.className = `media-notice show ${type}`;
    state.noticeTimer = window.setTimeout(() => {
      elements.notice.className = 'media-notice';
    }, 5500);
  }

  function setBusy(button, busy, busyText = 'Подождите…') {
    if (!button) return;
    if (!button.dataset.defaultText) button.dataset.defaultText = button.textContent;
    if (!button.dataset.defaultHtml) button.dataset.defaultHtml = button.innerHTML;
    button.disabled = busy;
    if (busy) button.textContent = busyText;
    else button.innerHTML = button.dataset.defaultHtml;
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} КБ`;
    return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} МБ`;
  }

  function formatDate(value) {
    try {
      return new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(new Date(value));
    } catch {
      return '—';
    }
  }

  function formatAdminDate(value) {
    try {
      return new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(new Date(value)).replace(',', ' ·');
    } catch {
      return '—';
    }
  }

  function formatPreviewTimestamp(value) {
    try {
      const date = new Date(value);
      const now = new Date();
      const sameDay = date.getFullYear() === now.getFullYear()
        && date.getMonth() === now.getMonth()
        && date.getDate() === now.getDate();
      const time = new Intl.DateTimeFormat('ru-RU', {
        hour: '2-digit',
        minute: '2-digit'
      }).format(date);
      if (sameDay) return `сегодня в ${time}`;
      const day = new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      }).format(date);
      return `${day} в ${time}`;
    } catch {
      return 'время не указано';
    }
  }

  function statusLabel(status) {
    return ({
      pending: 'На рассмотрении',
      published: 'Опубликовано',
      archived: 'В архиве'
    })[status] || 'Неизвестно';
  }

  const ADMIN_MEDIA_DOWNLOADED_KEY = 'cr7-admin-media-downloaded-v1';
  const ADMIN_MEDIA_META_KEY = 'cr7-admin-media-meta-v1';
  const MEDIA_CATEGORY_LABELS = {
    personal: 'Личное',
    creative: 'Творчество',
    internet: 'Интернет'
  };

  function readLocalJson(key, fallback) {
    try {
      const value = JSON.parse(window.localStorage.getItem(key) || 'null');
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function writeLocalJson(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function downloadedIds() {
    const raw = readLocalJson(ADMIN_MEDIA_DOWNLOADED_KEY, []);
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  }

  function setDownloaded(id, downloaded = true) {
    const values = downloadedIds();
    const key = String(id);
    if (downloaded) values.add(key);
    else values.delete(key);
    writeLocalJson(ADMIN_MEDIA_DOWNLOADED_KEY, [...values]);
  }

  function localMediaMeta() {
    const raw = readLocalJson(ADMIN_MEDIA_META_KEY, {});
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  }

  function rememberMediaMeta(id, meta = {}) {
    if (!id) return;
    const all = localMediaMeta();
    all[String(id)] = { ...(all[String(id)] || {}), ...meta };
    writeLocalJson(ADMIN_MEDIA_META_KEY, all);
  }

  function userDisplayName(user) {
    const metadata = user?.user_metadata || {};
    return String(
      metadata.full_name
      || metadata.name
      || metadata.display_name
      || metadata.preferred_username
      || user?.email?.split('@')[0]
      || 'Не указан'
    ).trim();
  }

  function itemCategory(item) {
    const saved = localMediaMeta()[String(item?.id)]?.category;
    const value = String(item?.category || saved || 'personal');
    return MEDIA_CATEGORY_LABELS[value] ? value : 'personal';
  }

  function itemAuthor(item) {
    const persisted = String(item?.author_name || '').trim();
    if (persisted) return persisted;
    const saved = localMediaMeta()[String(item?.id)]?.authorName;
    if (saved) return String(saved);
    if (item?.created_by && item.created_by === state.session?.user?.id) {
      return userDisplayName(state.session.user);
    }
    return 'Не указан';
  }

  async function attachAdminAuthorNames(items) {
    if (state.localMode || !state.client || !Array.isArray(items) || !items.length) return items;
    const { data, error } = await state.client.rpc('get_media_submission_authors');
    if (error) {
      console.warn('Не удалось загрузить имена авторов медиазаявок:', error?.message || error);
      return items;
    }
    const names = new Map((Array.isArray(data) ? data : []).map(row => [
      String(row.submission_id || ''),
      String(row.display_name || '').trim()
    ]));
    return items.map(item => ({
      ...item,
      author_name: names.get(String(item.id)) || ''
    }));
  }

  function mediaKindIcon(type) {
    const video = type === 'video';
    return `
      <span class="admin-media-kind-badge" aria-hidden="true">
        ${video
          ? '<svg viewBox="0 0 24 24"><rect x="4" y="3.5" width="16" height="17" rx="4"></rect><path d="m10 8 6 4-6 4Z"></path></svg>'
          : '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="4"></rect><circle cx="9" cy="9" r="2"></circle><path d="m6.5 17 4-4 2.5 2.5 2-2 2.5 3.5"></path></svg>'}
      </span>`;
  }

  function isVideo(fileOrMime) {
    const mime = typeof fileOrMime === 'string'
      ? fileOrMime
      : fileOrMime?.type || fileOrMime?.mime_type;
    const name = typeof fileOrMime === 'string'
      ? ''
      : fileOrMime?.name || fileOrMime?.file_name;
    return String(mime || '').startsWith('video/') || /\.(?:mp4|webm|mov)$/i.test(String(name || ''));
  }

  function isAllowedFile(file) {
    return ALLOWED_MIME_TYPES.has(file.type) || (!file.type && ALLOWED_EXTENSIONS.test(file.name));
  }

  function uniqueId() {
    return window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function safeFileName(value) {
    const normalized = String(value || 'file')
      .normalize('NFKD')
      .replace(/[^\w.-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(-100);
    return normalized || 'file';
  }

  async function usableSession() {
    if (!state.client) return { data: { session: null }, error: null };
    if (window.CR7_AUTH?.getUsableSession) {
      return window.CR7_AUTH.getUsableSession(state.client);
    }
    return state.client.auth.getSession();
  }

  function renderAccess() {
    elements.locked.hidden = true;
    elements.form.hidden = false;
    updateSelectedFiles();
    if (elements.adminPanel) {
      elements.adminPanel.classList.toggle('is-disabled', !state.isAdmin);
      if (!state.isAdmin && elements.adminList) {
        elements.adminList.innerHTML = '<div class="media-empty">Войди как администратор, чтобы открыть очередь.</div>';
      }
    }
  }

  async function refreshAccess({ loadAdmin = true } = {}) {
    state.session = null;
    state.isAdmin = false;

    if (state.localMode) {
      state.session = { user: localAdminUser() };
      state.isAdmin = true;
      renderAccess();
      if (loadAdmin) loadAdminQueue();
      return true;
    }

    if (!state.client) {
      renderAccess();
      return false;
    }

    try {
      const sessionResult = await usableSession();
      if (sessionResult.error) throw sessionResult.error;
      const session = sessionResult.data?.session || null;
      const user = session?.user;
      state.session = session;
      if (user && !user.is_anonymous) {
        const { data, error } = await state.client.rpc('is_site_admin');
        if (error) throw error;
        state.isAdmin = data === true;
      }
    } catch (error) {
      console.error('Не удалось проверить права медиапредложки:', error);
    }

    renderAccess();
    if (state.isAdmin && loadAdmin) loadAdminQueue();
    return state.isAdmin;
  }

  async function requireAdmin() {
    if (state.localMode) {
      state.session = state.session || { user: localAdminUser() };
      state.isAdmin = true;
      return state.session.user;
    }
    const hasAccess = state.isAdmin || await refreshAccess({ loadAdmin: false });
    const user = state.session?.user;
    if (!state.client) throw new Error('Supabase не настроен.');
    if (!hasAccess || !user || user.is_anonymous) {
      throw new Error('Это действие доступно только администратору.');
    }
    return user;
  }

  function setTab(name) {
    const target = name === 'published' ? 'published' : 'upload';
    state.currentTab = target;
    elements.tabs.forEach(button => {
      const active = button.dataset.mediaTab === target;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    elements.views.forEach(view => {
      const active = view.dataset.mediaView === target;
      view.classList.toggle('active', active);
      view.hidden = !active;
    });
    if (target === 'published') loadPublished();
  }

  function fitProposalToGameModal() {
    if (!elements.panel) return;
    if (window.matchMedia('(max-width: 720px)').matches) {
      elements.panel.style.removeProperty('--media-proposal-scale');
      elements.panel.style.removeProperty('--media-proposal-top');
      elements.panel.style.removeProperty('--media-proposal-scroll-height');
      return;
    }

    // Keep the proposal frame identical to the catalog game frame.
    const rootSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 1;
    const frameWidth = 850 * rootSize;
    const frameHeight = 1338 * rootSize;
    const visibleFrameHeight = 970 * rootSize;
    const edgeGap = 40 * rootSize;
    const scale = Math.min(
      1,
      Math.max(0.1, (window.innerWidth - edgeGap) / frameWidth),
      Math.max(0.1, (window.innerHeight - edgeGap) / visibleFrameHeight)
    );
    const top = Math.max(20 * rootSize, Math.min(40 * rootSize, window.innerHeight * 0.05));
    const bottomGap = 20 * rootSize;
    const availableHeight = Math.max(320 * rootSize, window.innerHeight - top - bottomGap);
    const scrollHeight = Math.min(frameHeight, availableHeight / scale);

    elements.panel.style.setProperty('--media-proposal-scale', scale.toFixed(5));
    elements.panel.style.setProperty('--media-proposal-top', `${top.toFixed(2)}px`);
    elements.panel.style.setProperty('--media-proposal-scroll-height', `${scrollHeight.toFixed(2)}px`);
  }

  async function openPanel() {
    state.lastFocused = document.activeElement;
    elements.panel.hidden = false;
    elements.panel.setAttribute('aria-hidden', 'false');
    elements.triggers.forEach(trigger => trigger.setAttribute('aria-expanded', 'true'));
    document.documentElement.classList.add('media-open');
    fitProposalToGameModal();
    await refreshAccess({ loadAdmin: false });
    window.setTimeout(() => {
      const focusTarget = state.currentTab === 'published'
        ? elements.refreshButton
        : state.isAdmin ? elements.dropzone : document.getElementById('siteAuthOpen');
      focusTarget?.focus();
    }, 30);
  }

  function closePanel() {
    closeFilePreview({ restoreFocus: false });
    elements.panel.hidden = true;
    elements.panel.setAttribute('aria-hidden', 'true');
    elements.triggers.forEach(trigger => trigger.setAttribute('aria-expanded', 'false'));
    document.documentElement.classList.remove('media-open');
    state.lastFocused?.focus?.();
  }

  function fileKey(file) {
    return `${file.name}:${file.size}:${file.lastModified}`;
  }

  function validateFile(file) {
    if (!file) return 'Файл не выбран.';
    if (!isAllowedFile(file)) return `Формат «${file.name}» не поддерживается.`;
    if (file.size > MAX_FILE_SIZE) return `«${file.name}» больше 100 МБ.`;
    return '';
  }

  function addFiles(fileList) {
    if (!state.isAdmin) {
      showNotice('Загружать материалы может только администратор.', 'error');
      return;
    }
    const incoming = [...(fileList || [])];
    const existingKeys = new Set(state.selectedFiles.map(item => item.key));
    const errors = [];
    incoming.forEach(file => {
      if (state.selectedFiles.length >= MAX_FILES) {
        errors.push(`За одну отправку можно выбрать не более ${MAX_FILES} файлов.`);
        return;
      }
      const error = validateFile(file);
      if (error) {
        errors.push(error);
        return;
      }
      const key = fileKey(file);
      if (existingKeys.has(key)) return;
      state.selectedFiles.push({
        id: uniqueId(),
        key,
        file,
        previewUrl: URL.createObjectURL(file)
      });
      existingKeys.add(key);
    });
    elements.fileInput.value = '';
    state.selectedMosaicExpanded = false;
    if (!elements.title.value.trim() && state.selectedFiles[0]?.file?.name) {
      elements.title.value = state.selectedFiles[0].file.name.replace(/\.[^.]+$/, '').slice(0, 120);
    }
    updateSelectedFiles();
    if (errors.length) showNotice([...new Set(errors)].join(' '), 'error');
  }

  function replaceFile(id, file) {
    const index = state.selectedFiles.findIndex(item => item.id === id);
    if (index < 0 || !file) return;
    const error = validateFile(file);
    if (error) {
      showNotice(error, 'error');
      return;
    }
    const key = fileKey(file);
    if (state.selectedFiles.some((item, itemIndex) => itemIndex !== index && item.key === key)) {
      showNotice('Этот файл уже выбран.', 'error');
      return;
    }
    URL.revokeObjectURL(state.selectedFiles[index].previewUrl);
    state.selectedFiles[index] = {
      id,
      key,
      file,
      previewUrl: URL.createObjectURL(file)
    };
    updateSelectedFiles();
  }

  function removeFile(id) {
    const index = state.selectedFiles.findIndex(item => item.id === id);
    if (index < 0) return;
    URL.revokeObjectURL(state.selectedFiles[index].previewUrl);
    state.selectedFiles.splice(index, 1);
    if (state.selectedFiles.length <= 4) state.selectedMosaicExpanded = false;
    updateSelectedFiles();
  }

  function clearSelectedFiles() {
    closeFilePreview({ restoreFocus: false });
    state.selectedFiles.forEach(item => URL.revokeObjectURL(item.previewUrl));
    state.selectedFiles = [];
    state.selectedMosaicExpanded = false;
    state.replacingId = null;
    elements.fileInput.value = '';
    updateSelectedFiles();
  }

  function updateSelectedFiles() {
    const count = state.selectedFiles.length;
    const hasTitle = elements.title.value.trim().length > 0;
    elements.selected.hidden = count === 0;
    elements.dropzone.classList.toggle('has-file', count > 0);
    elements.submitButton.disabled = state.submitting || !state.isAdmin || count === 0 || !hasTitle;
    elements.submitHint.textContent = count === 0
      ? 'Сначала выбери файлы и добавь название.'
      : !hasTitle
        ? `${count} ${count === 1 ? 'файл выбран' : count < 5 ? 'файла выбраны' : 'файлов выбраны'}. Осталось добавить название.`
        : `${count} ${count === 1 ? 'файл готов' : count < 5 ? 'файла готовы' : 'файлов готовы'} к отправке.`;

    if (!count) {
      elements.selected.className = 'media-selected';
      elements.selected.removeAttribute('data-selected-count');
      elements.selected.innerHTML = '';
      return;
    }

    const layoutClass = count === 1 ? 'is-single' : count === 2 ? 'is-double' : 'is-grid';
    const isCollapsedOverflow = count > 4 && !state.selectedMosaicExpanded;
    elements.selected.className = `media-selected ${layoutClass}${state.selectedMosaicExpanded ? ' is-expanded' : ''}`;
    elements.selected.dataset.selectedCount = String(count);

    const fileTiles = state.selectedFiles.map((selected, index) => {
      const file = selected.file;
      const hidden = isCollapsedOverflow && index >= 3 ? ' hidden' : '';
      const preview = isVideo(file)
        ? `<video aria-hidden="true" muted playsinline preload="metadata" src="${escapeHtml(selected.previewUrl)}"></video>`
        : `<img alt="${escapeHtml(file.name)}" src="${escapeHtml(selected.previewUrl)}">`;
      return `
        <article class="media-selected-item"${hidden}>
          <button class="media-selected-preview media-selected-preview-open" data-media-preview="${escapeHtml(selected.id)}" data-media-preview-kind="${isVideo(file) ? 'video' : 'image'}" data-media-preview-name="${escapeHtml(file.name)}" data-media-preview-size="${Number(file.size) || 0}" data-media-preview-url="${escapeHtml(selected.previewUrl)}" type="button" aria-label="Открыть ${isVideo(file) ? 'видео' : 'изображение'} «${escapeHtml(file.name)}» целиком">
            ${preview}
          </button>
          <div class="media-selected-copy">
            <strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong>
            <small>${isVideo(file) ? 'Видео' : 'Фото'} · ${escapeHtml(formatBytes(file.size))}</small>
          </div>
          <div class="media-selected-actions">
            <button data-media-replace="${escapeHtml(selected.id)}" type="button">Заменить</button>
            <button class="danger" data-media-remove="${escapeHtml(selected.id)}" type="button" aria-label="Удалить файл «${escapeHtml(file.name)}»">Удалить</button>
          </div>
        </article>
      `;
    }).join('');

    const emptyTile = count === 3
      ? '<div class="media-selected-empty" aria-hidden="true"></div>'
      : '';
    const moreTile = isCollapsedOverflow
      ? `<button class="media-selected-more" data-media-show-all type="button" aria-label="Показать остальные ${count - 3} ${count - 3 === 1 ? 'файл' : 'файла'}"><span>+${count - 3}</span><small>Показать все</small></button>`
      : '';
    const collapseButton = state.selectedMosaicExpanded && count > 4
      ? '<button class="media-selected-collapse" data-media-collapse type="button">Свернуть подборку</button>'
      : '';

    elements.selected.innerHTML = `${fileTiles}${emptyTile}${moreTile}${collapseButton}`;
  }

  function ensureFilePreview() {
    let viewer = document.getElementById('mediaFilePreview');
    if (viewer) return viewer;

    viewer = document.createElement('div');
    viewer.id = 'mediaFilePreview';
    viewer.className = 'media-file-preview';
    viewer.hidden = true;
    viewer.setAttribute('aria-hidden', 'true');
    viewer.innerHTML = `
      <div class="media-file-preview-backdrop" data-media-preview-close></div>
      <section class="media-file-preview-dialog" role="dialog" aria-modal="true" aria-label="Предпросмотр файлов" tabindex="-1">
        <div class="media-file-preview-stage" id="mediaFilePreviewStage"></div>
        <button class="media-file-preview-nav is-prev" data-media-preview-nav="-1" type="button" aria-label="Предыдущий файл">‹</button>
        <button class="media-file-preview-nav is-next" data-media-preview-nav="1" type="button" aria-label="Следующий файл">›</button>
        <div class="media-file-preview-resizer" data-media-preview-resizer role="separator" aria-label="Изменить ширину области предпросмотра" aria-orientation="vertical" aria-valuemin="30" aria-valuemax="70" aria-valuenow="47" tabindex="0"></div>
        <aside class="media-file-preview-details" id="mediaFilePreviewDetails" hidden>
          <div class="media-file-preview-detail is-author">
            <span>Автор</span>
            <strong id="mediaFilePreviewDetailAuthor"></strong>
          </div>
          <div class="media-file-preview-detail-row">
            <div class="media-file-preview-detail">
              <span>Дата</span>
              <strong id="mediaFilePreviewDetailDate"></strong>
            </div>
            <div class="media-file-preview-detail">
              <span>Категория</span>
              <strong id="mediaFilePreviewDetailCategory"></strong>
            </div>
          </div>
          <div class="media-file-preview-detail is-comment">
            <span>Комментарий</span>
            <div class="media-file-preview-comment" id="mediaFilePreviewDetailComment"></div>
          </div>
          <div class="media-file-preview-admin-actions" id="mediaFilePreviewAdminActions" hidden>
            <button class="media-file-preview-admin-download" data-media-preview-admin-action="download" type="button">
              <span>Скачать</span>
              <img src="./assets/images/figma/arrow-circle-white.svg" alt="" aria-hidden="true">
            </button>
            <button class="media-file-preview-admin-delete" data-media-preview-admin-action="delete" aria-label="Удалить материал" type="button">X</button>
          </div>
        </aside>
        <div class="media-file-preview-expanded-footer" id="mediaFilePreviewExpandedFooter" hidden>
          <div class="media-file-preview-expanded-caption" id="mediaFilePreviewExpandedCaption" hidden></div>
          <div class="media-file-preview-expanded-meta">
            <span id="mediaFilePreviewExpandedCounter"></span>
            <span><strong id="mediaFilePreviewExpandedAuthor"></strong><i aria-hidden="true">•</i><time id="mediaFilePreviewExpandedTime"></time></span>
          </div>
        </div>
        <footer class="media-file-preview-footer">
          <span class="media-file-preview-counter" id="mediaFilePreviewCounter"></span>
          <strong class="media-file-preview-author" id="mediaFilePreviewAuthor"></strong>
        </footer>
      </section>`;
    document.body.appendChild(viewer);

    viewer.addEventListener('click', async event => {
      if (event.target.closest('[data-media-preview-close]')) {
        closeFilePreview();
        return;
      }
      if (event.target === viewer.querySelector('#mediaFilePreviewStage')) {
        closeFilePreview();
        return;
      }
      const navigation = event.target.closest('[data-media-preview-nav]');
      if (navigation) {
        moveFilePreview(Number(navigation.dataset.mediaPreviewNav) || 0);
        return;
      }
      const previewMedia = event.target.closest('#mediaFilePreviewStage img, #mediaFilePreviewStage video');
      if (state.previewDetails && previewMedia && (!previewMedia.matches('video') || !state.previewExpanded)) {
        setAdminPreviewExpanded(!state.previewExpanded);
        return;
      }
      const adminAction = event.target.closest('[data-media-preview-admin-action][data-admin-media-id]');
      if (!adminAction) return;
      const { mediaPreviewAdminAction: action, adminMediaId: id } = adminAction.dataset;
      if (action === 'download') await downloadSubmission(id, adminAction);
      if (action === 'delete') {
        await deleteSubmission(id, adminAction);
        if (!state.adminItems.some(item => String(item.id) === String(id))) {
          closeFilePreview({ restoreFocus: false });
        }
      }
    });

    const resizeHandle = viewer.querySelector('[data-media-preview-resizer]');
    resizeHandle.addEventListener('pointerdown', event => {
      if (!state.previewDetails || state.previewExpanded) return;
      state.previewResizePointerId = event.pointerId;
      resizeHandle.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    resizeHandle.addEventListener('pointermove', event => {
      if (state.previewResizePointerId !== event.pointerId) return;
      const dialog = viewer.querySelector('.media-file-preview-dialog');
      const bounds = dialog.getBoundingClientRect();
      if (!bounds.width) return;
      setPreviewMediaWidth(((event.clientX - bounds.left) / bounds.width) * 100);
    });
    const stopResize = event => {
      if (state.previewResizePointerId !== event.pointerId) return;
      resizeHandle.releasePointerCapture?.(event.pointerId);
      state.previewResizePointerId = null;
    };
    resizeHandle.addEventListener('pointerup', stopResize);
    resizeHandle.addEventListener('pointercancel', stopResize);
    resizeHandle.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      setPreviewMediaWidth(state.previewMediaWidth + (event.key === 'ArrowLeft' ? -2 : 2));
    });
    return viewer;
  }

  function selectedPreviewItems() {
    if (state.selectedFiles.length) return state.selectedFiles;
    return [...elements.selected.querySelectorAll('[data-media-preview]')].map(button => ({
      id: button.dataset.mediaPreview,
      previewUrl: button.dataset.mediaPreviewUrl || button.querySelector('img,video')?.src || '',
      file: {
        name: button.dataset.mediaPreviewName || 'Файл',
        size: Number(button.dataset.mediaPreviewSize) || 0,
        type: button.dataset.mediaPreviewKind === 'video' ? 'video/unknown' : 'image/unknown'
      }
    })).filter(item => item.previewUrl);
  }

  function renderFilePreview() {
    const viewer = ensureFilePreview();
    const count = state.previewItems.length;
    if (!count || state.previewIndex < 0) {
      closeFilePreview();
      return;
    }

    state.previewIndex = (state.previewIndex + count) % count;
    const selected = state.previewItems[state.previewIndex];
    const file = selected.file;
    const video = isVideo(file);
    const stage = viewer.querySelector('#mediaFilePreviewStage');
    stage.innerHTML = video
      ? `<video controls playsinline preload="metadata" src="${escapeHtml(selected.previewUrl)}"><p>Это видео не поддерживается браузером. Открой оригинал по ссылке ниже.</p></video>`
      : `<img alt="${escapeHtml(file.name)}" src="${escapeHtml(selected.previewUrl)}">`;
    viewer.querySelector('#mediaFilePreviewCounter').textContent = `Файл ${state.previewIndex + 1} из ${count}`;
    viewer.querySelector('#mediaFilePreviewAuthor').textContent = `Предполагаемый автор · ${state.previewAuthor || 'Не указан'}`;
    const details = state.previewDetails;
    const detailsPanel = viewer.querySelector('#mediaFilePreviewDetails');
    const adminActions = viewer.querySelector('#mediaFilePreviewAdminActions');
    const resizeHandle = viewer.querySelector('[data-media-preview-resizer]');
    const expandedFooter = viewer.querySelector('#mediaFilePreviewExpandedFooter');
    viewer.querySelector('.media-file-preview-dialog')?.style.setProperty('--admin-preview-media-width', `${state.previewMediaWidth}%`);
    resizeHandle.setAttribute('aria-valuenow', String(Math.round(state.previewMediaWidth)));
    viewer.classList.toggle('is-admin-preview', Boolean(details));
    viewer.classList.toggle('is-admin-expanded', Boolean(details && state.previewExpanded));
    detailsPanel.hidden = !details;
    adminActions.hidden = !details;
    resizeHandle.hidden = !details;
    expandedFooter.hidden = !(details && state.previewExpanded);
    viewer.querySelector('.media-file-preview-footer').hidden = Boolean(details);
    if (details) {
      viewer.querySelector('#mediaFilePreviewDetailAuthor').textContent = details.author || 'Не указан';
      viewer.querySelector('#mediaFilePreviewDetailDate').textContent = details.date || '—';
      viewer.querySelector('#mediaFilePreviewDetailCategory').textContent = details.category || 'Не указана';
      viewer.querySelector('#mediaFilePreviewDetailComment').textContent = details.comment || 'Без комментария';
      adminActions.querySelectorAll('[data-media-preview-admin-action]').forEach(button => {
        button.dataset.adminMediaId = details.id || '';
      });
      const caption = String(details.comment || '').trim();
      const expandedCaption = viewer.querySelector('#mediaFilePreviewExpandedCaption');
      expandedCaption.textContent = caption;
      expandedCaption.hidden = !caption || caption === 'Без комментария';
      viewer.querySelector('#mediaFilePreviewExpandedCounter').textContent = `${video ? 'Видео' : 'Фотография'} ${state.previewIndex + 1} из ${count}`;
      viewer.querySelector('#mediaFilePreviewExpandedAuthor').textContent = details.author || 'Автор не указан';
      viewer.querySelector('#mediaFilePreviewExpandedTime').textContent = details.time || 'время не указано';
    }
    viewer.querySelectorAll('[data-media-preview-nav]').forEach(button => {
      button.hidden = count < 2 && adminPreviewSubmissionIds().length < 2;
    });
  }

  function showFilePreview(items, index, trigger, author = '', details = null, options = {}) {
    if (!Array.isArray(items) || !items.length || index < 0) return;
    const viewer = ensureFilePreview();
    state.previewItems = items;
    state.previewIndex = index;
    state.previewAuthor = String(author || 'Не указан').trim();
    state.previewDetails = details;
    state.previewExpanded = Boolean(details && options.expanded);
    state.previewLastFocused = trigger || document.activeElement;
    renderFilePreview();
    viewer.hidden = false;
    viewer.setAttribute('aria-hidden', 'false');
    elements.panel.inert = true;
    const adminPortal = document.getElementById('adminPortal');
    if (adminPortal) adminPortal.inert = true;
    document.documentElement.classList.add('media-file-preview-open');
    viewer.querySelector('.media-file-preview-dialog')?.focus();
  }

  function openFilePreview(id, trigger) {
    const items = selectedPreviewItems();
    showFilePreview(items, items.findIndex(item => item.id === id), trigger, userDisplayName(state.session?.user));
  }

  function openAdminFilePreview(id, trigger, options = {}) {
    const submission = state.adminItems.find(item => String(item.id) === String(id));
    if (!submission) return;
    const items = itemFiles(submission).map((file, index) => ({
      id: String(file.id || file.storage_path || `${id}-${index}`),
      previewUrl: file.signed_url || '',
      file: {
        name: file.file_name || `Файл ${index + 1}`,
        size: Number(file.file_size) || 0,
        type: file.mime_type || 'application/octet-stream'
      }
    })).filter(item => item.previewUrl);
    if (!items.length) {
      showNotice('Предпросмотр этого материала недоступен.', 'error');
      return;
    }
    const author = itemAuthor(submission);
    const requestedIndex = options.index === 'last' ? items.length - 1 : Number(options.index) || 0;
    showFilePreview(items, Math.min(items.length - 1, Math.max(0, requestedIndex)), trigger, author, {
      id: String(submission.id),
      author,
      date: formatAdminDate(submission.created_at),
      time: formatPreviewTimestamp(submission.created_at),
      category: MEDIA_CATEGORY_LABELS[itemCategory(submission)] || 'Не указана',
      comment: String(submission.comment || '').trim() || 'Без комментария'
    }, { expanded: Boolean(options.expanded) });
  }

  function closeFilePreview({ restoreFocus = true } = {}) {
    const viewer = document.getElementById('mediaFilePreview');
    if (!viewer || viewer.hidden) return;
    viewer.querySelector('video')?.pause?.();
    viewer.hidden = true;
    viewer.setAttribute('aria-hidden', 'true');
    elements.panel.inert = false;
    const adminPortal = document.getElementById('adminPortal');
    if (adminPortal) adminPortal.inert = false;
    document.documentElement.classList.remove('media-file-preview-open');
    state.previewIndex = -1;
    state.previewItems = [];
    state.previewAuthor = '';
    state.previewDetails = null;
    state.previewExpanded = false;
    if (restoreFocus) state.previewLastFocused?.focus?.();
    state.previewLastFocused = null;
  }

  function moveFilePreview(direction) {
    if (!direction || state.previewIndex < 0 || !state.previewItems.length) return;
    const viewer = ensureFilePreview();
    viewer.querySelector('video')?.pause?.();
    const nextIndex = state.previewIndex + direction;
    if (state.previewDetails && (nextIndex < 0 || nextIndex >= state.previewItems.length)) {
      if (moveAdminPreviewSubmission(direction)) return;
    }
    if (state.previewItems.length < 2) return;
    state.previewIndex = (nextIndex + state.previewItems.length) % state.previewItems.length;
    renderFilePreview();
  }

  function adminPreviewSubmissionIds() {
    if (!state.previewDetails || !elements.adminList) return [];
    return [...elements.adminList.querySelectorAll('[data-admin-media-card]')]
      .map(card => String(card.dataset.adminMediaCard || ''))
      .filter(Boolean);
  }

  function moveAdminPreviewSubmission(direction) {
    const ids = adminPreviewSubmissionIds();
    if (ids.length < 2) return false;
    const currentId = String(state.previewDetails?.id || '');
    const currentIndex = ids.indexOf(currentId);
    if (currentIndex < 0) return false;
    const targetIndex = (currentIndex + (direction < 0 ? -1 : 1) + ids.length) % ids.length;
    const targetId = ids[targetIndex];
    const targetTrigger = elements.adminList.querySelector(`[data-admin-media-card="${CSS.escape(targetId)}"] [data-admin-media-preview]`);
    openAdminFilePreview(targetId, targetTrigger || state.previewLastFocused, {
      index: direction < 0 ? 'last' : 0,
      expanded: state.previewExpanded
    });
    return true;
  }

  function setPreviewMediaWidth(value) {
    state.previewMediaWidth = Math.min(70, Math.max(30, Number(value) || 47));
    const dialog = document.querySelector('#mediaFilePreview .media-file-preview-dialog');
    dialog?.style.setProperty('--admin-preview-media-width', `${state.previewMediaWidth}%`);
    document.querySelector('#mediaFilePreview [data-media-preview-resizer]')
      ?.setAttribute('aria-valuenow', String(Math.round(state.previewMediaWidth)));
  }

  function setAdminPreviewExpanded(expanded) {
    if (!state.previewDetails) return;
    state.previewExpanded = Boolean(expanded);
    renderFilePreview();
  }

  async function rollbackSubmission(submissionId, uploadedPaths) {
    if (uploadedPaths.length) {
      const { error } = await state.client.storage.from(BUCKET).remove(uploadedPaths);
      if (error) console.warn('Не удалось удалить незавершённую загрузку:', error);
    }
    if (submissionId) {
      const { error } = await state.client.from('media_submissions').delete().eq('id', submissionId);
      if (error) console.warn('Не удалось удалить незавершённую отправку:', error);
      const meta = localMediaMeta();
      delete meta[String(submissionId)];
      writeLocalJson(ADMIN_MEDIA_META_KEY, meta);
      setDownloaded(submissionId, false);
    }
  }

  async function submitFile(event) {
    event.preventDefault();
    const title = elements.title.value.trim()
      || state.selectedFiles[0]?.file?.name?.replace(/\.[^.]+$/, '').slice(0, 120)
      || 'Локальный материал';

    if (!state.selectedFiles.length) {
      showNotice('Сначала выбери хотя бы один файл.', 'error');
      return;
    }

    let submissionId = null;
    const uploadedPaths = [];
    state.submitting = true;
    setBusy(elements.submitButton, true, 'Подготавливаем…');

    try {
      const user = await requireAdmin();
      const hasVideo = state.selectedFiles.some(selected => isVideo(selected.file));
      const hasPhoto = state.selectedFiles.some(selected => !isVideo(selected.file));
      const mediaType = hasVideo && hasPhoto ? 'mixed' : hasVideo ? 'video' : 'photo';

      if (state.localMode) {
        submissionId = -Date.now();
        const now = new Date().toISOString();
        const rows = [];

        for (let index = 0; index < state.selectedFiles.length; index += 1) {
          const file = state.selectedFiles[index].file;
          const blobKey = `${submissionId}:${index}:${uniqueId()}`;
          setBusy(elements.submitButton, true, `Сохраняем ${index + 1} из ${state.selectedFiles.length}…`);
          await localDbPut(blobKey, file);
          rows.push({
            id: -(Date.now() + index + 1),
            local_blob_key: blobKey,
            storage_path: '',
            file_name: file.name,
            mime_type: file.type || 'application/octet-stream',
            file_size: file.size,
            sort_order: index,
            created_by: user.id
          });
        }

        const item = {
          id: submissionId,
          title,
          comment: elements.comment.value.trim(),
          media_type: mediaType,
          category: elements.form?.dataset.category || 'personal',
          status: 'pending',
          created_by: user.id,
          created_at: now,
          updated_at: now,
          moderated_at: null,
          published_at: null,
          archived_at: null,
          media_submission_files: rows
        };

        const items = readLocalMediaItems();
        items.unshift(item);
        writeLocalMediaItems(items);
        rememberMediaMeta(submissionId, {
          category: item.category,
          authorName: userDisplayName(user)
        });

        elements.form.reset();
        clearSelectedFiles();
        showNotice('Материал сохранён локально и добавлен в очередь управления.', 'success');
        await loadAdminQueue();
        return;
      }

      const { data: submission, error: submissionError } = await state.client
        .from('media_submissions')
        .insert({
          title,
          comment: elements.comment.value.trim(),
          media_type: mediaType,
          category: elements.form?.dataset.category || 'personal',
          status: 'pending',
          created_by: user.id
        })
        .select('id')
        .single();
      if (submissionError) throw submissionError;
      submissionId = submission.id;
      rememberMediaMeta(submissionId, {
        category: elements.form?.dataset.category || 'personal',
        authorName: userDisplayName(user)
      });

      const fileRows = [];
      for (let index = 0; index < state.selectedFiles.length; index += 1) {
        const file = state.selectedFiles[index].file;
        const uploadedPath = `${user.id}/${submissionId}/${uniqueId()}-${safeFileName(file.name)}`;
        setBusy(elements.submitButton, true, `Загружаем ${index + 1} из ${state.selectedFiles.length}…`);
        const { error: uploadError } = await state.client.storage
          .from(BUCKET)
          .upload(uploadedPath, file, {
            cacheControl: '3600',
            contentType: file.type || undefined,
            upsert: false
          });
        if (uploadError) throw uploadError;
        uploadedPaths.push(uploadedPath);
        fileRows.push({
          submission_id: submissionId,
          storage_path: uploadedPath,
          file_name: file.name,
          mime_type: file.type || 'application/octet-stream',
          file_size: file.size,
          sort_order: index,
          created_by: user.id
        });
      }

      const { error: fileError } = await state.client.from('media_submission_files').insert(fileRows);
      if (fileError) throw fileError;

      elements.form.reset();
      clearSelectedFiles();
      showNotice('Материал отправлен в очередь управления.', 'success');
      await loadAdminQueue();
    } catch (error) {
      console.error(error);
      if (!state.localMode) await rollbackSubmission(submissionId, uploadedPaths);
      showNotice(errorMessage(error, 'Не удалось загрузить материал.'), 'error');
    } finally {
      state.submitting = false;
      setBusy(elements.submitButton, false);
      updateSelectedFiles();
    }
  }

  async function addSignedUrls(submissions) {
    const files = submissions.flatMap(item => Array.isArray(item.media_submission_files)
      ? item.media_submission_files
      : []);
    await Promise.all(files.map(async file => {
      const { data, error } = await state.client.storage.from(BUCKET).createSignedUrl(file.storage_path, 3600);
      file.signed_url = error ? '' : data?.signedUrl || '';
    }));
    return submissions;
  }

  function itemFiles(item) {
    return [...(Array.isArray(item.media_submission_files) ? item.media_submission_files : [])]
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  }

  function typeLabel(type) {
    if (type === 'mixed') return 'Фото + видео';
    return type === 'video' ? 'Видео' : 'Фото';
  }

  function previewMarkup(item, { controls = true } = {}) {
    const files = itemFiles(item);
    if (!files.length) return '<div class="media-empty">Файлы не найдены</div>';
    return files.map(file => {
      if (!file.signed_url) return '<div class="media-card-file"><div class="media-empty">Файл недоступен</div></div>';
      const preview = isVideo(file)
        ? `<video ${controls ? 'controls' : ''} playsinline preload="metadata" src="${escapeHtml(file.signed_url)}"></video>`
        : `<img alt="${escapeHtml(item.title)}" loading="lazy" src="${escapeHtml(file.signed_url)}">`;
      return `<div class="media-card-file">${preview}</div>`;
    }).join('');
  }

  function renderPublished() {
    if (!state.published.length) {
      elements.publicList.innerHTML = '<div class="media-empty">Опубликованных материалов пока нет.</div>';
      return;
    }

    elements.publicList.innerHTML = state.published.map(item => {
      const files = itemFiles(item);
      return `
      <article class="media-card public-media-card">
        <div class="media-card-gallery${files.length === 1 ? ' is-single' : ''}">
          ${previewMarkup(item)}
        </div>
        <div class="media-card-body">
          <span class="media-card-status published">${escapeHtml(typeLabel(item.media_type))}</span>
          <h4>${escapeHtml(item.title)}</h4>
          ${item.comment
            ? `<p class="media-card-comment">${escapeHtml(item.comment)}</p>`
            : '<p class="media-card-comment">Без описания.</p>'}
          <div class="media-card-meta">
            <span>${files.length} ${files.length === 1 ? 'файл' : files.length < 5 ? 'файла' : 'файлов'}</span>
            <span>${escapeHtml(formatDate(item.published_at || item.moderated_at || item.updated_at))}</span>
          </div>
        </div>
      </article>
      `;
    }).join('');
  }

  async function loadPublished() {
    if (state.localMode) {
      state.published = await hydrateLocalMediaItems(readLocalMediaItems().filter(item => item.status === 'published'));
      renderPublished();
      return;
    }
    if (!state.client) {
      elements.publicList.innerHTML = '<div class="media-empty">Supabase не настроен.</div>';
      return;
    }
    elements.publicList.innerHTML = '<div class="media-empty">Загружаем опубликованные материалы…</div>';
    setBusy(elements.refreshButton, true, '…');
    try {
      const { data, error } = await state.client
        .from('media_submissions')
        .select('id,title,comment,status,media_type,updated_at,moderated_at,published_at,media_submission_files(id,storage_path,file_name,mime_type,file_size,sort_order)')
        .eq('status', 'published')
        .order('published_at', { ascending: false, nullsFirst: false });
      if (error) throw error;
      state.published = await addSignedUrls(Array.isArray(data) ? data : []);
      renderPublished();
    } catch (error) {
      console.error(error);
      elements.publicList.innerHTML = `<div class="media-empty">${escapeHtml(errorMessage(error, 'Не удалось загрузить материалы.'))}</div>`;
    } finally {
      setBusy(elements.refreshButton, false);
    }
  }

  function adminBaseItems() {
    return state.adminItems.filter(item => item.status === 'pending');
  }

  function updateAdminCounts() {
    const pendingItems = adminBaseItems();
    const downloaded = downloadedIds();
    const pendingCount = pendingItems.filter(item => !downloaded.has(String(item.id))).length;
    const downloadedCount = pendingItems.filter(item => downloaded.has(String(item.id))).length;
    if (elements.adminPendingCount) elements.adminPendingCount.textContent = String(pendingCount);
    if (elements.adminDownloadedCount) elements.adminDownloadedCount.textContent = String(downloadedCount);
    if (elements.adminVideoCount) elements.adminVideoCount.textContent = String(pendingItems.filter(item => ['video', 'mixed'].includes(item.media_type)).length);
    if (elements.adminPhotoCount) elements.adminPhotoCount.textContent = String(pendingItems.filter(item => ['photo', 'mixed'].includes(item.media_type)).length);
  }

  function adminPreviewMarkup(item) {
    const files = itemFiles(item);
    if (!files.length) return '<div class="media-empty">Файл не найден</div>';
    const fileCountLabel = `${files.length} ${files.length === 1 ? 'файл' : files.length < 5 ? 'файла' : 'файлов'}`;
    const layoutClass = files.length === 1 ? 'is-single' : files.length === 2 ? 'is-double' : 'is-grid';
    const visibleFiles = files.length > 3 ? files.slice(0, 3) : files;
    const tileMarkup = visibleFiles.map((file, index) => {
      if (!file.signed_url) {
        return `<span class="admin-media-tile"><span class="media-empty">Файл ${index + 1}<br>недоступен</span></span>`;
      }
      const preview = isVideo(file)
        ? `<video aria-hidden="true" muted playsinline preload="metadata" src="${escapeHtml(file.signed_url)}"></video>`
        : `<img alt="" aria-hidden="true" loading="lazy" src="${escapeHtml(file.signed_url)}">`;
      return `<span class="admin-media-tile">${preview}</span>`;
    });
    if (files.length === 3) tileMarkup.push('<span class="admin-media-tile is-empty" aria-hidden="true"></span>');
    if (files.length > 3) tileMarkup.push(`<span class="admin-media-tile is-more" aria-hidden="true">+${files.length - 3}</span>`);
    return `<button class="admin-media-preview-open" data-admin-media-preview="${escapeHtml(item.id)}" type="button" aria-label="Просмотреть ${fileCountLabel} «${escapeHtml(item.title || files[0].file_name || 'Материал')}»"><span class="admin-media-mosaic ${layoutClass}">${tileMarkup.join('')}</span></button>`;
  }

  function formatMatches(item) {
    if (!state.adminFormats.length) return true;
    const itemType = String(item.media_type || '');
    if (itemType === 'mixed') return state.adminFormats.includes('photo') || state.adminFormats.includes('video');
    return state.adminFormats.includes(itemType);
  }

  function categoryMatches(item) {
    return !state.adminCategories.length || state.adminCategories.includes(itemCategory(item));
  }

  function statusMatches(item, downloaded) {
    const isDownloaded = downloaded.has(String(item.id));
    return state.adminStatus === 'downloaded' ? isDownloaded : !isDownloaded;
  }

  function renderAdminQueue() {
    if (!state.isAdmin) return;
    updateAdminCounts();
    const downloaded = downloadedIds();
    const items = adminBaseItems()
      .filter(item => statusMatches(item, downloaded))
      .filter(formatMatches)
      .filter(categoryMatches);

    if (!items.length) {
      const statusText = state.adminStatus === 'downloaded' ? 'Скачанное' : 'На рассмотрении';
      elements.adminList.innerHTML = `<div class="media-empty">В разделе «${statusText}» нет материалов по выбранным фильтрам.</div>`;
      return;
    }

    elements.adminList.innerHTML = items.map(item => {
      return `
        <article class="admin-media-card" data-admin-media-card="${escapeHtml(item.id)}">
          <div class="admin-media-preview">${adminPreviewMarkup(item)}</div>
          <div class="admin-media-actions">
            <button class="admin-media-download" data-admin-media-action="download" data-admin-media-id="${escapeHtml(item.id)}" type="button"><span class="admin-media-download-label">Скачать</span><img class="admin-media-download-icon" src="./assets/images/figma/arrow-circle-white.svg" alt="" aria-hidden="true" /></button>
            <button class="admin-media-delete" data-admin-media-action="delete" data-admin-media-id="${escapeHtml(item.id)}" aria-label="Удалить материал" type="button">X</button>
          </div>
        </article>
      `;
    }).join('');
  }

  async function loadAdminQueue() {
    if (!elements.adminList || !state.isAdmin) return;
    if (state.localMode) {
      state.adminItems = await hydrateLocalMediaItems(readLocalMediaItems());
      renderAdminQueue();
      return;
    }
    if (!state.client) return;
    elements.adminList.innerHTML = '<div class="media-empty">Загружаем материалы…</div>';
    setBusy(elements.adminRefresh, true, 'Загружаем…');
    try {
      await requireAdmin();
      const { data, error } = await state.client
        .from('media_submissions')
        .select('id,title,comment,status,media_type,category,created_by,created_at,updated_at,moderated_at,published_at,archived_at,media_submission_files(id,storage_path,file_name,mime_type,file_size,sort_order)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const items = await addSignedUrls(Array.isArray(data) ? data : []);
      state.adminItems = await attachAdminAuthorNames(items);
      renderAdminQueue();
    } catch (error) {
      console.error(error);
      elements.adminList.innerHTML = `<div class="media-empty">${escapeHtml(errorMessage(error, 'Не удалось загрузить очередь.'))}</div>`;
    } finally {
      setBusy(elements.adminRefresh, false);
    }
  }

  function cardValues(id) {
    const card = [...elements.adminList.querySelectorAll('[data-admin-media-card]')]
      .find(item => item.dataset.adminMediaCard === id);
    return {
      card,
      title: card?.querySelector('[data-admin-media-title]')?.value.trim() || '',
      comment: card?.querySelector('[data-admin-media-comment]')?.value.trim() || ''
    };
  }

  async function saveOrModerate(id, action, button) {
    const { card, title, comment } = cardValues(id);
    if (!card || !title) {
      card?.querySelector('[data-admin-media-title]')?.focus();
      showNotice('Название не может быть пустым.', 'error');
      return;
    }
    const buttons = [...card.querySelectorAll('[data-admin-media-action]')];
    buttons.forEach(item => { item.disabled = true; });
    setBusy(button, true, action === 'save' ? 'Сохраняем…' : 'Обновляем…');

    try {
      const user = await requireAdmin();
      const now = new Date().toISOString();
      const update = { title, comment };
      if (action === 'publish') {
        Object.assign(update, {
          status: 'published',
          published_at: now,
          archived_at: null,
          moderated_at: now,
          moderated_by: user.id
        });
      } else if (action === 'archive') {
        Object.assign(update, {
          status: 'archived',
          archived_at: now,
          moderated_at: now,
          moderated_by: user.id
        });
      }
      const { error } = await state.client.from('media_submissions').update(update).eq('id', id);
      if (error) throw error;
      showNotice(action === 'save'
        ? 'Изменения сохранены.'
        : action === 'publish'
          ? 'Материал опубликован.'
          : 'Материал перенесён в архив.', 'success');
      await loadAdminQueue();
      if (action === 'publish' && state.currentTab === 'published') loadPublished();
    } catch (error) {
      console.error(error);
      showNotice(errorMessage(error), 'error');
      buttons.forEach(item => { item.disabled = false; });
      setBusy(button, false);
    }
  }

  async function deleteSubmission(id, button) {
    const item = state.adminItems.find(entry => String(entry.id) === String(id));
    if (!item) return;

    if (state.localMode) {
      const confirmed = window.confirm(`Удалить «${item.title}» из локальной очереди?`);
      if (!confirmed) return;
      for (const file of item.media_submission_files || []) {
        if (file.local_blob_key) {
          try { await localDbDelete(file.local_blob_key); } catch (error) { console.warn(error); }
        }
      }
      const items = readLocalMediaItems().filter(entry => String(entry.id) !== String(id));
      writeLocalMediaItems(items);
      setDownloaded(id, false);
      const meta = localMediaMeta();
      delete meta[String(id)];
      writeLocalJson(ADMIN_MEDIA_META_KEY, meta);
      showNotice('Локальный материал удалён.', 'success');
      await loadAdminQueue();
      return;
    }
    const confirmed = window.confirm(`Удалить «${item.title}» вместе с загруженным файлом? Это действие нельзя отменить.`);
    if (!confirmed) return;
    const card = button.closest('.admin-media-card');
    card?.querySelectorAll('button').forEach(itemButton => { itemButton.disabled = true; });
    setBusy(button, true, 'Удаляем…');

    try {
      await requireAdmin();
      const paths = (item.media_submission_files || []).map(file => file.storage_path).filter(Boolean);
      if (paths.length) {
        const { error: storageError } = await state.client.storage.from(BUCKET).remove(paths);
        if (storageError) throw storageError;
      }
      const { error } = await state.client.from('media_submissions').delete().eq('id', id);
      if (error) throw error;
      setDownloaded(id, false);
      const meta = localMediaMeta();
      delete meta[String(id)];
      writeLocalJson(ADMIN_MEDIA_META_KEY, meta);
      showNotice('Материал и файл удалены.', 'success');
      await loadAdminQueue();
      if (item.status === 'published' && state.currentTab === 'published') loadPublished();
    } catch (error) {
      console.error(error);
      showNotice(errorMessage(error, 'Не удалось удалить материал.'), 'error');
      card?.querySelectorAll('button').forEach(itemButton => { itemButton.disabled = false; });
      setBusy(button, false);
    }
  }

  async function downloadSubmission(id, button) {
    const item = state.adminItems.find(entry => String(entry.id) === String(id));
    if (!item) return;
    const files = itemFiles(item);
    if (!files.length) {
      showNotice('У материала нет файлов для скачивания.', 'error');
      return;
    }

    if (state.localMode) {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const blob = file.local_blob_key ? await localDbGet(file.local_blob_key) : null;
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.file_name || `media-${index + 1}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1200);
      }
      setDownloaded(id, true);
      showNotice('Локальный материал отмечен как скачанный.', 'success');
      renderAdminQueue();
      return;
    }

    const card = button.closest('.admin-media-card');
    card?.querySelectorAll('button').forEach(itemButton => { itemButton.disabled = true; });
    setBusy(button, true, files.length > 1 ? `Скачиваем 1/${files.length}…` : 'Скачиваем…');

    try {
      await requireAdmin();
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        if (files.length > 1) setBusy(button, true, `Скачиваем ${index + 1}/${files.length}…`);
        const { data, error } = await state.client.storage.from(BUCKET).download(file.storage_path);
        if (error) throw error;
        const url = URL.createObjectURL(data);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.file_name || `media-${index + 1}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1200);
      }
      setDownloaded(id, true);
      showNotice(files.length > 1 ? 'Материалы скачаны.' : 'Материал скачан.', 'success');
      renderAdminQueue();
    } catch (error) {
      console.error(error);
      showNotice(errorMessage(error, 'Не удалось скачать материал.'), 'error');
      card?.querySelectorAll('button').forEach(itemButton => { itemButton.disabled = false; });
      setBusy(button, false);
    }
  }

  function setAdminStatus(status) {
    state.adminStatus = status === 'downloaded' ? 'downloaded' : 'pending';
    elements.adminStatusTabs.forEach(button => {
      button.classList.toggle('active', button.dataset.adminMediaStatus === state.adminStatus);
    });
    renderAdminQueue();
  }

  function readAdminFilters() {
    const box = document.getElementById('adminMediaFilters');
    if (!box) return;
    state.adminFormats = [...box.querySelectorAll('[data-admin-media-format]:checked')]
      .map(input => input.dataset.adminMediaFormat)
      .filter(Boolean);
    state.adminCategories = [...box.querySelectorAll('[data-admin-media-category]:checked')]
      .map(input => input.dataset.adminMediaCategory)
      .filter(Boolean);
  }

  function openAdminLogin() {
    closePanel();
    document.getElementById('adminPortalOpen')?.click();
  }

  function bindEvents() {
    window.addEventListener('resize', fitProposalToGameModal);
    elements.triggers.forEach(trigger => trigger.addEventListener('click', openPanel));
    elements.close.addEventListener('click', closePanel);
    elements.panel.addEventListener('click', event => {
      if (event.target.matches('[data-media-close]')) closePanel();
    });
    elements.loginButton.addEventListener('click', openAdminLogin);
    elements.tabs.forEach(button => button.addEventListener('click', () => setTab(button.dataset.mediaTab)));
    elements.fileInput.addEventListener('change', () => {
      const files = [...(elements.fileInput.files || [])];
      if (state.replacingId) {
        replaceFile(state.replacingId, files[0]);
        state.replacingId = null;
        elements.fileInput.value = '';
        return;
      }
      addFiles(files);
    });
    elements.title.addEventListener('input', updateSelectedFiles);
    elements.dropzone.addEventListener('pointerdown', () => {
      state.replacingId = null;
    });
    elements.dropzone.addEventListener('keydown', event => {
      if (!['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      state.replacingId = null;
      elements.fileInput.click();
    });
    elements.selected.addEventListener('click', event => {
      const showAllButton = event.target.closest('[data-media-show-all]');
      if (showAllButton) {
        state.selectedMosaicExpanded = true;
        updateSelectedFiles();
        elements.selected.querySelector('.media-selected-item:nth-child(4) .media-selected-preview')?.focus();
        return;
      }
      const collapseButton = event.target.closest('[data-media-collapse]');
      if (collapseButton) {
        state.selectedMosaicExpanded = false;
        updateSelectedFiles();
        elements.selected.querySelector('[data-media-show-all]')?.focus();
        return;
      }
      const removeButton = event.target.closest('[data-media-remove]');
      if (removeButton) {
        removeFile(removeButton.dataset.mediaRemove);
        return;
      }
      const replaceButton = event.target.closest('[data-media-replace]');
      if (replaceButton) {
        state.replacingId = replaceButton.dataset.mediaReplace;
        elements.fileInput.click();
        return;
      }
      const previewButton = event.target.closest('[data-media-preview]');
      if (previewButton) openFilePreview(previewButton.dataset.mediaPreview, previewButton);
    });
    ['dragenter', 'dragover'].forEach(name => elements.dropzone.addEventListener(name, event => {
      event.preventDefault();
      elements.dropzone.classList.add('is-dragging');
    }));
    ['dragleave', 'drop'].forEach(name => elements.dropzone.addEventListener(name, event => {
      event.preventDefault();
      elements.dropzone.classList.remove('is-dragging');
    }));
    elements.dropzone.addEventListener('drop', event => addFiles(event.dataTransfer?.files));
    elements.form.addEventListener('submit', submitFile);
    elements.refreshButton.addEventListener('click', loadPublished);
    elements.adminRefresh?.addEventListener('click', loadAdminQueue);
    elements.adminStatusTabs.forEach(button => {
      button.addEventListener('click', () => setAdminStatus(button.dataset.adminMediaStatus));
    });
    elements.adminList?.addEventListener('click', event => {
      const preview = event.target.closest('[data-admin-media-preview]');
      if (preview) {
        openAdminFilePreview(preview.dataset.adminMediaPreview, preview);
        return;
      }
      const button = event.target.closest('[data-admin-media-action][data-admin-media-id]');
      if (!button) return;
      const { adminMediaAction: action, adminMediaId: id } = button.dataset;
      if (action === 'delete') deleteSubmission(id, button);
      if (action === 'download') downloadSubmission(id, button);
    });
    document.addEventListener('change', event => {
      if (!event.target.matches?.('[data-admin-media-format], [data-admin-media-category]')) return;
      readAdminFilters();
      renderAdminQueue();
    });
    document.getElementById('adminPortalOpen')?.addEventListener('click', () => {
      window.setTimeout(() => refreshAccess(), 120);
    });
    document.addEventListener('keydown', event => {
      const viewer = document.getElementById('mediaFilePreview');
      if (viewer && !viewer.hidden) return;
      if (elements.panel.hidden) return;
      if (event.key === 'Escape') {
        closePanel();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...elements.panel.querySelectorAll('button:not([hidden]):not(:disabled),a[href],input:not([type="hidden"]):not(:disabled),textarea:not(:disabled),select:not(:disabled)')]
        .filter(element => element.offsetParent !== null);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    });

    document.addEventListener('keydown', event => {
      const viewer = document.getElementById('mediaFilePreview');
      if (!viewer || viewer.hidden) return;
      if (event.target.closest?.('[data-media-preview-resizer]')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (state.previewExpanded) setAdminPreviewExpanded(false);
        else closeFilePreview();
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopImmediatePropagation();
        moveFilePreview(event.key === 'ArrowLeft' ? -1 : 1);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...viewer.querySelectorAll('button:not([hidden]):not(:disabled),a[href]')];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }, true);
  }

  function start() {
    if (!state.eventsBound) {
      state.eventsBound = true;
      bindEvents();
    }
    if (state.started) return;
    state.client = configuredClient();

    if (state.localMode) {
      state.started = true;
      state.session = { user: localAdminUser() };
      state.isAdmin = true;
      renderAccess();
      loadAdminQueue();
      return;
    }

    if (!state.client) {
      renderAccess();
      return;
    }
    state.started = true;
    refreshAccess();
    state.client.auth.onAuthStateChange(() => {
      window.setTimeout(() => refreshAccess(), 0);
    });
    window.setTimeout(() => refreshAccess(), 700);
  }

  window.addEventListener('cr7:supabase-ready', start, { once: true });
  start();
})();
