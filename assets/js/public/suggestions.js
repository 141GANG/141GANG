(() => {
  const elements = {
    panel: document.getElementById('suggestionsPanel'),
    close: document.getElementById('suggestionsClose'),
    triggers: [...document.querySelectorAll('.suggestions-trigger')],
    tabs: [...document.querySelectorAll('[data-suggestions-tab]')],
    views: [...document.querySelectorAll('[data-suggestions-panel]')],
    notice: document.getElementById('suggestionsNotice'),
    sort: document.getElementById('suggestionsSort'),
    grid: document.getElementById('suggestionsGrid'),
    form: document.getElementById('suggestionForm'),
    steamUrl: document.getElementById('suggestionSteamUrl'),
    previewButton: document.getElementById('suggestionPreviewButton'),
    preview: document.getElementById('suggestionPreview'),
    previewImage: document.getElementById('suggestionPreviewImage'),
    previewTitle: document.getElementById('suggestionPreviewTitle'),
    previewText: document.getElementById('suggestionPreviewText'),
    comment: document.getElementById('suggestionComment'),
    submitButton: document.getElementById('suggestionSubmitButton'),
    commentsPanel: document.getElementById('suggestionCommentsPanel'),
    commentsClose: document.getElementById('suggestionCommentsClose'),
    commentsTitle: document.getElementById('suggestionCommentsTitle'),
    commentsKicker: document.querySelector('#suggestionCommentsPanel .suggestion-comments-dialog > span'),
    commentsList: document.getElementById('suggestionCommentsList'),
    commentForm: document.getElementById('suggestionCommentForm'),
    commentBody: document.getElementById('suggestionCommentBody'),
    commentDelete: document.getElementById('suggestionCommentDelete'),
    moderationList: document.getElementById('suggestionModerationList'),
    moderationRefresh: document.getElementById('suggestionModerationRefresh'),
    moderationFilters: [...document.querySelectorAll('[data-suggestion-status]')],
    pendingCount: document.getElementById('suggestionPendingCount'),
    adminOnly: [...document.querySelectorAll('[data-suggestions-admin-only]')],
    moderationSearch: document.getElementById('proposalGameSearch'),
    moderationSort: document.getElementById('proposalGameSort'),
    releaseFilters: [...document.querySelectorAll('[data-proposal-release]')],
    playersMin: document.getElementById('proposalPlayersMin'),
    playersMax: document.getElementById('proposalPlayersMax'),
    filtersReset: document.getElementById('proposalFiltersReset')
  };

  if (!elements.panel) return;

  const suggestionState = {
    client: null,
    games: [],
    preview: null,
    activeSuggestionId: null,
    commentMode: 'public',
    noticeTimer: null,
    moderation: [],
    moderationStatus: 'pending',
    moderationQuery: '',
    moderationSort: 'oldest',
    isAdmin: false,
    eventsBound: false,
    started: false,
    localMode: window.location.protocol === 'file:'
  };

  const LOCAL_SUGGESTIONS_KEY = 'cr7-local-game-suggestions-v2';

  function readLocalSuggestions() {
    try {
      const value = JSON.parse(window.localStorage.getItem(LOCAL_SUGGESTIONS_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function writeLocalSuggestions(items) {
    try {
      window.localStorage.setItem(LOCAL_SUGGESTIONS_KEY, JSON.stringify(Array.isArray(items) ? items : []));
    } catch (error) {
      console.warn('Не удалось сохранить локальную очередь игр:', error);
    }
  }

  function localSuggestionPreview(steamUrl) {
    const appId = parseSteamAppId(steamUrl);
    const minInput = document.getElementById('suggestionPlayersMin');
    const maxInput = document.getElementById('suggestionPlayersMax');
    const min = Math.max(1, Math.min(256, Number(minInput?.value) || 1));
    const max = Math.max(min, Math.min(256, Number(maxInput?.value) || min));
    return {
      appId,
      title: `Steam App ${appId}`,
      coverUrl: '',
      description: 'Локальная тестовая заявка. Полные данные Steam будут доступны после подключения backend.',
      playersMin: min,
      playersMax: max,
      isCoop: max > 1,
      coopMinPlayers: max > 1 ? min : null,
      coopMaxPlayers: max > 1 ? max : null,
      releaseDate: null,
      releaseDateText: '',
      comingSoon: false,
      playerCountSource: 'local'
    };
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

  function safeUrl(value, allowedHosts = []) {
    try {
      const url = new URL(String(value || ''));
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      if (allowedHosts.length && !allowedHosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return '';
      return url.href;
    } catch {
      return '';
    }
  }

  function publishedCatalogActive() {
    return elements.moderationList?.closest('#adminSection')?.dataset.catalogTab === 'true';
  }

  function configuredClient() {
    const config = window.CR7_CONFIG || {};
    const url = String(config.supabaseUrl || '');
    const key = String(config.supabasePublishableKey || '');
    if (!window.supabase?.createClient || !url.startsWith('https://') || !key) return null;
    if (window.CR7_SUPABASE_CLIENT) return window.CR7_SUPABASE_CLIENT;
    window.CR7_SUPABASE_CLIENT = window.supabase.createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    return window.CR7_SUPABASE_CLIENT;
  }

  async function invokeSteamFunction(body, timeoutMs = 30000) {
    const config = window.CR7_CONFIG || {};
    const supabaseUrl = String(config.supabaseUrl || '').replace(/\/$/, '');
    const publishableKey = String(config.supabasePublishableKey || '');
    const publicPreview = body?.action === 'suggestion-preview';

    if (!supabaseUrl || !publishableKey) {
      throw new Error('Steam backend не настроен.');
    }

    let accessToken = window.CR7_AUTH?.getCachedAccessToken?.() || '';
    if (!accessToken && suggestionState.client && !(publicPreview && suggestionState.localMode)) {
      try {
        const sessionResult = await Promise.race([
          window.CR7_AUTH?.getUsableSession
            ? window.CR7_AUTH.getUsableSession(suggestionState.client)
            : suggestionState.client.auth.getSession(),
          new Promise((_, reject) => window.setTimeout(
            () => reject(new Error('Не удалось проверить сессию.')),
            publicPreview ? 2500 : 5000
          ))
        ]);
        if (!sessionResult?.error) {
          accessToken = sessionResult?.data?.session?.access_token || '';
          window.CR7_AUTH?.cacheSession?.(sessionResult?.data?.session || null);
        } else if (!publicPreview) {
          throw sessionResult.error;
        }
      } catch (error) {
        if (!publicPreview) throw error;
      }
    }

    if (!accessToken && !publicPreview) {
      throw new Error('Сессия истекла. Войди в аккаунт заново.');
    }

    const headers = {
      apikey: publishableKey,
      'Content-Type': 'application/json'
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/steam-game`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const responseText = await response.text();
      let data = null;
      try {
        data = responseText ? JSON.parse(responseText) : null;
      } catch {
        data = null;
      }
      if (!response.ok) {
        const error = new Error(data?.error || `Сервер публикации ответил с кодом ${response.status}.`);
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error('Сервер публикации не ответил за 30 секунд. Попробуй ещё раз.');
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  window.CR7_INVOKE_STEAM_FUNCTION = invokeSteamFunction;

  function errorMessage(error, fallback = 'Не удалось выполнить действие.') {
    const message = String(error?.message || error?.error_description || fallback);
    if (/anonymous sign-?ins?.*(disabled|not enabled)|anonymous provider.*disabled/i.test(message)) {
      return 'Анонимные действия пока выключены. Включи Anonymous Sign-Ins в Supabase Authentication.';
    }
    if (/set_suggestion_reaction|my_reaction|like_count|dislike_count/i.test(message)) {
      return 'Реакции ещё не подключены к базе. Выполни supabase/suggestion_reactions.sql в Supabase SQL Editor.';
    }
    if (/steam_snapshot_synced_at|players_min|players_max|release_date_text|coop_min_players|coop_max_players/i.test(message)) {
      return 'Steam-данные заявок ещё не обновлены в базе. Выполни supabase/suggestion_steam_snapshot.sql.';
    }
    if (/get_public_game_suggestions|submit_game_suggestion|schema cache|PGRST202|42883/i.test(message)) {
      return 'Система предложений ещё не подключена к базе. Выполни supabase/game_suggestions.sql.';
    }
    if (/только администратор|недостаточно прав|site_admin/i.test(message)) {
      return 'Это действие доступно только администратору.';
    }
    return message;
  }

  function showNotice(message, type = 'info') {
    clearTimeout(suggestionState.noticeTimer);
    elements.notice.textContent = message;
    elements.notice.className = `suggestions-notice show ${type}`;
    suggestionState.noticeTimer = setTimeout(() => {
      elements.notice.className = 'suggestions-notice';
    }, 5500);
  }

  function setBusy(button, busy, busyText = 'Подождите…') {
    if (!button) return;
    if (!button.dataset.defaultText) button.dataset.defaultText = button.textContent;
    button.disabled = busy;
    button.textContent = busy ? busyText : button.dataset.defaultText;
  }

  function setTab(name) {
    const target = name === 'submit' && suggestionState.isAdmin ? 'submit' : 'rating';
    elements.tabs.forEach(button => button.classList.toggle('active', button.dataset.suggestionsTab === target));
    elements.views.forEach(view => {
      const active = view.dataset.suggestionsPanel === target;
      view.classList.toggle('active', active);
      view.hidden = !active;
    });
    if (target === 'rating') loadPublicSuggestions();
  }

  function openPanel(view = 'rating') {
    if (suggestionState.localMode) suggestionState.isAdmin = true;
    const requestedAdminView = view === 'submit' && !suggestionState.isAdmin;
    elements.panel.hidden = false;
    elements.panel.setAttribute('aria-hidden', 'false');
    elements.triggers.forEach(trigger => trigger.setAttribute('aria-expanded', 'true'));
    document.documentElement.classList.add('suggestions-open');
    setTab(view);
    if (requestedAdminView) showNotice('Предлагать игры может только администратор.', 'error');
    window.setTimeout(() => (view === 'submit' && suggestionState.isAdmin ? elements.steamUrl : elements.close)?.focus(), 30);
  }

  function closePanel() {
    if (!elements.commentsPanel.hidden) closeComments();
    elements.panel.hidden = true;
    elements.panel.setAttribute('aria-hidden', 'true');
    elements.triggers.forEach(trigger => trigger.setAttribute('aria-expanded', 'false'));
    document.documentElement.classList.remove('suggestions-open');
  }

  async function ensureViewerSession() {
    if (!suggestionState.client) throw new Error('Supabase не настроен.');
    const { data, error } = await suggestionState.client.auth.getSession();
    if (error) throw error;
    if (data?.session?.user) return data.session;
    const result = await suggestionState.client.auth.signInAnonymously();
    if (result.error) throw result.error;
    if (!result.data?.session) throw new Error('Не удалось создать анонимную сессию.');
    return result.data.session;
  }

  async function requireAdminSession() {
    if (!suggestionState.client) throw new Error('Supabase не настроен.');
    if (!suggestionState.isAdmin) throw new Error('Это действие доступно только администратору.');
    const { data, error } = await suggestionState.client.auth.getSession();
    if (error) throw error;
    if (!data?.session?.user) throw new Error('Войди в аккаунт администратора.');
    return data.session;
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

  function clearPreview() {
    suggestionState.preview = null;
    elements.preview.hidden = true;
    elements.comment.disabled = true;
    elements.submitButton.disabled = true;
    elements.previewImage.removeAttribute('src');
    setSuggestionPlayerRange(null);
  }

  function setSuggestionPlayerRange(game) {
    const minInput = document.getElementById('suggestionPlayersMin');
    const maxInput = document.getElementById('suggestionPlayersMax');
    if (!minInput || !maxInput) return;

    if (!game) {
      minInput.value = '';
      maxInput.value = '';
      return;
    }

    const detectedMin = Number(game.playersMin ?? game.playerMinPlayers);
    const detectedMax = Number(game.playersMax ?? game.playerMaxPlayers ?? game.coopMaxPlayers);
    const fallbackMax = Number(game.isCoop ? game.coopMaxPlayers : 1) || (game.isCoop ? 2 : 1);
    const min = Number.isFinite(detectedMin) && detectedMin >= 1 ? detectedMin : 1;
    const max = Number.isFinite(detectedMax) && detectedMax >= min ? detectedMax : Math.max(min, fallbackMax);

    minInput.value = String(Math.min(256, Math.trunc(min)));
    maxInput.value = String(Math.min(256, Math.trunc(max)));
    minInput.dispatchEvent(new Event('input', { bubbles: true }));
    maxInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function applyAdminAccess() {
    elements.adminOnly.forEach(element => {
      element.hidden = !suggestionState.isAdmin;
      element.setAttribute('aria-hidden', suggestionState.isAdmin ? 'false' : 'true');
    });
    if (!suggestionState.isAdmin && !elements.views.find(view => view.dataset.suggestionsPanel === 'submit')?.hidden) {
      setTab('rating');
    }
    renderPublicSuggestions();
  }

  async function previewSteamGame() {
    if (!suggestionState.isAdmin && !suggestionState.localMode) {
      showNotice('Проверять и предлагать игры может только администратор.', 'error');
      return;
    }
    const steamUrl = elements.steamUrl.value.trim();
    if (!parseSteamAppId(steamUrl)) {
      clearPreview();
      showNotice('Вставь ссылку вида store.steampowered.com/app/12345/.', 'error');
      return;
    }

    setBusy(elements.previewButton, true, 'Ищем…');
    try {
      let data = null;

      if (suggestionState.localMode) {
        try {
          data = await invokeSteamFunction({ action: 'suggestion-preview', steamUrl });
        } catch (error) {
          console.info('Steam preview недоступен в локальном режиме, используем fallback:', error);
        }
        if (!data?.appId || !data?.title) data = localSuggestionPreview(steamUrl);
      } else {
        await requireAdminSession();
        data = await invokeSteamFunction({ action: 'suggestion-preview', steamUrl });
      }

      if (data?.error) throw new Error(data.error);
      if (!data?.appId || !data?.title) throw new Error('Steam не вернул данные игры.');

      suggestionState.preview = data;
      setSuggestionPlayerRange(data);
      elements.previewTitle.textContent = data.title;
      elements.previewText.textContent = data.description || 'Описание в Steam не указано.';
      const cover = safeUrl(data.coverUrl);
      if (cover) elements.previewImage.src = cover;
      else elements.previewImage.src = './assets/images/figma/game-placeholder.svg';
      elements.previewImage.alt = `Обложка ${data.title}`;
      elements.preview.hidden = false;
      elements.comment.disabled = false;
      elements.submitButton.disabled = false;
      showNotice(
        suggestionState.localMode && data.playerCountSource === 'local'
          ? 'Локальный режим: заявка готова. Мин/макс можно указать вручную.'
          : 'Игра найдена. Можно добавить комментарий и отправить.',
        'success'
      );
    } catch (error) {
      clearPreview();
      showNotice(errorMessage(error, 'Не удалось получить данные из Steam.'), 'error');
    } finally {
      setBusy(elements.previewButton, false);
    }
  }

  async function submitSuggestion(event) {
    event.preventDefault();
    if (!suggestionState.isAdmin && !suggestionState.localMode) {
      showNotice('Предлагать игры может только администратор.', 'error');
      return;
    }
    const preview = suggestionState.preview;
    if (!preview?.appId) {
      showNotice('Сначала проверь Steam-ссылку.', 'error');
      return;
    }

    setBusy(elements.submitButton, true, 'Отправляем…');
    try {
      const minInput = document.getElementById('suggestionPlayersMin');
      const maxInput = document.getElementById('suggestionPlayersMax');
      const detectedMin = Number(preview.playersMin ?? preview.playerMinPlayers ?? preview.coopMinPlayers);
      const detectedMax = Number(preview.playersMax ?? preview.playerMaxPlayers ?? preview.coopMaxPlayers);
      const playersMin = Math.max(1, Math.min(256, Number(minInput?.value) || (Number.isFinite(detectedMin) ? detectedMin : 1)));
      const playersMax = Math.max(playersMin, Math.min(256, Number(maxInput?.value) || (Number.isFinite(detectedMax) ? detectedMax : playersMin)));
      const coopMin = Number(preview.coopMinPlayers);
      const coopMax = Number(preview.coopMaxPlayers);

      if (suggestionState.localMode) {
        const now = new Date().toISOString();
        const steamUrl = elements.steamUrl.value.trim();
        const comment = elements.comment.value.trim();
        const localItems = readLocalSuggestions();
        const existingIndex = localItems.findIndex(item => Number(item.steam_app_id) === Number(preview.appId) && item.status === 'pending');
        const item = {
          id: existingIndex >= 0 ? localItems[existingIndex].id : -Date.now(),
          steam_app_id: Number(preview.appId),
          steam_url: steamUrl,
          title: preview.title,
          cover_url: preview.coverUrl || '',
          description: preview.description || '',
          status: 'pending',
          rejection_reason: '',
          created_at: existingIndex >= 0 ? localItems[existingIndex].created_at : now,
          updated_at: now,
          release_date: preview.releaseDate || null,
          release_date_text: preview.releaseDateText || '',
          coming_soon: preview.comingSoon === true,
          is_coop: preview.isCoop === true || playersMax > 1,
          coop_min_players: Number.isFinite(coopMin) && coopMin > 0 ? Math.trunc(coopMin) : (playersMax > 1 ? Math.trunc(playersMin) : null),
          coop_max_players: Number.isFinite(coopMax) && coopMax > 0 ? Math.trunc(coopMax) : (playersMax > 1 ? Math.trunc(playersMax) : null),
          players_min: Math.trunc(playersMin),
          players_max: Math.trunc(playersMax),
          player_count_source: preview.playerCountSource || preview.coopSource || 'local',
          steam_snapshot_synced_at: preview.playerCountSource === 'local' ? null : now,
          suggestion_votes: [],
          suggestion_comments: comment ? [{
            id: -(Date.now() + 1),
            body: comment,
            is_hidden: false,
            created_at: now
          }] : []
        };

        if (existingIndex >= 0) localItems[existingIndex] = item;
        else localItems.unshift(item);
        writeLocalSuggestions(localItems);
        suggestionState.moderation = localItems;
        renderModeration();
        showNotice(existingIndex >= 0 ? 'Локальная заявка обновлена.' : 'Локальная заявка добавлена в «На рассмотрении».', 'success');
        elements.form.reset();
        clearPreview();
        return;
      }

      await requireAdminSession();
      const { data, error } = await suggestionState.client.rpc('submit_game_suggestion', {
        p_steam_app_id: Number(preview.appId),
        p_title: preview.title,
        p_cover_url: preview.coverUrl || '',
        p_description: preview.description || '',
        p_comment: elements.comment.value.trim(),
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
      if (status === 'approved') message = 'Эта игра уже находится в рейтинге. Открой рейтинг и оцени её.';
      if (status === 'selected') message = 'Эта игра уже выбрана для стрима.';
      if (status === 'rejected') message = 'Эту игру уже рассматривали и отклонили.';
      if (['completed', 'archived'].includes(status)) message = 'Эта игра уже находится в истории предложки.';
      showNotice(message, status === 'rejected' ? 'error' : 'success');
      elements.form.reset();
      clearPreview();
      if (['approved', 'selected'].includes(status)) setTab('rating');
    } catch (error) {
      showNotice(errorMessage(error), 'error');
    } finally {
      setBusy(elements.submitButton, false);
      elements.submitButton.disabled = !suggestionState.preview;
    }
  }

  function publicSort(games) {
    const items = [...games];
    const selectedFirst = (a, b) => Number(b.status === 'selected') - Number(a.status === 'selected');
    const likes = game => Number(game.like_count ?? game.vote_count) || 0;
    const dislikes = game => Number(game.dislike_count) || 0;
    const reactions = game => likes(game) + dislikes(game);
    const approval = game => {
      const total = reactions(game);
      if (!total) return 0;
      const stored = Number(game.approval_percent);
      return Number.isFinite(stored) ? stored : likes(game) / total * 100;
    };
    if (elements.sort.value === 'newest') {
      return items.sort((a, b) => selectedFirst(a, b) || new Date(b.created_at) - new Date(a.created_at));
    }
    if (elements.sort.value === 'comments') {
      return items.sort((a, b) =>
        selectedFirst(a, b)
        || Number(b.comment_count) - Number(a.comment_count)
        || approval(b) - approval(a)
        || reactions(b) - reactions(a)
      );
    }
    if (elements.sort.value === 'activity') {
      return items.sort((a, b) =>
        selectedFirst(a, b)
        || reactions(b) - reactions(a)
        || approval(b) - approval(a)
        || new Date(a.created_at) - new Date(b.created_at)
      );
    }
    return items.sort((a, b) =>
      selectedFirst(a, b)
      || approval(b) - approval(a)
      || reactions(b) - reactions(a)
      || likes(b) - likes(a)
      || new Date(a.created_at) - new Date(b.created_at)
    );
  }

  function renderPublicSuggestions() {
    const games = publicSort(suggestionState.games);
    if (!games.length) {
      elements.grid.innerHTML = '<div class="suggestions-empty"><strong>Рейтинг пока пуст</strong><br>Предложи первую игру — после проверки модератором она появится здесь.</div>';
      return;
    }

    elements.grid.innerHTML = games.map((game, index) => {
      const cover = safeUrl(game.cover_url);
      const steam = safeUrl(game.steam_url, ['steampowered.com', 'steamcommunity.com']);
      const selected = game.status === 'selected';
      const likeCount = Number(game.like_count ?? game.vote_count) || 0;
      const dislikeCount = Number(game.dislike_count) || 0;
      const reactionCount = likeCount + dislikeCount;
      const storedPercent = Number(game.approval_percent);
      const approvalPercent = reactionCount
        ? Math.max(0, Math.min(100, Number.isFinite(storedPercent) ? storedPercent : likeCount / reactionCount * 100))
        : 0;
      const approvalLabel = reactionCount
        ? `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(approvalPercent)}%`
        : '—';
      const currentReaction = Number(game.my_reaction ?? (game.has_voted ? 1 : 0)) || 0;
      const reactionDisabled = selected ? 'disabled' : '';
      return `
        <article class="suggestion-card${selected ? ' is-selected' : ''}" data-suggestion-id="${Number(game.id)}">
          <div class="suggestion-rank">${selected ? '◆' : `#${index + 1}`}</div>
          <img class="suggestion-cover" src="${escapeHtml(cover || './assets/images/figma/game-placeholder.svg')}" alt="Обложка ${escapeHtml(game.title)}" loading="lazy" referrerpolicy="no-referrer">
          <div class="suggestion-card-copy">
            ${selected ? '<span>Выбрано для стрима</span>' : ''}
            <h4>${steam ? `<a href="${escapeHtml(steam)}" target="_blank" rel="noopener noreferrer">${escapeHtml(game.title)} ↗</a>` : escapeHtml(game.title)}</h4>
            <p>${escapeHtml(game.description || 'Описание не указано.')}</p>
            <div class="suggestion-stats"><span>Всего оценок: ${reactionCount}</span><span>◌ ${Number(game.comment_count) || 0} комментариев</span></div>
          </div>
          <div class="suggestion-card-actions">
            <div class="suggestion-approval" aria-label="${reactionCount ? `${approvalLabel} положительных оценок` : 'Оценок пока нет'}">
              <strong>${approvalLabel}</strong>
              <span>${reactionCount ? 'хотят увидеть' : 'нет оценок'}</span>
              <div class="suggestion-approval-bar" style="--approval:${approvalPercent}%"><i></i></div>
            </div>
            <div aria-label="Оценить игру ${escapeHtml(game.title)}" class="suggestion-reactions" role="group">
              <button aria-label="Поставить лайк игре ${escapeHtml(game.title)}" aria-pressed="${currentReaction === 1}" class="suggestion-reaction is-like${currentReaction === 1 ? ' active' : ''}" data-suggestion-reaction="1" ${reactionDisabled} type="button"><span aria-hidden="true">👍</span><b>${likeCount}</b></button>
              <button aria-label="Поставить дизлайк игре ${escapeHtml(game.title)}" aria-pressed="${currentReaction === -1}" class="suggestion-reaction is-dislike${currentReaction === -1 ? ' active' : ''}" data-suggestion-reaction="-1" ${reactionDisabled} type="button"><span aria-hidden="true">👎</span><b>${dislikeCount}</b></button>
            </div>
            <button class="suggestion-comments-button" data-suggestion-comments type="button">Комментарии · ${Number(game.comment_count) || 0}</button>
          </div>
        </article>`;
    }).join('');
  }

  async function loadPublicSuggestions() {
    if (!suggestionState.client) return;
    elements.grid.innerHTML = '<div class="suggestions-empty">Загружаем рейтинг…</div>';
    try {
      const { data, error } = await suggestionState.client.rpc('get_public_game_suggestions');
      if (error) throw error;
      suggestionState.games = Array.isArray(data) ? data : [];
      renderPublicSuggestions();
    } catch (error) {
      elements.grid.innerHTML = `<div class="suggestions-empty">${escapeHtml(errorMessage(error, 'Не удалось загрузить рейтинг.'))}</div>`;
    }
  }

  async function setReaction(id, reaction, button) {
    const card = button.closest('[data-suggestion-id]');
    const controls = card ? [...card.querySelectorAll('[data-suggestion-reaction]')] : [button];
    controls.forEach(control => { control.disabled = true; });
    try {
      await ensureViewerSession();
      const { data, error } = await suggestionState.client.rpc('set_suggestion_reaction', {
        p_suggestion_id: Number(id),
        p_reaction: Number(reaction)
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      const game = suggestionState.games.find(item => String(item.id) === String(id));
      if (game) {
        game.my_reaction = Number(result?.current_reaction) || 0;
        game.like_count = Number(result?.like_count) || 0;
        game.dislike_count = Number(result?.dislike_count) || 0;
        game.approval_percent = Number(result?.approval_percent) || 0;
      }
      renderPublicSuggestions();
      const current = Number(result?.current_reaction) || 0;
      showNotice(current === 1 ? 'Лайк учтён.' : current === -1 ? 'Дизлайк учтён.' : 'Оценка снята.', 'success');
    } catch (error) {
      showNotice(errorMessage(error), 'error');
      controls.forEach(control => { control.disabled = false; });
    }
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  }

  function commentAuthorInitial(username) {
    const first = Array.from(String(username || 'П').trim())[0] || 'П';
    return first.toLocaleUpperCase('ru-RU');
  }

  function adminSupporterCommentMarkup(comment, index, allowModeration = true) {
    const username = String(comment?.username || `Пользователь ${index + 1}`).trim() || `Пользователь ${index + 1}`;
    return `
      <article class="modal-comment-item admin-supporter-comment${comment.is_hidden ? ' is-hidden' : ''}">
        <span class="modal-comment-avatar admin-supporter-comment-avatar" aria-hidden="true">${escapeHtml(commentAuthorInitial(username))}</span>
        <div class="modal-comment-body admin-supporter-comment-content">
          <div class="modal-comment-head admin-supporter-comment-head">
            <strong>${escapeHtml(username)}</strong>
            ${allowModeration ? `<button class="admin-supporter-comment-toggle" data-admin-support-comment-id="${Number(comment.comment_id)}" data-admin-support-comment-hidden="${comment.is_hidden ? 'false' : 'true'}" type="button">${comment.is_hidden ? 'Вернуть' : 'Скрыть'}</button>` : ''}
          </div>
          <p data-comment-text>${escapeHtml(comment.body)}</p>
          <div class="modal-comment-meta admin-supporter-comment-meta">
            <time datetime="${escapeHtml(String(comment.created_at || ''))}">${escapeHtml(formatDate(comment.created_at))}</time>
          </div>
          ${comment.is_hidden ? '<small>Комментарий скрыт из публичного обсуждения.</small>' : ''}
        </div>
      </article>`;
  }

  function setCommentsMode(mode = 'public') {
    const adminSupporters = mode === 'admin-supporters';
    suggestionState.commentMode = adminSupporters ? 'admin-supporters' : 'public';
    elements.commentsPanel.classList.toggle('is-admin-supporters', adminSupporters);
    elements.commentForm.hidden = adminSupporters;
    if (elements.commentsKicker) {
      elements.commentsKicker.textContent = adminSupporters ? 'Комментарии предложивших' : 'Обсуждение игры';
    }
  }

  function proposalSupportCount(item) {
    const stored = Number(item?.support_count);
    if (Number.isFinite(stored) && stored >= 0) return Math.trunc(stored);
    const comments = Array.isArray(item?.suggestion_comments) ? item.suggestion_comments : [];
    return Math.max(1, comments.length);
  }

  function proposalSupportCommentCount(item) {
    const stored = Number(item?.supporter_comment_count);
    if (Number.isFinite(stored) && stored >= 0) return Math.trunc(stored);
    return Array.isArray(item?.suggestion_comments) ? item.suggestion_comments.length : 0;
  }

  async function loadComments(id) {
    elements.commentsList.innerHTML = '<div class="suggestions-empty">Загружаем комментарии…</div>';
    try {
      const { data, error } = await suggestionState.client.rpc('get_public_suggestion_comments', {
        p_suggestion_id: Number(id)
      });
      if (error) throw error;
      const comments = Array.isArray(data) ? data : [];
      const mine = comments.find(comment => comment.is_mine);
      elements.commentBody.value = mine?.body || '';
      elements.commentDelete.hidden = !mine;
      elements.commentsList.innerHTML = comments.length
        ? comments.map(comment => `
          <article class="suggestion-comment${comment.is_mine ? ' is-mine' : ''}">
            <header><strong>${comment.is_mine ? 'Вы' : 'Зритель'}</strong><time>${escapeHtml(formatDate(comment.created_at))}</time></header>
            <p>${escapeHtml(comment.body)}</p>
          </article>`).join('')
        : '<div class="suggestions-empty">Комментариев пока нет. Начни обсуждение.</div>';
    } catch (error) {
      elements.commentsList.innerHTML = `<div class="suggestions-empty">${escapeHtml(errorMessage(error))}</div>`;
    }
  }

  async function loadAdminSupporterComments(id) {
    const item = suggestionState.moderation.find(entry => String(entry.id) === String(id));
    elements.commentsList.innerHTML = '<div class="suggestions-empty">Загружаем комментарии…</div>';

    if (suggestionState.localMode) {
      const comments = (Array.isArray(item?.suggestion_comments) ? item.suggestion_comments : [])
        .filter(comment => String(comment?.body || '').trim());
      elements.commentsList.innerHTML = comments.length
        ? comments.map((comment, index) => adminSupporterCommentMarkup({
            ...comment,
            username: comment.username || `Пользователь ${index + 1}`
          }, index, false)).join('')
        : '<div class="suggestions-empty admin-supporter-comments-empty">Ни один из предложивших эту игру пользователей не оставил комментарий.</div>';
      return;
    }

    try {
      const { data, error } = await suggestionState.client.rpc('get_admin_suggestion_support_comments_v2', {
        p_suggestion_id: Number(id)
      });
      if (error) throw error;
      const comments = Array.isArray(data) ? data : [];
      elements.commentsList.innerHTML = comments.length
        ? comments.map((comment, index) => adminSupporterCommentMarkup(comment, index, true)).join('')
        : '<div class="suggestions-empty admin-supporter-comments-empty">Ни один из предложивших эту игру пользователей не оставил комментарий.</div>';
    } catch (error) {
      elements.commentsList.innerHTML = `<div class="suggestions-empty">${escapeHtml(errorMessage(error))}</div>`;
    }
  }

  function openComments(id) {
    const game = suggestionState.games.find(item => String(item.id) === String(id));
    if (!game) return;
    setCommentsMode('public');
    suggestionState.activeSuggestionId = Number(id);
    elements.commentsTitle.textContent = game.title;
    elements.commentsPanel.hidden = false;
    elements.commentsPanel.style.removeProperty('display');
    elements.commentsPanel.setAttribute('aria-hidden', 'false');
    loadComments(id);
    window.setTimeout(() => elements.commentsClose.focus(), 30);
  }

  function openAdminSupporterComments(id) {
    const item = suggestionState.moderation.find(entry => String(entry.id) === String(id));
    if (!item) return;
    setCommentsMode('admin-supporters');
    suggestionState.activeSuggestionId = Number(id);
    elements.commentsTitle.textContent = item.title || 'Комментарии';
    elements.commentsPanel.hidden = false;
    elements.commentsPanel.style.removeProperty('display');
    elements.commentsPanel.setAttribute('aria-hidden', 'false');
    loadAdminSupporterComments(id);
    window.setTimeout(() => elements.commentsClose.focus(), 30);
  }

  function closeComments() {
    elements.commentsPanel.hidden = true;
    elements.commentsPanel.setAttribute('aria-hidden', 'true');
    elements.commentsList.innerHTML = '';
    elements.commentBody.value = '';
    elements.commentDelete.hidden = true;
    setCommentsMode('public');
    suggestionState.activeSuggestionId = null;
  }

  async function saveComment(event) {
    event.preventDefault();
    if (suggestionState.commentMode !== 'public') return;
    const id = suggestionState.activeSuggestionId;
    const body = elements.commentBody.value.trim();
    if (!id || !body) return;
    const button = elements.commentForm.querySelector('button[type="submit"]');
    setBusy(button, true, 'Сохраняем…');
    try {
      await ensureViewerSession();
      const { error } = await suggestionState.client.rpc('upsert_suggestion_comment', {
        p_suggestion_id: Number(id),
        p_body: body
      });
      if (error) throw error;
      showNotice('Комментарий сохранён.', 'success');
      await Promise.all([loadComments(id), loadPublicSuggestions()]);
    } catch (error) {
      showNotice(errorMessage(error), 'error');
    } finally {
      setBusy(button, false);
    }
  }

  async function deleteMyComment() {
    if (suggestionState.commentMode !== 'public') return;
    const id = suggestionState.activeSuggestionId;
    if (!id || !window.confirm('Удалить ваш комментарий к этой игре?')) return;
    setBusy(elements.commentDelete, true, 'Удаляем…');
    try {
      await ensureViewerSession();
      const { error } = await suggestionState.client.rpc('delete_my_suggestion_comment', {
        p_suggestion_id: Number(id)
      });
      if (error) throw error;
      elements.commentBody.value = '';
      showNotice('Комментарий удалён.', 'success');
      await Promise.all([loadComments(id), loadPublicSuggestions()]);
    } catch (error) {
      showNotice(errorMessage(error), 'error');
    } finally {
      setBusy(elements.commentDelete, false);
    }
  }

  function moderationReactionStats(item) {
    const reactions = Array.isArray(item?.suggestion_votes) ? item.suggestion_votes : [];
    const likes = reactions.filter(entry => Number(entry.reaction) === 1).length;
    const dislikes = reactions.filter(entry => Number(entry.reaction) === -1).length;
    const total = likes + dislikes;
    return {
      likes,
      dislikes,
      percent: total ? Math.round(likes / total * 1000) / 10 : 0
    };
  }

  function moderationActions(item) {
    const actions = {
      pending: [['approve', 'Опубликовать'], ['delete', 'Удалить']],
      approved: [['select', 'Выбрать для стрима'], ['archive', 'В архив']],
      selected: [['complete', 'Отметить пройденной'], ['reopen', 'Вернуть в рейтинг']],
      rejected: [['approve', 'Одобрить'], ['archive', 'В архив']],
      completed: [['reopen', 'Вернуть в рейтинг'], ['archive', 'В архив']],
      archived: [['reopen', 'Вернуть в рейтинг']]
    };
    return (actions[item.status] || []).map(([action, label]) =>
      `<button data-action="${action}" data-suggestion-id="${Number(item.id)}" type="button">${label}${action === 'approve' ? ' <img alt="" aria-hidden="true" src="./assets/images/figma/arrow-circle-white.svg">' : ''}</button>`
    ).join('');
  }

  function moderationPlayersLabel(item) {
    const min = Number(item.players_min) || Number(item.coop_min_players) || (item.is_coop ? 2 : 1);
    const max = Number(item.players_max) || Number(item.coop_max_players) || min;
    if (max <= 1) return '1 игрок';
    if (min === max) return `${max} ${playerWord(max)}`;
    return `${min}–${max} ${playerWord(max)}`;
  }

  function moderationReleaseLabel(item) {
    if (!item.release_date) return item.coming_soon ? 'Скоро' : 'Без даты';
    const date = new Date(`${item.release_date}T12:00:00`);
    if (Number.isNaN(date.getTime())) return 'Без даты';
    return date > new Date()
      ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
      : 'Вышла';
  }

  function renderModeration() {
    if (!elements.moderationList || publishedCatalogActive()) return;
    const pending = suggestionState.moderation.filter(item => item.status === 'pending').length;
    if (elements.pendingCount) elements.pendingCount.textContent = String(pending);
    const query = suggestionState.moderationQuery.toLocaleLowerCase('ru-RU');
    const enabledReleaseGroups = new Set(elements.releaseFilters.filter(input => input.checked).map(input => input.dataset.proposalRelease));
    const minPlayers = Number(elements.playersMin?.value) || 0;
    const maxPlayers = Number(elements.playersMax?.value) || Number.MAX_SAFE_INTEGER;
    const items = suggestionState.moderation
      .filter(item => item.status === suggestionState.moderationStatus)
      .filter(item => !query || [item.title, item.description, item.steam_app_id].some(value => String(value || '').toLocaleLowerCase('ru-RU').includes(query)))
      .filter(item => {
        const releaseGroup = item.release_date
          ? (new Date(`${item.release_date}T12:00:00`) > new Date() ? 'upcoming' : 'released')
          : (item.coming_soon ? 'upcoming' : 'unknown');
        if (enabledReleaseGroups.size && !enabledReleaseGroups.has(releaseGroup)) return false;
        const players = Number(item.players_max) || Number(item.coop_max_players) || (item.is_coop ? 2 : 1);
        return players >= minPlayers && players <= maxPlayers;
      })
      .sort((a, b) => {
        if (suggestionState.moderationSort === 'title') return String(a.title || '').localeCompare(String(b.title || ''), 'ru-RU');
        const direction = suggestionState.moderationSort === 'newest' ? -1 : 1;
        return (new Date(a.created_at) - new Date(b.created_at)) * direction;
      });

    if (!items.length) {
      elements.moderationList.innerHTML = '<div class="suggestions-empty">В этом разделе нет заявок.</div>';
      return;
    }

    elements.moderationList.innerHTML = items.map(item => {
      const cover = safeUrl(item.cover_url);
      const steam = safeUrl(item.steam_url, ['steampowered.com', 'steamcommunity.com']);
      const reactions = moderationReactionStats(item);
      const supportCount = proposalSupportCount(item);
      const supporterCommentCount = proposalSupportCommentCount(item);
      return `
        <article class="moderation-card" data-suggestion-id="${Number(item.id)}">
          <div class="moderation-card-side">
            <img src="${escapeHtml(cover || './assets/images/figma/game-placeholder.svg')}" alt="Обложка ${escapeHtml(item.title)}">
            <div class="moderation-card-facts"><span class="moderation-players">${escapeHtml(moderationPlayersLabel(item))}</span><span class="moderation-release">${escapeHtml(moderationReleaseLabel(item))}</span></div>
          </div>
          <div class="moderation-card-copy">
            <h3><button class="moderation-title-open" data-supporter-comments data-suggestion-id="${Number(item.id)}" type="button">${escapeHtml(item.title)}</button></h3>
            <p class="moderation-description">${escapeHtml(item.description || 'Описание не указано.')}</p>
            <div class="moderation-card-meta"><span>Steam ID ${Number(item.steam_app_id)}</span><span>👍 ${reactions.likes}</span><span>👎 ${reactions.dislikes}</span><span>${reactions.likes + reactions.dislikes ? `${reactions.percent}% лайков` : 'Нет оценок'}</span><span>${escapeHtml(formatDate(item.created_at))}</span></div>
            ${item.rejection_reason ? `<p><strong>Причина:</strong> ${escapeHtml(item.rejection_reason)}</p>` : ''}
            <div class="moderation-support-panel">
              <div class="moderation-support-stats">
                <span>Голосов за игру: <strong>${supportCount}</strong></span>
              </div>
              <button class="moderation-support-comments-open" data-supporter-comments data-suggestion-id="${Number(item.id)}" type="button">
                <span>Комментарии</span>
                <b>${supporterCommentCount}</b>
                <img alt="" aria-hidden="true" src="./assets/images/figma/arrow-circle-white.svg">
              </button>
            </div>
            <div class="moderation-actions">${steam ? `<a class="moderation-steam" href="${escapeHtml(steam)}" target="_blank" rel="noopener noreferrer">Открыть Steam <img alt="" aria-hidden="true" src="./assets/images/figma/arrow-circle-white.svg"></a>` : ''}${moderationActions(item)}</div>
          </div>
        </article>`;
    }).join('');
  }

  async function checkAdminAndLoad() {
    if (suggestionState.localMode) {
      suggestionState.isAdmin = true;
      applyAdminAccess();
      await loadModeration();
      return;
    }
    if (!suggestionState.client || !elements.moderationList) return;
    try {
      const { data: sessionData } = await suggestionState.client.auth.getSession();
      if (!sessionData?.session?.user) {
        suggestionState.isAdmin = false;
        applyAdminAccess();
        if (!publishedCatalogActive()) elements.moderationList.innerHTML = '<div class="suggestions-empty">Войди, чтобы загрузить очередь.</div>';
        return;
      }
      const { data: isAdmin, error: adminError } = await suggestionState.client.rpc('is_site_admin');
      if (adminError || isAdmin !== true) {
        suggestionState.isAdmin = false;
        applyAdminAccess();
        if (!publishedCatalogActive()) elements.moderationList.innerHTML = '<div class="suggestions-empty">Очередь доступна администратору.</div>';
        return;
      }
      suggestionState.isAdmin = true;
      applyAdminAccess();
      await loadModeration();
    } catch (error) {
      suggestionState.isAdmin = false;
      applyAdminAccess();
      if (!publishedCatalogActive()) elements.moderationList.innerHTML = `<div class="suggestions-empty">${escapeHtml(errorMessage(error))}</div>`;
    }
  }

  function snapshotPayloadFromSteam(steam) {
    const detectedMin = Number(steam?.playersMin ?? steam?.playerMinPlayers ?? steam?.coopMinPlayers);
    const detectedMax = Number(steam?.playersMax ?? steam?.playerMaxPlayers ?? steam?.coopMaxPlayers);
    const playersMin = Math.max(1, Math.min(256, Number.isFinite(detectedMin) && detectedMin > 0 ? Math.trunc(detectedMin) : 1));
    const playersMax = Math.max(playersMin, Math.min(256, Number.isFinite(detectedMax) && detectedMax > 0 ? Math.trunc(detectedMax) : playersMin));
    const coopMin = Number(steam?.coopMinPlayers);
    const coopMax = Number(steam?.coopMaxPlayers);
    return {
      release_date: steam?.releaseDate || null,
      release_date_text: String(steam?.releaseDateText || '').slice(0, 120),
      coming_soon: steam?.comingSoon === true,
      is_coop: steam?.isCoop === true,
      coop_min_players: Number.isFinite(coopMin) && coopMin > 0 ? Math.trunc(coopMin) : null,
      coop_max_players: Number.isFinite(coopMax) && coopMax > 0 ? Math.trunc(coopMax) : null,
      players_min: playersMin,
      players_max: playersMax,
      player_count_source: String(steam?.playerCountSource || steam?.coopSource || '').slice(0, 120),
      steam_snapshot_synced_at: new Date().toISOString()
    };
  }

  async function hydrateMissingModerationSnapshots(items) {
    const missing = (Array.isArray(items) ? items : [])
      .filter(item => item?.steam_app_id && !item.steam_snapshot_synced_at)
      .slice(0, 12);
    if (!missing.length) return;

    for (let offset = 0; offset < missing.length; offset += 3) {
      const batch = missing.slice(offset, offset + 3);
      await Promise.allSettled(batch.map(async item => {
        const steam = await invokeSteamFunction({ action: 'suggestion-preview', appId: Number(item.steam_app_id) }, 20000);
        if (!steam?.appId) return;
        const payload = snapshotPayloadFromSteam(steam);
        const { error } = await suggestionState.client
          .from('game_suggestions')
          .update(payload)
          .eq('id', Number(item.id));
        if (error) throw error;
        Object.assign(item, payload);
      }));
    }
  }

  function localSuggestionNeedsSteamHydration(item) {
    if (!item?.steam_app_id) return false;
    const title = String(item.title || '');
    const description = String(item.description || '');
    return !item.steam_snapshot_synced_at
      || String(item.player_count_source || '') === 'local'
      || /^Steam App \d+$/i.test(title)
      || /Локальная тестовая заявка/i.test(description)
      || !String(item.cover_url || '').trim();
  }

  async function hydrateLocalModerationSnapshots(items) {
    const source = Array.isArray(items) ? items : [];
    const missing = source.filter(localSuggestionNeedsSteamHydration).slice(0, 18);
    if (!missing.length) return false;

    let changed = false;
    for (let offset = 0; offset < missing.length; offset += 3) {
      const batch = missing.slice(offset, offset + 3);
      await Promise.allSettled(batch.map(async item => {
        const steam = await invokeSteamFunction({
          action: 'suggestion-preview',
          appId: Number(item.steam_app_id)
        }, 20000);
        if (!steam?.appId || !steam?.title) return;

        const snapshot = snapshotPayloadFromSteam(steam);
        Object.assign(item, snapshot, {
          steam_url: steam.steamUrl || item.steam_url || `https://store.steampowered.com/app/${Number(item.steam_app_id)}/`,
          title: steam.title || item.title,
          cover_url: steam.coverUrl || item.cover_url || '',
          description: steam.description || item.description || '',
          updated_at: new Date().toISOString()
        });
        changed = true;
      }));
    }

    if (changed) writeLocalSuggestions(source);
    return changed;
  }

  async function loadModeration() {
    if (!suggestionState.isAdmin) return;
    if (suggestionState.localMode) {
      const localItems = readLocalSuggestions().map(item => ({
        ...item,
        support_count: Number(item.support_count) || 1,
        supporter_comment_count: Array.isArray(item.suggestion_comments) ? item.suggestion_comments.length : 0
      }));
      suggestionState.moderation = localItems;
      renderModeration();
      try {
        const changed = await hydrateLocalModerationSnapshots(localItems);
        if (changed) {
          suggestionState.moderation = localItems;
          renderModeration();
        }
      } catch (error) {
        console.info('Не удалось обновить локальные Steam-карточки:', error);
      }
      return;
    }
    if (!publishedCatalogActive()) elements.moderationList.innerHTML = '<div class="suggestions-empty">Загружаем очередь…</div>';
    const { data, error } = await suggestionState.client
      .from('game_suggestions')
      .select('*,suggestion_votes(reaction),suggestion_comments(id,body,is_hidden,created_at)')
      .order('created_at', { ascending: false });
    if (error) {
      if (!publishedCatalogActive()) elements.moderationList.innerHTML = `<div class="suggestions-empty">${escapeHtml(errorMessage(error))}</div>`;
      return;
    }
    const moderationItems = Array.isArray(data) ? data : [];
    let supportCounts = new Map();
    try {
      const { data: supportData, error: supportError } = await suggestionState.client.rpc('get_admin_suggestion_support_counts');
      if (supportError) throw supportError;
      supportCounts = new Map((Array.isArray(supportData) ? supportData : []).map(entry => [
        String(entry.suggestion_id),
        {
          support_count: Number(entry.support_count) || 0,
          supporter_comment_count: Number(entry.supporter_comment_count) || 0
        }
      ]));
    } catch (supportError) {
      console.warn('Не удалось загрузить количество предложивших игру:', supportError?.message || supportError);
    }
    suggestionState.moderation = moderationItems.map(item => ({
      ...item,
      support_count: supportCounts.get(String(item.id))?.support_count ?? Math.max(1, Array.isArray(item.suggestion_comments) ? item.suggestion_comments.length : 0),
      supporter_comment_count: supportCounts.get(String(item.id))?.supporter_comment_count ?? (Array.isArray(item.suggestion_comments) ? item.suggestion_comments.length : 0)
    }));
    await hydrateMissingModerationSnapshots(suggestionState.moderation);
    renderModeration();
  }

  async function moderateSuggestion(id, action, button) {
    if (suggestionState.localMode) {
      const numericId = Number(id);
      const items = readLocalSuggestions();
      const index = items.findIndex(item => Number(item.id) === numericId);
      if (index < 0) return;
      if (action === 'delete') {
        if (!window.confirm('Удалить локальную тестовую заявку?')) return;
        items.splice(index, 1);
      } else {
        const statusMap = {
          approve: 'approved',
          reject: 'rejected',
          select: 'selected',
          complete: 'completed',
          reopen: 'pending',
          archive: 'archived'
        };
        if (statusMap[action]) items[index].status = statusMap[action];
        items[index].updated_at = new Date().toISOString();
      }
      writeLocalSuggestions(items);
      suggestionState.moderation = items;
      renderModeration();
      showNotice('Локальная очередь обновлена.', 'success');
      return;
    }

    let reason = '';
    if (action === 'reject') {
      reason = window.prompt('Почему предложение отклонено? Причина сохранится в архиве.', '') ?? '';
      if (!reason.trim()) return;
    }
    setBusy(button, true, action === 'approve' ? 'Публикуем…' : 'Сохраняем…');
    try {
      if (action === 'delete' && !window.confirm('Удалить предложение игры без возможности восстановления?')) {
        setBusy(button, false);
        return;
      }
      const result = action === 'delete'
        ? await suggestionState.client.rpc('delete_game_suggestion', { p_suggestion_id: Number(id) })
        : action === 'approve'
          ? { data: await invokeSteamFunction({ action: 'publish-suggestion', suggestionId: Number(id) }), error: null }
          : await suggestionState.client.rpc('moderate_game_suggestion', {
            p_suggestion_id: Number(id),
            p_action: action,
            p_reason: reason
          });
      const { data, error } = result;
      if (error) throw error;
      if (action === 'approve' && !data?.published) {
        throw new Error(data?.error || 'Сервер не подтвердил публикацию игры в каталоге.');
      }
      showNotice(action === 'approve' ? 'Игра опубликована в каталоге.' : 'Статус предложения обновлён.', 'success');
      if (action === 'approve') {
        window.dispatchEvent(new CustomEvent('cr7:game-published', {
          detail: { suggestionId: Number(id), gameId: Number(data.gameId) || null }
        }));
      }
      await Promise.all([loadModeration(), loadPublicSuggestions()]);
    } catch (error) {
      showNotice(errorMessage(error), 'error');
    } finally {
      setBusy(button, false);
    }
  }

  async function moderateComment(id, hidden, button) {
    setBusy(button, true, hidden ? 'Скрываем…' : 'Возвращаем…');
    try {
      const { error } = await suggestionState.client.rpc('moderate_suggestion_comment', {
        p_comment_id: Number(id),
        p_hidden: Boolean(hidden)
      });
      if (error) throw error;
      const activeId = suggestionState.commentMode === 'admin-supporters' ? suggestionState.activeSuggestionId : null;
      await Promise.all([loadModeration(), loadPublicSuggestions()]);
      if (activeId) await loadAdminSupporterComments(activeId);
    } catch (error) {
      showNotice(errorMessage(error), 'error');
      setBusy(button, false);
    }
  }

  function bindEvents() {
    elements.triggers.forEach(trigger => trigger.addEventListener('click', () => openPanel(trigger.dataset.suggestionsView)));
    elements.close.addEventListener('click', closePanel);
    elements.panel.addEventListener('click', event => {
      if (event.target.matches('[data-suggestions-close]')) closePanel();
    });
    elements.tabs.forEach(button => button.addEventListener('click', () => setTab(button.dataset.suggestionsTab)));
    elements.previewButton.addEventListener('click', previewSteamGame);
    elements.steamUrl.addEventListener('input', clearPreview);
    elements.form.addEventListener('submit', submitSuggestion);
    elements.sort.addEventListener('change', renderPublicSuggestions);
    elements.grid.addEventListener('click', event => {
      const card = event.target.closest('[data-suggestion-id]');
      if (!card) return;
      const reactionButton = event.target.closest('[data-suggestion-reaction]');
      if (reactionButton) setReaction(card.dataset.suggestionId, reactionButton.dataset.suggestionReaction, reactionButton);
      if (event.target.closest('[data-suggestion-comments]')) openComments(card.dataset.suggestionId);
    });
    elements.commentsClose.addEventListener('click', closeComments);
    elements.commentsPanel.addEventListener('click', event => {
      if (event.target.matches('[data-suggestion-comments-close]')) {
        closeComments();
        return;
      }
      const moderationButton = event.target.closest('[data-admin-support-comment-id]');
      if (moderationButton && suggestionState.commentMode === 'admin-supporters') {
        moderateComment(
          moderationButton.dataset.adminSupportCommentId,
          moderationButton.dataset.adminSupportCommentHidden === 'true',
          moderationButton
        );
      }
    });
    elements.commentForm.addEventListener('submit', saveComment);
    elements.commentDelete.addEventListener('click', deleteMyComment);
    elements.moderationRefresh?.addEventListener('click', checkAdminAndLoad);
    elements.moderationSearch?.addEventListener('input', event => {
      suggestionState.moderationQuery = event.target.value.trim();
      renderModeration();
    });
    elements.moderationSort?.addEventListener('change', event => {
      suggestionState.moderationSort = event.target.value;
      renderModeration();
    });
    elements.releaseFilters.forEach(input => input.addEventListener('change', renderModeration));
    elements.playersMin?.addEventListener('input', renderModeration);
    elements.playersMax?.addEventListener('input', renderModeration);
    elements.filtersReset?.addEventListener('click', () => {
      elements.releaseFilters.forEach(input => { input.checked = true; });
      if (elements.playersMin) elements.playersMin.value = '';
      if (elements.playersMax) elements.playersMax.value = '';
      suggestionState.moderationQuery = '';
      if (elements.moderationSearch) elements.moderationSearch.value = '';
      renderModeration();
    });
    elements.moderationFilters.forEach(button => button.addEventListener('click', () => {
      suggestionState.moderationStatus = button.dataset.suggestionStatus;
      elements.moderationFilters.forEach(item => item.classList.toggle('active', item === button));
      renderModeration();
    }));
    elements.moderationList?.addEventListener('click', event => {
      const supporterCommentsButton = event.target.closest('[data-supporter-comments][data-suggestion-id]');
      if (supporterCommentsButton) {
        openAdminSupporterComments(supporterCommentsButton.dataset.suggestionId);
        return;
      }
      const actionButton = event.target.closest('[data-action][data-suggestion-id]');
      if (actionButton) moderateSuggestion(actionButton.dataset.suggestionId, actionButton.dataset.action, actionButton);
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (!elements.commentsPanel.hidden) closeComments();
      else if (!elements.panel.hidden) closePanel();
    });
  }

  function start() {
    if (!suggestionState.eventsBound) {
      suggestionState.eventsBound = true;
      bindEvents();
    }
    if (suggestionState.started) return;
    suggestionState.client = configuredClient();

    if (suggestionState.localMode) {
      suggestionState.started = true;
      suggestionState.isAdmin = true;
      applyAdminAccess();
      loadModeration();
      return;
    }

    applyAdminAccess();
    if (!suggestionState.client) return;
    suggestionState.started = true;
    loadPublicSuggestions();
    checkAdminAndLoad();
    suggestionState.client.auth.onAuthStateChange(() => {
      window.setTimeout(() => {
        loadPublicSuggestions();
        checkAdminAndLoad();
      }, 0);
    });
  }

  window.addEventListener('cr7:supabase-ready', start, { once: true });
  start();
})();
