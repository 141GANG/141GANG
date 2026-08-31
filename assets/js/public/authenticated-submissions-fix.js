(() => {
  'use strict';

  const MAX_MEDIA_FILES = 8;
  const MAX_MEDIA_FILE_SIZE = 100 * 1024 * 1024;
  const ALLOWED_MEDIA_MIME = new Set([
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime'
  ]);
  const ALLOWED_MEDIA_EXT = /\.(?:jpe?g|png|webp|gif|mp4|webm|mov)$/i;

  const state = {
    client: null,
    session: null,
    isAdmin: false,
    accessReady: false,
    suggestionPreview: null,
    mediaFiles: [],
    replacingMediaId: null,
    mediaSubmitting: false,
    bound: false
  };

  function configuredClient() {
    if (window.CR7_SUPABASE_CLIENT) return window.CR7_SUPABASE_CLIENT;
    const config = window.CR7_CONFIG || {};
    const url = String(config.supabaseUrl || '');
    const key = String(config.supabasePublishableKey || '');
    if (!window.supabase?.createClient || !url.startsWith('https://') || !key) return null;
    window.CR7_SUPABASE_CLIENT = window.supabase.createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    return window.CR7_SUPABASE_CLIENT;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
  }

  function showNotice(element, message, type = 'info') {
    if (!element) return;
    element.textContent = message;
    const base = element.id === 'mediaNotice' ? 'media-notice' : 'suggestions-notice';
    element.className = `${base} show ${type}`;
  }

  function isRealUser(user) {
    return Boolean(user && !user.is_anonymous);
  }

  async function refreshAccess() {
    state.client = configuredClient();
    state.session = null;
    state.isAdmin = false;
    state.accessReady = false;
    if (!state.client) {
      state.accessReady = true;
      window.setTimeout(syncNonAdminControls, 0);
      return;
    }

    try {
      const result = window.CR7_AUTH?.getUsableSession
        ? await window.CR7_AUTH.getUsableSession(state.client)
        : await state.client.auth.getSession();
      if (result?.error) throw result.error;
      state.session = result?.data?.session || null;
      if (!isRealUser(state.session?.user)) return;
      const { data, error } = await state.client.rpc('is_site_admin');
      if (!error) state.isAdmin = data === true;
    } catch (error) {
      console.warn('Не удалось проверить доступ к отправке предложений:', error?.message || error);
    } finally {
      state.accessReady = true;
      window.setTimeout(syncNonAdminControls, 0);
    }
  }

  async function requireSignedInUser(notice) {
    await refreshAccess();
    const user = state.session?.user;
    if (!isRealUser(user)) {
      showNotice(notice, 'Войди в аккаунт, чтобы отправить предложение.', 'error');
      document.getElementById('siteAuthOpen')?.focus?.();
      return null;
    }
    return user;
  }

  function shouldOverride() {
    return state.accessReady && !state.isAdmin && window.location.protocol !== 'file:';
  }

  function parseSteamAppId(value) {
    try {
      const url = new URL(String(value || '').trim());
      if (!['store.steampowered.com', 'steamcommunity.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
      const match = url.pathname.match(/\/app\/(\d+)/i);
      return match ? Number(match[1]) : null;
    } catch {
      return null;
    }
  }

  function setSuggestionPlayers(game) {
    const minInput = document.getElementById('suggestionPlayersMin');
    const maxInput = document.getElementById('suggestionPlayersMax');
    if (!minInput || !maxInput || !game) return;
    const detectedMin = Number(game.playersMin ?? game.playerMinPlayers ?? game.coopMinPlayers);
    const detectedMax = Number(game.playersMax ?? game.playerMaxPlayers ?? game.coopMaxPlayers);
    const min = Number.isFinite(detectedMin) && detectedMin >= 1 ? Math.min(256, Math.trunc(detectedMin)) : 1;
    const fallbackMax = game.isCoop ? 2 : 1;
    const max = Number.isFinite(detectedMax) && detectedMax >= min
      ? Math.min(256, Math.trunc(detectedMax))
      : Math.max(min, fallbackMax);
    minInput.value = String(min);
    maxInput.value = String(max);
  }

  function clearSuggestionPreview() {
    state.suggestionPreview = null;
    const preview = document.getElementById('suggestionPreview');
    const image = document.getElementById('suggestionPreviewImage');
    const comment = document.getElementById('suggestionComment');
    const submit = document.getElementById('suggestionSubmitButton');
    if (preview) preview.hidden = true;
    if (image) image.removeAttribute('src');
    if (comment) comment.disabled = true;
    if (submit) submit.disabled = true;
  }

  async function previewSuggestion(event) {
    if (!shouldOverride()) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const notice = document.getElementById('suggestionsNotice');
    const user = await requireSignedInUser(notice);
    if (!user || state.isAdmin) return;

    const steamInput = document.getElementById('suggestionSteamUrl');
    const button = document.getElementById('suggestionPreviewButton');
    const steamUrl = steamInput?.value.trim() || '';
    if (!parseSteamAppId(steamUrl)) {
      clearSuggestionPreview();
      showNotice(notice, 'Вставь ссылку вида store.steampowered.com/app/12345/.', 'error');
      return;
    }
    if (typeof window.CR7_INVOKE_STEAM_FUNCTION !== 'function') {
      showNotice(notice, 'Сервис Steam ещё загружается. Попробуй ещё раз.', 'error');
      return;
    }

    const defaultText = button?.textContent || 'Проверить';
    if (button) { button.disabled = true; button.textContent = 'Ищем…'; }
    try {
      const data = await window.CR7_INVOKE_STEAM_FUNCTION({ action: 'suggestion-preview', steamUrl });
      if (!data?.appId || !data?.title) throw new Error(data?.error || 'Steam не вернул данные игры.');
      state.suggestionPreview = data;
      setSuggestionPlayers(data);

      const preview = document.getElementById('suggestionPreview');
      const image = document.getElementById('suggestionPreviewImage');
      const title = document.getElementById('suggestionPreviewTitle');
      const text = document.getElementById('suggestionPreviewText');
      const comment = document.getElementById('suggestionComment');
      const submit = document.getElementById('suggestionSubmitButton');
      if (title) title.textContent = data.title;
      if (text) text.textContent = data.description || 'Описание в Steam не указано.';
      if (image) {
        image.src = data.coverUrl || './assets/images/figma/game-placeholder.svg';
        image.alt = `Обложка ${data.title}`;
      }
      if (preview) preview.hidden = false;
      if (comment) comment.disabled = false;
      if (submit) submit.disabled = false;
      showNotice(notice, 'Игра найдена. Можно отправлять на модерацию.', 'success');
    } catch (error) {
      clearSuggestionPreview();
      showNotice(notice, error?.message || 'Не удалось получить данные из Steam.', 'error');
    } finally {
      if (button) { button.disabled = false; button.textContent = defaultText; }
    }
  }

  async function submitSuggestion(event) {
    if (!shouldOverride()) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const notice = document.getElementById('suggestionsNotice');
    const user = await requireSignedInUser(notice);
    if (!user || state.isAdmin) return;
    const preview = state.suggestionPreview;
    if (!preview?.appId) {
      showNotice(notice, 'Сначала проверь Steam-ссылку.', 'error');
      return;
    }

    const submit = document.getElementById('suggestionSubmitButton');
    const comment = document.getElementById('suggestionComment');
    const minInput = document.getElementById('suggestionPlayersMin');
    const maxInput = document.getElementById('suggestionPlayersMax');
    const detectedMin = Number(preview.playersMin ?? preview.playerMinPlayers ?? preview.coopMinPlayers);
    const detectedMax = Number(preview.playersMax ?? preview.playerMaxPlayers ?? preview.coopMaxPlayers);
    const playersMin = Math.max(1, Math.min(256, Number(minInput?.value) || (Number.isFinite(detectedMin) ? detectedMin : 1)));
    const playersMax = Math.max(playersMin, Math.min(256, Number(maxInput?.value) || (Number.isFinite(detectedMax) ? detectedMax : playersMin)));
    const coopMin = Number(preview.coopMinPlayers);
    const coopMax = Number(preview.coopMaxPlayers);
    const defaultText = submit?.textContent || 'Отправить';
    if (submit) { submit.disabled = true; submit.textContent = 'Отправляем…'; }

    try {
      const { data, error } = await state.client.rpc('submit_game_suggestion', {
        p_steam_app_id: Number(preview.appId),
        p_title: preview.title,
        p_cover_url: preview.coverUrl || '',
        p_description: preview.description || '',
        p_comment: comment?.value.trim() || '',
        p_release_date: preview.releaseDate || null,
        p_release_date_text: preview.releaseDateText || '',
        p_coming_soon: preview.comingSoon === true,
        p_is_coop: preview.isCoop === true,
        p_coop_min_players: Number.isFinite(coopMin) && coopMin > 0 ? Math.trunc(coopMin) : null,
        p_coop_max_players: Number.isFinite(coopMax) && coopMax > 0 ? Math.trunc(coopMax) : null,
        p_players_min: Math.trunc(playersMin),
        p_players_max: Math.trunc(playersMax),
        p_player_count_source: preview.playerCountSource || preview.coopSource || ''
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      const status = result?.suggestion_status;
      let message = result?.was_created
        ? 'Предложение отправлено модератору.'
        : 'Эта игра уже была предложена и повторно не добавлена.';
      if (status === 'approved') message = 'Эта игра уже находится в рейтинге.';
      if (status === 'selected') message = 'Эта игра уже выбрана для стрима.';
      if (status === 'rejected') message = 'Эту игру уже рассматривали и отклонили.';
      if (['completed', 'archived'].includes(status)) message = 'Эта игра уже находится в истории предложки.';
      showNotice(notice, message, status === 'rejected' ? 'error' : 'success');
      document.getElementById('suggestionForm')?.reset();
      clearSuggestionPreview();
    } catch (error) {
      showNotice(notice, error?.message || 'Не удалось отправить предложение.', 'error');
    } finally {
      if (submit) { submit.textContent = defaultText; submit.disabled = !state.suggestionPreview; }
    }
  }

  function mediaIsVideo(file) {
    return String(file?.type || '').startsWith('video/') || /\.(?:mp4|webm|mov)$/i.test(String(file?.name || ''));
  }

  function mediaKey(file) {
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

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} КБ`;
    return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} МБ`;
  }

  function validateMediaFile(file) {
    if (!file) return 'Файл не выбран.';
    if (!(ALLOWED_MEDIA_MIME.has(file.type) || (!file.type && ALLOWED_MEDIA_EXT.test(file.name)))) return `Формат «${file.name}» не поддерживается.`;
    if (file.size > MAX_MEDIA_FILE_SIZE) return `«${file.name}» больше 100 МБ.`;
    return '';
  }

  function revokeMediaItem(item) {
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
  }

  function renderMediaFiles() {
    if (!shouldOverride()) return;
    const selected = document.getElementById('mediaSelected');
    const dropzone = document.getElementById('mediaDropzone');
    const submit = document.getElementById('mediaSubmitButton');
    const hint = document.getElementById('mediaSubmitHint');
    const title = document.getElementById('mediaSubmissionTitle');
    const count = state.mediaFiles.length;
    const hasTitle = Boolean(title?.value.trim());
    if (selected) selected.hidden = count === 0;
    dropzone?.classList.toggle('has-file', count > 0);
    if (submit) submit.disabled = state.mediaSubmitting || !isRealUser(state.session?.user) || count === 0 || !hasTitle;
    if (hint) {
      hint.textContent = count === 0
        ? 'Сначала выбери файлы и добавь название.'
        : !hasTitle
          ? `${count} ${count === 1 ? 'файл выбран' : count < 5 ? 'файла выбраны' : 'файлов выбраны'}. Осталось добавить название.`
          : `${count} ${count === 1 ? 'файл готов' : count < 5 ? 'файла готовы' : 'файлов готовы'} к отправке.`;
    }
    if (!selected) return;
    selected.innerHTML = state.mediaFiles.map(item => {
      const file = item.file;
      const preview = mediaIsVideo(file)
        ? `<video controls muted playsinline preload="metadata" src="${escapeHtml(item.previewUrl)}"></video>`
        : `<img alt="${escapeHtml(file.name)}" src="${escapeHtml(item.previewUrl)}">`;
      return `<article class="media-selected-item">
        <div class="media-selected-preview">${preview}</div>
        <div class="media-selected-copy"><strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong><small>${mediaIsVideo(file) ? 'Видео' : 'Фото'} · ${escapeHtml(formatBytes(file.size))}</small></div>
        <div class="media-selected-actions"><button data-media-fix-replace="${escapeHtml(item.id)}" type="button">Заменить</button><button class="danger" data-media-fix-remove="${escapeHtml(item.id)}" type="button">Удалить</button></div>
      </article>`;
    }).join('');
  }

  function addMediaFiles(fileList) {
    const notice = document.getElementById('mediaNotice');
    const incoming = [...(fileList || [])];
    const errors = [];
    const existing = new Set(state.mediaFiles.map(item => mediaKey(item.file)));

    if (state.replacingMediaId) {
      const file = incoming[0];
      const error = validateMediaFile(file);
      const index = state.mediaFiles.findIndex(item => item.id === state.replacingMediaId);
      if (error) errors.push(error);
      else if (index >= 0 && !state.mediaFiles.some((item, itemIndex) => itemIndex !== index && mediaKey(item.file) === mediaKey(file))) {
        revokeMediaItem(state.mediaFiles[index]);
        state.mediaFiles[index] = { id: state.replacingMediaId, file, previewUrl: URL.createObjectURL(file) };
      }
      state.replacingMediaId = null;
    } else {
      for (const file of incoming) {
        if (state.mediaFiles.length >= MAX_MEDIA_FILES) {
          errors.push(`За одну отправку можно выбрать не более ${MAX_MEDIA_FILES} файлов.`);
          break;
        }
        const error = validateMediaFile(file);
        if (error) { errors.push(error); continue; }
        const key = mediaKey(file);
        if (existing.has(key)) continue;
        state.mediaFiles.push({
          id: window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          file,
          previewUrl: URL.createObjectURL(file)
        });
        existing.add(key);
      }
    }

    const input = document.getElementById('mediaFileInput');
    if (input) input.value = '';
    const title = document.getElementById('mediaSubmissionTitle');
    if (title && !title.value.trim() && state.mediaFiles[0]?.file?.name) {
      title.value = state.mediaFiles[0].file.name.replace(/\.[^.]+$/, '').slice(0, 120);
    }
    renderMediaFiles();
    if (errors.length) showNotice(notice, [...new Set(errors)].join(' '), 'error');
  }

  function clearMediaFiles() {
    state.mediaFiles.forEach(revokeMediaItem);
    state.mediaFiles = [];
    state.replacingMediaId = null;
    const input = document.getElementById('mediaFileInput');
    if (input) input.value = '';
    renderMediaFiles();
  }

  async function rollbackMedia(submissionId, uploadedPaths) {
    if (!state.client) return;
    if (uploadedPaths.length) {
      try { await state.client.storage.from('stream-submissions').remove(uploadedPaths); } catch {}
    }
    if (submissionId) {
      try { await state.client.from('media_submissions').delete().eq('id', submissionId); } catch {}
    }
  }

  async function submitMedia(event) {
    if (!shouldOverride()) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const notice = document.getElementById('mediaNotice');
    const user = await requireSignedInUser(notice);
    if (!user || state.isAdmin) return;
    if (!state.mediaFiles.length) {
      showNotice(notice, 'Сначала выбери хотя бы один файл.', 'error');
      return;
    }

    const titleInput = document.getElementById('mediaSubmissionTitle');
    const commentInput = document.getElementById('mediaSubmissionComment');
    const submit = document.getElementById('mediaSubmitButton');
    const title = titleInput?.value.trim() || state.mediaFiles[0]?.file?.name?.replace(/\.[^.]+$/, '').slice(0, 120) || 'Материал';
    const hasVideo = state.mediaFiles.some(item => mediaIsVideo(item.file));
    const hasPhoto = state.mediaFiles.some(item => !mediaIsVideo(item.file));
    const mediaType = hasVideo && hasPhoto ? 'mixed' : hasVideo ? 'video' : 'photo';
    let submissionId = null;
    const uploadedPaths = [];
    const defaultText = submit?.textContent || 'Отправить';
    state.mediaSubmitting = true;
    if (submit) { submit.disabled = true; submit.textContent = 'Подготавливаем…'; }

    try {
      const { data: submission, error: submissionError } = await state.client
        .from('media_submissions')
        .insert({
          title,
          comment: commentInput?.value.trim() || '',
          media_type: mediaType,
          category: document.getElementById('mediaForm')?.dataset.category || 'personal',
          status: 'pending',
          created_by: user.id
        })
        .select('id')
        .single();
      if (submissionError) throw submissionError;
      submissionId = submission.id;

      const rows = [];
      for (let index = 0; index < state.mediaFiles.length; index += 1) {
        const file = state.mediaFiles[index].file;
        const unique = window.crypto?.randomUUID?.() || `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`;
        const path = `${user.id}/${submissionId}/${unique}-${safeFileName(file.name)}`;
        if (submit) submit.textContent = `Загружаем ${index + 1} из ${state.mediaFiles.length}…`;
        const { error: uploadError } = await state.client.storage.from('stream-submissions').upload(path, file, {
          cacheControl: '3600', contentType: file.type || undefined, upsert: false
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
      document.getElementById('mediaForm')?.reset();
      clearMediaFiles();
      showNotice(notice, 'Материал отправлен в очередь управления.', 'success');
    } catch (error) {
      await rollbackMedia(submissionId, uploadedPaths);
      showNotice(notice, error?.message || 'Не удалось загрузить материал.', 'error');
    } finally {
      state.mediaSubmitting = false;
      if (submit) submit.textContent = defaultText;
      renderMediaFiles();
    }
  }

  function syncNonAdminControls() {
    if (!shouldOverride()) return;
    const signedIn = isRealUser(state.session?.user);
    const suggestionSubmit = document.getElementById('suggestionSubmitButton');
    if (suggestionSubmit && state.suggestionPreview) suggestionSubmit.disabled = !signedIn;
    renderMediaFiles();
  }

  function bind() {
    if (state.bound) return;
    state.bound = true;

    document.getElementById('suggestionPreviewButton')?.addEventListener('click', previewSuggestion, true);
    document.getElementById('suggestionForm')?.addEventListener('submit', submitSuggestion, true);

    const mediaInput = document.getElementById('mediaFileInput');
    mediaInput?.addEventListener('change', event => {
      if (!shouldOverride()) return;
      event.stopImmediatePropagation();
      addMediaFiles(event.target.files);
    }, true);

    document.getElementById('mediaSubmissionTitle')?.addEventListener('input', event => {
      if (!shouldOverride()) return;
      event.stopImmediatePropagation();
      renderMediaFiles();
    }, true);

    document.getElementById('mediaDropzone')?.addEventListener('drop', event => {
      if (!shouldOverride()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      addMediaFiles(event.dataTransfer?.files);
    }, true);

    document.getElementById('mediaSelected')?.addEventListener('click', event => {
      if (!shouldOverride()) return;
      const remove = event.target.closest('[data-media-fix-remove]');
      const replace = event.target.closest('[data-media-fix-replace]');
      if (!remove && !replace) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (remove) {
        const index = state.mediaFiles.findIndex(item => item.id === remove.dataset.mediaFixRemove);
        if (index >= 0) {
          revokeMediaItem(state.mediaFiles[index]);
          state.mediaFiles.splice(index, 1);
          renderMediaFiles();
        }
      } else {
        state.replacingMediaId = replace.dataset.mediaFixReplace;
        mediaInput?.click();
      }
    }, true);

    document.getElementById('mediaForm')?.addEventListener('submit', submitMedia, true);

    refreshAccess();
    const client = configuredClient();
    client?.auth?.onAuthStateChange?.(() => window.setTimeout(refreshAccess, 0));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
