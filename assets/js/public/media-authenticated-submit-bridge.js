(() => {
  'use strict';

  // Authenticated media submit bridge.
  // The moderation queue remains admin-only; this only owns the public
  // "Предложить фото/видео" form on online builds.
  if (window.location.protocol === 'file:') return;

  const BUCKET = 'stream-submissions';
  const MAX_FILES = 8;
  const MAX_FILE_SIZE = 100 * 1024 * 1024;
  const ALLOWED_MIME = new Set([
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime'
  ]);
  const ALLOWED_EXT = /\.(?:jpe?g|png|webp|gif|mp4|webm|mov)$/i;

  const state = {
    client: null,
    session: null,
    files: [],
    replacingId: null,
    submitting: false,
    bound: false
  };

  const el = {};

  function configuredClient() {
    if (window.CR7_SUPABASE_CLIENT) return window.CR7_SUPABASE_CLIENT;
    const config = window.CR7_CONFIG || {};
    const url = String(config.supabaseUrl || '');
    const key = String(config.supabasePublishableKey || '');
    if (!window.supabase?.createClient || !url.startsWith('https://') || !key) return null;
    window.CR7_SUPABASE_CLIENT = window.supabase.createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    return window.CR7_SUPABASE_CLIENT;
  }

  function isRealUser(user) {
    return Boolean(user && !user.is_anonymous);
  }

  async function refreshSession() {
    state.client = configuredClient();
    state.session = null;
    if (!state.client) {
      render();
      return null;
    }
    try {
      const result = window.CR7_AUTH?.getUsableSession
        ? await window.CR7_AUTH.getUsableSession(state.client)
        : await state.client.auth.getSession();
      if (result?.error) throw result.error;
      state.session = result?.data?.session || null;
    } catch (error) {
      console.warn('Не удалось проверить авторизацию медиапредложки:', error?.message || error);
    }
    render();
    return state.session;
  }

  async function requireUser() {
    if (!isRealUser(state.session?.user)) await refreshSession();
    const user = state.session?.user;
    if (!isRealUser(user)) {
      showNotice('Войди в аккаунт, чтобы отправить материал.', 'error');
      document.getElementById('siteAuthOpen')?.focus?.();
      return null;
    }
    return user;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} КБ`;
    return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} МБ`;
  }

  function isVideo(file) {
    return String(file?.type || '').startsWith('video/') || /\.(?:mp4|webm|mov)$/i.test(String(file?.name || ''));
  }

  function fileKey(file) {
    return `${file.name}:${file.size}:${file.lastModified}`;
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

  function validateFile(file) {
    if (!file) return 'Файл не выбран.';
    if (!(ALLOWED_MIME.has(file.type) || (!file.type && ALLOWED_EXT.test(file.name)))) {
      return `Формат «${file.name}» не поддерживается.`;
    }
    if (file.size > MAX_FILE_SIZE) return `«${file.name}» больше 100 МБ.`;
    return '';
  }

  function showNotice(message, type = 'info') {
    if (!el.notice) return;
    el.notice.textContent = message;
    el.notice.className = `media-notice show ${type}`;
  }

  function revoke(item) {
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
  }

  function render() {
    if (!el.selected || !el.submit || !el.title) return;
    const count = state.files.length;
    const hasTitle = Boolean(el.title.value.trim());
    const signedIn = isRealUser(state.session?.user);

    el.selected.hidden = count === 0;
    el.dropzone?.classList.toggle('has-file', count > 0);
    el.submit.disabled = state.submitting || !signedIn || count === 0 || !hasTitle;

    if (el.hint) {
      el.hint.textContent = count === 0
        ? signedIn ? 'Сначала выбери файлы и добавь название.' : 'Войди в аккаунт, чтобы отправить материал.'
        : !hasTitle
          ? `${count} ${count === 1 ? 'файл выбран' : count < 5 ? 'файла выбраны' : 'файлов выбраны'}. Осталось добавить название.`
          : `${count} ${count === 1 ? 'файл готов' : count < 5 ? 'файла готовы' : 'файлов готовы'} к отправке.`;
    }

    if (!count) {
      el.selected.innerHTML = '';
      return;
    }

    el.selected.innerHTML = state.files.map(item => {
      const file = item.file;
      const preview = isVideo(file)
        ? `<video controls muted playsinline preload="metadata" src="${escapeHtml(item.previewUrl)}"></video>`
        : `<img alt="${escapeHtml(file.name)}" src="${escapeHtml(item.previewUrl)}">`;
      return `
        <article class="media-selected-item">
          <div class="media-selected-preview">${preview}</div>
          <div class="media-selected-copy">
            <strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong>
            <small>${isVideo(file) ? 'Видео' : 'Фото'} · ${escapeHtml(formatBytes(file.size))}</small>
          </div>
          <div class="media-selected-actions">
            <button data-auth-media-replace="${escapeHtml(item.id)}" type="button">Заменить</button>
            <button class="danger" data-auth-media-remove="${escapeHtml(item.id)}" type="button">Удалить</button>
          </div>
        </article>`;
    }).join('');
  }

  function addFiles(fileList) {
    const incoming = [...(fileList || [])];
    const errors = [];

    if (state.replacingId) {
      const file = incoming[0];
      const index = state.files.findIndex(item => item.id === state.replacingId);
      const error = validateFile(file);
      if (error) errors.push(error);
      else if (index >= 0) {
        const duplicate = state.files.some((item, itemIndex) => itemIndex !== index && fileKey(item.file) === fileKey(file));
        if (!duplicate) {
          revoke(state.files[index]);
          state.files[index] = { id: state.replacingId, file, previewUrl: URL.createObjectURL(file) };
        }
      }
      state.replacingId = null;
    } else {
      const existing = new Set(state.files.map(item => fileKey(item.file)));
      for (const file of incoming) {
        if (state.files.length >= MAX_FILES) {
          errors.push(`За одну отправку можно выбрать не более ${MAX_FILES} файлов.`);
          break;
        }
        const error = validateFile(file);
        if (error) { errors.push(error); continue; }
        const key = fileKey(file);
        if (existing.has(key)) continue;
        state.files.push({
          id: window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          file,
          previewUrl: URL.createObjectURL(file)
        });
        existing.add(key);
      }
    }

    if (el.input) el.input.value = '';
    if (!el.title.value.trim() && state.files[0]?.file?.name) {
      el.title.value = state.files[0].file.name.replace(/\.[^.]+$/, '').slice(0, 120);
    }
    render();
    if (errors.length) showNotice([...new Set(errors)].join(' '), 'error');
  }

  function clearFiles() {
    state.files.forEach(revoke);
    state.files = [];
    state.replacingId = null;
    if (el.input) el.input.value = '';
    render();
  }

  async function rollback(submissionId, uploadedPaths) {
    if (!state.client) return;
    if (uploadedPaths.length) {
      try { await state.client.storage.from(BUCKET).remove(uploadedPaths); } catch {}
    }
    if (submissionId) {
      try { await state.client.from('media_submissions').delete().eq('id', submissionId); } catch {}
    }
  }

  async function submit(event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    const user = await requireUser();
    if (!user) return;
    if (!state.files.length) {
      showNotice('Сначала выбери хотя бы один файл.', 'error');
      return;
    }

    const title = el.title.value.trim()
      || state.files[0]?.file?.name?.replace(/\.[^.]+$/, '').slice(0, 120)
      || 'Материал';
    const hasVideo = state.files.some(item => isVideo(item.file));
    const hasPhoto = state.files.some(item => !isVideo(item.file));
    const mediaType = hasVideo && hasPhoto ? 'mixed' : hasVideo ? 'video' : 'photo';
    let submissionId = null;
    const uploadedPaths = [];
    const defaultText = el.submit.textContent || 'Отправить';

    state.submitting = true;
    el.submit.disabled = true;
    el.submit.textContent = 'Подготавливаем…';

    try {
      const { data: submission, error: submissionError } = await state.client
        .from('media_submissions')
        .insert({
          title,
          comment: el.comment?.value.trim() || '',
          media_type: mediaType,
          category: el.form?.dataset.category || 'personal',
          status: 'pending',
          created_by: user.id
        })
        .select('id')
        .single();
      if (submissionError) throw submissionError;
      submissionId = submission.id;

      const rows = [];
      for (let index = 0; index < state.files.length; index += 1) {
        const file = state.files[index].file;
        const unique = window.crypto?.randomUUID?.() || `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`;
        const path = `${user.id}/${submissionId}/${unique}-${safeFileName(file.name)}`;
        el.submit.textContent = `Загружаем ${index + 1} из ${state.files.length}…`;
        const { error: uploadError } = await state.client.storage.from(BUCKET).upload(path, file, {
          cacheControl: '3600',
          contentType: file.type || undefined,
          upsert: false
        });
        if (uploadError) throw uploadError;
        uploadedPaths.push(path);
        rows.push({
          submission_id: submissionId,
          storage_path: path,
          file_name: file.name,
          mime_type: file.type || 'application/octet-stream',
          file_size: file.size,
          sort_order: index,
          created_by: user.id
        });
      }

      const { error: filesError } = await state.client.from('media_submission_files').insert(rows);
      if (filesError) throw filesError;

      el.form.reset();
      clearFiles();
      showNotice('Материал отправлен на модерацию.', 'success');
    } catch (error) {
      console.error('Не удалось отправить медиапредложение:', error);
      await rollback(submissionId, uploadedPaths);
      const message = /row-level security|permission denied/i.test(String(error?.message || ''))
        ? 'Нет доступа к отправке. Проверь, что production-политики для авторизованных пользователей применены.'
        : (error?.message || 'Не удалось загрузить материал.');
      showNotice(message, 'error');
    } finally {
      state.submitting = false;
      el.submit.textContent = defaultText;
      render();
    }
  }

  function bind() {
    if (state.bound) return;
    state.bound = true;

    el.form = document.getElementById('mediaForm');
    el.input = document.getElementById('mediaFileInput');
    el.selected = document.getElementById('mediaSelected');
    el.dropzone = document.getElementById('mediaDropzone');
    el.title = document.getElementById('mediaSubmissionTitle');
    el.comment = document.getElementById('mediaSubmissionComment');
    el.submit = document.getElementById('mediaSubmitButton');
    el.hint = document.getElementById('mediaSubmitHint');
    el.notice = document.getElementById('mediaNotice');
    if (!el.form || !el.input || !el.selected || !el.submit || !el.title) return;

    // Capture phase intentionally owns only the public submission form.
    // Existing admin queue/moderation listeners remain untouched.
    el.input.addEventListener('change', event => {
      event.stopImmediatePropagation();
      addFiles(event.target.files);
    }, true);

    el.title.addEventListener('input', event => {
      event.stopImmediatePropagation();
      render();
    }, true);

    el.dropzone?.addEventListener('drop', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      addFiles(event.dataTransfer?.files);
    }, true);

    el.selected.addEventListener('click', event => {
      const remove = event.target.closest('[data-auth-media-remove]');
      const replace = event.target.closest('[data-auth-media-replace]');
      if (!remove && !replace) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (remove) {
        const index = state.files.findIndex(item => item.id === remove.dataset.authMediaRemove);
        if (index >= 0) {
          revoke(state.files[index]);
          state.files.splice(index, 1);
          render();
        }
        return;
      }
      state.replacingId = replace.dataset.authMediaReplace;
      el.input.click();
    }, true);

    el.form.addEventListener('submit', submit, true);

    refreshSession();
    const client = configuredClient();
    client?.auth?.onAuthStateChange?.(() => window.setTimeout(refreshSession, 0));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }
})();
