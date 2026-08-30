/* Bundled admin portal: source modules remain in assets/js/admin/. */
(() => {

/* state.js */


    const elements = {
      configError: document.getElementById('configError'),
      loginSection: document.getElementById('loginSection'),
      adminSection: document.getElementById('adminSection'),
      loginForm: document.getElementById('loginForm'),
      loginButton: document.getElementById('loginButton'),
      email: document.getElementById('email'),
      password: document.getElementById('password'),
      logoutButton: document.getElementById('logoutButton'),
      sessionEmail: document.getElementById('sessionEmail'),
      notice: document.getElementById('notice'),
      gameForm: document.getElementById('gameForm'),
      steamStep: document.getElementById('steamStep'),
      detailsStage: document.getElementById('detailsStage'),
      formTitle: document.getElementById('formTitle'),
      title: document.getElementById('title'),
      steamUrl: document.getElementById('steamUrl'),
      steamImportButton: document.getElementById('steamImportButton'),
      changeGameButton: document.getElementById('changeGameButton'),
      steamPreview: document.getElementById('steamPreview'),
      steamPreviewImage: document.getElementById('steamPreviewImage'),
      steamPreviewTitle: document.getElementById('steamPreviewTitle'),
      steamPreviewText: document.getElementById('steamPreviewText'),
      steamPreviewRelease: document.getElementById('steamPreviewRelease'),
      steamPreviewCoop: document.getElementById('steamPreviewCoop'),
      coopEditor: document.getElementById('coopEditor'),
      coopEditorHint: document.getElementById('coopEditorHint'),
      coverUrl: document.getElementById('coverUrl'),
      description: document.getElementById('description'),
      authorComment: document.getElementById('authorComment'),
      releaseDate: document.getElementById('releaseDate'),
      releaseDateText: document.getElementById('releaseDateText'),
      displayOrder: document.getElementById('displayOrder'),
      steamAppId: document.getElementById('steamAppId'),
      isCoop: document.getElementById('isCoop'),
      coopType: document.getElementById('coopType'),
      coopMinPlayers: document.getElementById('coopMinPlayers'),
      coopMaxPlayers: document.getElementById('coopMaxPlayers'),
      coopSource: document.getElementById('coopSource'),
      releaseStatusAuto: document.getElementById('releaseStatusAuto'),
      releaseStatusBadge: document.getElementById('releaseStatusBadge'),
      releaseStatusHint: document.getElementById('releaseStatusHint'),
      published: document.getElementById('published'),
      saveButton: document.getElementById('saveButton'),
      cancelEditButton: document.getElementById('cancelEditButton'),
      gameList: document.getElementById('gameList'),
      countLabel: document.getElementById('countLabel'),
      catalogSearch: document.getElementById('catalogSearch'),
      catalogSearchClear: document.getElementById('catalogSearchClear'),
      catalogSort: document.getElementById('catalogSort'),
      duplicateModal: document.getElementById('duplicateModal'),
      duplicateTitle: document.getElementById('duplicateTitle'),
      duplicateText: document.getElementById('duplicateText'),
      duplicateCancel: document.getElementById('duplicateCancel'),
      duplicateConfirm: document.getElementById('duplicateConfirm')
    };

    const state = {
      client: null,
      games: [],
      editingId: null,
      channel: null,
      noticeTimer: null,
      steamImportTimer: null,
      steamImportPromise: null,
      lastImportedSteamUrl: '',
      steamComingSoonFallback: false,
      catalogQuery: '',
      catalogSort: 'newest'
    };

    // Совместимость с базами, где старый CHECK всё ещё требует хотя бы один символ.
    const EMPTY_AUTHOR_COMMENT = '\u2063';

/* utils.js */
function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>'"]/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
      })[char]);
    }

    function showNotice(message, type = 'info', sticky = false) {
      clearTimeout(state.noticeTimer);
      elements.notice.className = `notice show ${type}`;
      elements.notice.textContent = message;
      if (!sticky) state.noticeTimer = setTimeout(() => { elements.notice.className = 'notice'; }, 5000);
    }

    function setBusy(button, busy, busyText) {
      if (!button.dataset.defaultText) button.dataset.defaultText = button.textContent;
      button.disabled = busy;
      button.textContent = busy ? busyText : button.dataset.defaultText;
    }

    function getConfiguredClient() {
      const config = window.CR7_CONFIG || {};
      const url = String(config.supabaseUrl || '');
      const key = String(config.supabasePublishableKey || '');
      const configured = url.startsWith('https://') && !url.includes('YOUR-PROJECT') && key && !key.includes('YOUR-PUBLISHABLE');
      if (!configured || !window.supabase?.createClient) return null;
      if (window.CR7_SUPABASE_CLIENT) return window.CR7_SUPABASE_CLIENT;
      window.CR7_SUPABASE_CLIENT = window.supabase.createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      });
      return window.CR7_SUPABASE_CLIENT;
    }

    function normalizeUrl(value, steamOnly = false) {
      const text = String(value || '').trim();
      if (!text) return '';
      let url;
      try { url = new URL(text); } catch { throw new Error('Проверь формат ссылки.'); }
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Разрешены только ссылки http/https.');
      if (steamOnly && !['store.steampowered.com', 'steamcommunity.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
        throw new Error('Укажи ссылку на Steam.');
      }
      return url.href;
    }

    function parseDate(value) {
      if (!value) return null;
      const date = new Date(`${value}T12:00:00`);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    function daysUntil(value) {
      const date = parseDate(value);
      if (!date) return null;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      date.setHours(0, 0, 0, 0);
      return Math.ceil((date - today) / 86400000);
    }

    function isUpcomingByLocalDate(releaseDate, steamFallback = false) {
      const date = parseDate(releaseDate);
      if (!date) return Boolean(steamFallback);
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return date.getTime() > today.getTime();
    }

    function updateAutomaticReleaseStatus() {
      const releaseDate = elements.releaseDate.value;
      const hasDate = Boolean(parseDate(releaseDate));
      const upcoming = isUpcomingByLocalDate(releaseDate, state.steamComingSoonFallback);
      const days = hasDate ? daysUntil(releaseDate) : null;

      elements.releaseStatusAuto.classList.remove('upcoming', 'released', 'unknown');
      if (hasDate && upcoming) {
        elements.releaseStatusAuto.classList.add('upcoming');
        elements.releaseStatusBadge.textContent = days === 1 ? 'Завтра' : `Через ${days} дн.`;
        elements.releaseStatusHint.textContent = 'Будущая дата определена по локальному времени этого устройства.';
      } else if (hasDate) {
        elements.releaseStatusAuto.classList.add('released');
        elements.releaseStatusBadge.textContent = days === 0 ? 'Сегодня' : 'Вышла';
        elements.releaseStatusHint.textContent = 'Дата релиза наступила по локальному времени этого устройства.';
      } else if (state.steamComingSoonFallback) {
        elements.releaseStatusAuto.classList.add('upcoming');
        elements.releaseStatusBadge.textContent = 'Скоро';
        elements.releaseStatusHint.textContent = 'Точной даты нет — временно используется статус Steam.';
      } else {
        elements.releaseStatusAuto.classList.add('unknown');
        elements.releaseStatusBadge.textContent = 'Без даты';
        elements.releaseStatusHint.textContent = 'Добавь Steam-ссылку или дату релиза.';
      }
      return upcoming;
    }

    function playerWord(number) {
      const value = Math.abs(Number(number) || 0) % 100;
      const last = value % 10;
      if (value > 10 && value < 20) return 'игроков';
      if (last === 1) return 'игрок';
      if (last >= 2 && last <= 4) return 'игрока';
      return 'игроков';
    }

    function coopLabel(game) {
      if (!game?.is_coop) return '';
      const typeLabels = {
        mixed: 'Онлайн и локальный кооп',
        online: 'Онлайн-кооп',
        local: 'Локальный кооп',
        generic: 'Кооператив'
      };
      const prefix = typeLabels[String(game.coop_type || '')] || 'Кооператив';
      const min = Number(game.coop_min_players) || null;
      const max = Number(game.coop_max_players) || null;
      if (min && max && min < max) return `${prefix} · ${min}–${max} ${playerWord(max)}`;
      if (max) return `${prefix} · до ${max} ${playerWord(max)}`;
      return prefix;
    }

    function releaseLabel(game) {
      const upcoming = isUpcomingByLocalDate(game.release_date, game.coming_soon);
      if (upcoming && game.release_date) {
        const days = daysUntil(game.release_date);
        if (days === 0) return 'Релиз сегодня';
        if (days === 1) return 'Релиз завтра';
        if (days > 1) return `Через ${days} дн.`;
        return 'Проверь дату';
      }
      if (upcoming) return 'Дата уточняется';
      if (game.release_date) return 'Уже вышла';
      return 'Без даты';
    }

    function sortGames(games) {
      return [...games].sort((a, b) => {
        const aUpcoming = isUpcomingByLocalDate(a.release_date, a.coming_soon);
        const bUpcoming = isUpcomingByLocalDate(b.release_date, b.coming_soon);
        if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
        const aDate = parseDate(a.release_date)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const bDate = parseDate(b.release_date)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        if (aUpcoming && aDate !== bDate) return aDate - bDate;
        const orderDiff = (Number(a.display_order) || 0) - (Number(b.display_order) || 0);
        if (orderDiff) return orderDiff;
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      });
    }

/* games.js */
function renderGames() {
      const query = state.catalogQuery.trim().toLocaleLowerCase('ru-RU');
      const games = state.games.filter(game => String(game.title || '').toLocaleLowerCase('ru-RU').includes(query));

      games.sort((a, b) => {
        if (state.catalogSort === 'alphabetical') {
          return String(a.title || '').localeCompare(String(b.title || ''), 'ru', { sensitivity: 'base', numeric: true });
        }
        if (state.catalogSort === 'release') {
          const aDate = parseDate(a.release_date)?.getTime() ?? Number.MAX_SAFE_INTEGER;
          const bDate = parseDate(b.release_date)?.getTime() ?? Number.MAX_SAFE_INTEGER;
          if (aDate !== bDate) {
            if (aDate === Number.MAX_SAFE_INTEGER) return 1;
            if (bDate === Number.MAX_SAFE_INTEGER) return -1;
            return bDate - aDate;
          }
          return String(a.title || '').localeCompare(String(b.title || ''), 'ru', { sensitivity: 'base', numeric: true });
        }
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      });

      const gameWord = count => {
        const lastTwo = count % 100;
        const last = count % 10;
        if (lastTwo >= 11 && lastTwo <= 14) return 'игр';
        if (last === 1) return 'игра';
        if (last >= 2 && last <= 4) return 'игры';
        return 'игр';
      };
      elements.countLabel.textContent = query
        ? `${games.length} из ${state.games.length}`
        : `${games.length} ${gameWord(games.length)}`;

      if (!state.games.length) {
        elements.gameList.innerHTML = '<div class="empty">Каталог пока пуст. Добавь первую игру через форму слева.</div>';
        return;
      }
      if (!games.length) {
        elements.gameList.innerHTML = `<div class="empty search-empty"><strong>Ничего не найдено</strong><span>В каталоге нет игры с названием «${escapeHtml(state.catalogQuery.trim())}».</span></div>`;
        return;
      }

      elements.gameList.innerHTML = games.map(game => {
        const cover = game.cover_url
          ? `<img src="${escapeHtml(game.cover_url)}" alt="" onerror="this.parentElement.innerHTML='<div class=&quot;admin-cover-fallback&quot;>TWITCH</div>'">`
          : '<div class="admin-cover-fallback">TWITCH</div>';
        return `
          <article class="admin-game">
            <div class="admin-cover">${cover}</div>
            <div class="admin-game-body">
              <div class="admin-game-top">
                <div>
                  <h3>${escapeHtml(game.title)}</h3>
                  <p>${escapeHtml(game.description).slice(0, 155)}${String(game.description || '').length > 155 ? '…' : ''}</p>
                </div>
                <div class="admin-game-actions">
                  <button class="icon-btn sync" type="button" data-action="sync" data-id="${game.id}">Steam ↻</button>
                  <button class="icon-btn" type="button" data-action="edit" data-id="${game.id}">Изменить</button>
                  <button class="icon-btn delete" type="button" data-action="delete" data-id="${game.id}">Удалить</button>
                </div>
              </div>
              <div class="admin-meta">
                <span class="meta-pill ${isUpcomingByLocalDate(game.release_date, game.coming_soon) ? 'soon' : ''}">${escapeHtml(releaseLabel(game))}</span>
                <span class="meta-pill">${escapeHtml(game.release_date_text || game.release_date || 'Дата не указана')}</span>
                ${game.is_coop ? `<span class="meta-pill coop">👥 ${escapeHtml(coopLabel(game))}</span>` : ''}
                ${game.published ? '' : '<span class="meta-pill draft">Черновик</span>'}
              </div>
            </div>
          </article>`;
      }).join('');
    }

    async function loadGames() {
      const { data, error } = await state.client
        .from('games')
        .select('id,title,steam_url,cover_url,description,author_comment,created_at,display_order,published,steam_app_id,release_date,release_date_text,coming_soon,steam_synced_at,is_coop,coop_type,coop_min_players,coop_max_players,coop_source');
      if (error) throw error;
      state.games = Array.isArray(data) ? data : [];
      renderGames();
    }

    async function verifyAdmin() {
      const { data, error } = await state.client.rpc('is_site_admin');
      if (error) throw error;
      return data === true;
    }

/* steam-import.js */
function setImportReady(ready, focusComment = false) {
      elements.gameForm.classList.toggle('import-ready', ready);
      elements.detailsStage.setAttribute('aria-hidden', ready ? 'false' : 'true');
      if (ready && focusComment) {
        setTimeout(() => elements.authorComment.focus({ preventScroll: true }), 620);
      }
    }

    function setImporting(importing) {
      elements.gameForm.classList.toggle('importing', importing);
    }

    function setSteamPreview(data) {
      if (!data) {
        elements.steamPreview.classList.remove('show');
        return;
      }
      elements.steamPreview.classList.add('show');
      elements.steamPreviewImage.src = data.coverUrl || '';
      elements.steamPreviewImage.hidden = !data.coverUrl;
      elements.steamPreviewTitle.textContent = data.title || 'Данные Steam';
      elements.steamPreviewText.textContent = data.description || 'Описание не получено.';
      elements.steamPreviewRelease.textContent = data.releaseDateText || (data.comingSoon ? 'Дата уточняется' : 'Дата не указана');
      const label = coopLabel({
        is_coop: Boolean(data.isCoop ?? data.is_coop),
        coop_type: data.coopType ?? data.coop_type,
        coop_min_players: data.coopMinPlayers ?? data.coop_min_players,
        coop_max_players: data.coopMaxPlayers ?? data.coop_max_players
      });
      elements.steamPreviewCoop.hidden = !label;
      elements.steamPreviewCoop.textContent = label ? `👥 ${label}` : '';
    }

    async function fetchSteamData(steamUrl, silent = false) {
      const normalized = normalizeUrl(steamUrl, true);
      if (!silent) setBusy(elements.steamImportButton, true, 'Загрузка…');
      try {
        const { data, error } = await state.client.functions.invoke('steam-game', {
          body: { steamUrl: normalized }
        });
        if (error) {
          let details = error.message || 'Edge Function вернула ошибку.';
          try {
            const body = await error.context?.json();
            if (body?.error) details = body.error;
          } catch {}
          throw new Error(details);
        }
        if (!data?.appId) throw new Error('Steam не вернул данные игры.');
        return data;
      } finally {
        if (!silent) setBusy(elements.steamImportButton, false, 'Загрузка…');
      }
    }

    function applySteamData(data, overwrite = true) {
      elements.steamAppId.value = data.appId || '';
      elements.title.value = overwrite || !elements.title.value ? (data.title || elements.title.value) : elements.title.value;
      elements.coverUrl.value = overwrite || !elements.coverUrl.value ? (data.coverUrl || elements.coverUrl.value) : elements.coverUrl.value;
      elements.description.value = overwrite || !elements.description.value ? (data.description || elements.description.value) : elements.description.value;
      elements.releaseDate.value = data.releaseDate || '';
      elements.releaseDateText.value = data.releaseDateText || '';
      elements.isCoop.checked = Boolean(data.isCoop);
      elements.coopType.value = data.coopType || '';
      elements.coopMinPlayers.value = data.coopMinPlayers || '';
      elements.coopMaxPlayers.value = data.coopMaxPlayers || '';
      elements.coopSource.value = data.coopSource || '';
      updateCoopEditor();
      state.steamComingSoonFallback = Boolean(data.comingSoon);
      updateAutomaticReleaseStatus();
      setSteamPreview(data);
      setImportReady(true, !state.editingId);
    }

    function hasSteamAppUrl(value) {
      try {
        const url = new URL(String(value || '').trim());
        return /\/app\/\d+(?:\/|$)/.test(url.pathname);
      } catch {
        return false;
      }
    }

    async function importSteamFromCurrentUrl({ overwrite = true, notify = true, force = false } = {}) {
      const normalized = normalizeUrl(elements.steamUrl.value, true);
      if (!hasSteamAppUrl(normalized)) throw new Error('Вставь полную ссылку Steam вида store.steampowered.com/app/123456/...');

      if (!force && state.lastImportedSteamUrl === normalized && elements.title.value.trim() && elements.description.value.trim()) {
        return null;
      }

      if (state.steamImportPromise) return state.steamImportPromise;

      setImporting(true);
      state.steamImportPromise = (async () => {
        const data = await fetchSteamData(normalized);
        applySteamData(data, overwrite);
        state.lastImportedSteamUrl = normalized;
        if (notify) showNotice('Название, описание, дата и кооперативный режим загружены из Steam. Добавь комментарий автора.', 'success');
        return data;
      })();

      try {
        return await state.steamImportPromise;
      } finally {
        state.steamImportPromise = null;
        setImporting(false);
      }
    }

    function scheduleSteamAutoImport(delay = 650) {
      clearTimeout(state.steamImportTimer);
      const value = elements.steamUrl.value.trim();
      if (!hasSteamAppUrl(value)) return;

      state.steamImportTimer = setTimeout(async () => {
        try {
          await importSteamFromCurrentUrl({ overwrite: true, notify: true });
        } catch (error) {
          console.error(error);
          showNotice(error.message || 'Не удалось автоматически загрузить данные Steam.', 'error', true);
        }
      }, delay);
    }

/* game-form.js */
function resetForm() {
      state.editingId = null;
      elements.gameForm.reset();
      elements.displayOrder.value = '0';
      elements.published.checked = true;
      elements.formTitle.textContent = 'Добавить игру';
      elements.saveButton.textContent = 'Опубликовать игру';
      elements.saveButton.dataset.defaultText = 'Опубликовать игру';
      elements.cancelEditButton.hidden = true;
      setSteamPreview(null);
      setImportReady(false);
      setImporting(false);
      state.lastImportedSteamUrl = '';
      state.steamComingSoonFallback = false;
      updateCoopEditor();
      updateAutomaticReleaseStatus();
      clearTimeout(state.steamImportTimer);
    }

    function updateCoopEditor(manual = false) {
      const enabled = elements.isCoop.checked;
      elements.coopEditor.classList.toggle('is-disabled', !enabled);
      elements.coopMinPlayers.disabled = !enabled;
      elements.coopMaxPlayers.disabled = !enabled;
      if (enabled && !elements.coopType.value) elements.coopType.value = 'generic';
      if (manual) elements.coopSource.value = 'manual_admin';

      const label = coopLabel({
        is_coop: enabled,
        coop_type: elements.coopType.value,
        coop_min_players: elements.coopMinPlayers.value,
        coop_max_players: elements.coopMaxPlayers.value
      });
      elements.coopEditorHint.textContent = manual
        ? 'Ручное значение будет сохранено вместо автоматического результата Steam.'
        : 'Автоматические значения Steam можно оставить без изменений.';
      elements.steamPreviewCoop.hidden = !label;
      elements.steamPreviewCoop.textContent = label ? `👥 ${label}` : '';
    }

    function editGame(id) {
      const game = state.games.find(item => String(item.id) === String(id));
      if (!game) return;
      state.editingId = game.id;
      elements.title.value = game.title || '';
      elements.steamUrl.value = game.steam_url || '';
      elements.coverUrl.value = game.cover_url || '';
      elements.description.value = game.description || '';
      elements.authorComment.value = game.author_comment === EMPTY_AUTHOR_COMMENT ? '' : (game.author_comment || '');
      elements.releaseDate.value = game.release_date || '';
      elements.releaseDateText.value = game.release_date_text || '';
      elements.displayOrder.value = Number(game.display_order) || 0;
      elements.steamAppId.value = game.steam_app_id || '';
      elements.isCoop.checked = Boolean(game.is_coop);
      elements.coopType.value = game.coop_type || '';
      elements.coopMinPlayers.value = game.coop_min_players || '';
      elements.coopMaxPlayers.value = game.coop_max_players || '';
      elements.coopSource.value = game.coop_source || '';
      updateCoopEditor();
      state.steamComingSoonFallback = Boolean(game.coming_soon);
      updateAutomaticReleaseStatus();
      elements.published.checked = Boolean(game.published);
      elements.formTitle.textContent = 'Редактировать игру';
      elements.saveButton.textContent = 'Сохранить изменения';
      elements.saveButton.dataset.defaultText = 'Сохранить изменения';
      elements.cancelEditButton.hidden = false;
      setSteamPreview({
        title: game.title,
        description: game.description,
        coverUrl: game.cover_url,
        releaseDateText: game.release_date_text || game.release_date,
        comingSoon: game.coming_soon,
        isCoop: game.is_coop,
        coopType: game.coop_type,
        coopMinPlayers: game.coop_min_players,
        coopMaxPlayers: game.coop_max_players
      });
      setImportReady(true, false);
      const portalDialog = elements.gameForm.closest('.admin-portal-dialog');
      if (portalDialog) portalDialog.scrollTo({ top: 0, behavior: 'smooth' });
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async function syncGame(id) {
      const game = state.games.find(item => String(item.id) === String(id));
      if (!game) return;
      showNotice(`Обновляем данные Steam для «${game.title}»…`, 'info', true);
      const data = await fetchSteamData(game.steam_url, true);
      const hasManualCoop = game.coop_source === 'manual_admin';
      const payload = {
        steam_app_id: data.appId,
        title: data.title || game.title,
        cover_url: data.coverUrl || game.cover_url,
        description: data.description || game.description,
        release_date: data.releaseDate || null,
        release_date_text: data.releaseDateText || '',
        coming_soon: isUpcomingByLocalDate(data.releaseDate, data.comingSoon),
        is_coop: hasManualCoop ? Boolean(game.is_coop) : Boolean(data.isCoop),
        coop_type: hasManualCoop ? game.coop_type : data.isCoop ? (data.coopType || 'generic') : '',
        coop_min_players: hasManualCoop ? game.coop_min_players : data.isCoop && data.coopMinPlayers ? Number(data.coopMinPlayers) : null,
        coop_max_players: hasManualCoop ? game.coop_max_players : data.isCoop && data.coopMaxPlayers ? Number(data.coopMaxPlayers) : null,
        coop_source: hasManualCoop ? game.coop_source : (data.coopSource || ''),
        steam_synced_at: new Date().toISOString()
      };
      const { error } = await state.client.from('games').update(payload).eq('id', game.id);
      if (error) throw error;
      await loadGames();
      showNotice('Данные Steam обновлены.', 'success');
    }

    async function deleteGame(id) {
      const game = state.games.find(item => String(item.id) === String(id));
      if (!game || !confirm(`Удалить «${game.title}»?`)) return;
      if (typeof window.CR7_INVOKE_STEAM_FUNCTION !== 'function') throw new Error('Сервис удаления ещё не готов. Обнови страницу.');
      const result = await window.CR7_INVOKE_STEAM_FUNCTION({ action: 'delete-published-game', gameId: Number(game.id) });
      if (!result?.deleted) throw new Error(result?.error || 'Сервер не подтвердил удаление игры.');
      if (String(state.editingId) === String(game.id)) resetForm();
      await loadGames();
      showNotice('Игра удалена.', 'success');
    }

/* auth.js */
async function showLoggedOut() {
      elements.loginSection.hidden = false;
      elements.adminSection.hidden = true;
      elements.logoutButton.hidden = true;
      elements.sessionEmail.textContent = 'Не выполнен вход';
      if (state.channel) {
        await state.client.removeChannel(state.channel);
        state.channel = null;
      }
    }

    async function showLoggedIn(user) {
      // Анонимная Supabase-сессия принадлежит зрительской предложке. Она не
      // считается входом в админку и не должна сбрасываться при открытии сайта.
      if (user?.is_anonymous) {
        await showLoggedOut();
        return;
      }
      const isAdmin = await verifyAdmin();
      if (!isAdmin) {
        await showLoggedOut();
        showNotice('Профиль авторизован, но не добавлен в таблицу site_admins.', 'info', true);
        return;
      }
      elements.loginSection.hidden = true;
      elements.adminSection.hidden = false;
      elements.logoutButton.hidden = false;
      elements.sessionEmail.textContent = user.email || 'Администратор';
      await loadGames();
      if (!state.channel) {
        state.channel = state.client
          .channel('cr7-games-admin-v2')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, async () => {
            try { await loadGames(); } catch (error) { console.error(error); }
          })
          .subscribe();
      }
    }

    async function boot() {
      state.client = getConfiguredClient();
      if (!state.client) {
        elements.configError.hidden = false;
        return;
      }
      const sessionResult = window.CR7_AUTH?.getUsableSession
        ? await window.CR7_AUTH.getUsableSession(state.client)
        : await state.client.auth.getSession();
      const { data, error, recovered } = sessionResult;
      if (error) {
        showNotice(error.message, 'error', true);
        await showLoggedOut();
        return;
      }
      if (recovered) {
        await showLoggedOut();
        showNotice('Сессия истекла. Войди снова.', 'info');
        return;
      }
      if (data.session?.user) {
        try {
          await showLoggedIn(data.session.user);
        } catch (err) {
          console.error(err);
          if (window.CR7_AUTH?.isExpiredAuthError?.(err)) {
            await window.CR7_AUTH.clearStaleSession(state.client);
            await showLoggedOut();
            showNotice('Сессия истекла. Войди снова.', 'info');
          } else {
            showNotice(err.message || 'Ошибка проверки доступа.', 'error', true);
          }
        }
      } else {
        await showLoggedOut();
      }
    }

/* app.js */
async function persistGame(payload) {
      const write = nextPayload => state.editingId
        ? state.client.from('games').update(nextPayload).eq('id', state.editingId)
        : state.client.from('games').insert(nextPayload);
      let { error } = await write(payload);
      const oldCommentConstraint = !payload.author_comment
        && error?.code === '23514'
        && String(error.message || '').includes('games_author_comment_check');
      if (oldCommentConstraint) ({ error } = await write({ ...payload, author_comment: EMPTY_AUTHOR_COMMENT }));
      if (error) throw error;
    }

    function confirmDuplicateGame(gameTitle, existingCount) {
      return new Promise(resolve => {
        const limitReached = existingCount >= 2;
        elements.duplicateTitle.textContent = limitReached ? 'Достигнут лимит копий' : 'Игра уже есть в каталоге';
        elements.duplicateText.textContent = limitReached
          ? `«${gameTitle}» уже добавлена два раза. Третий экземпляр создать нельзя.`
          : `«${gameTitle}» уже есть в каталоге. Разрешено добавить только один дополнительный экземпляр.`;
        elements.duplicateConfirm.hidden = limitReached;
        elements.duplicateModal.hidden = false;
        elements.duplicateModal.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(() => elements.duplicateModal.classList.add('is-open'));

        const onKeydown = event => { if (event.key === 'Escape') finish(false); };
        const finish = allowed => {
          elements.duplicateModal.classList.remove('is-open');
          elements.duplicateModal.setAttribute('aria-hidden', 'true');
          window.setTimeout(() => { elements.duplicateModal.hidden = true; }, 260);
          elements.duplicateCancel.onclick = null;
          elements.duplicateConfirm.onclick = null;
          elements.duplicateModal.onclick = null;
          document.removeEventListener('keydown', onKeydown);
          resolve(allowed);
        };
        elements.duplicateCancel.onclick = () => finish(false);
        elements.duplicateConfirm.onclick = () => finish(true);
        elements.duplicateModal.onclick = event => { if (event.target.matches('[data-duplicate-close]')) finish(false); };
        document.addEventListener('keydown', onKeydown);
        (limitReached ? elements.duplicateCancel : elements.duplicateConfirm).focus();
      });
    }

    elements.loginForm.addEventListener('submit', async event => {
      event.preventDefault();
      setBusy(elements.loginButton, true, 'Вход…');
      try {
        const { data, error } = await state.client.auth.signInWithPassword({
          email: elements.email.value.trim(),
          password: elements.password.value
        });
        if (error) throw error;
        await showLoggedIn(data.user);
        elements.loginForm.reset();
        showNotice('Вход выполнен.', 'success');
      } catch (error) {
        console.error(error);
        showNotice(error.message || 'Не удалось войти.', 'error', true);
      } finally {
        setBusy(elements.loginButton, false, 'Вход…');
      }
    });

    elements.logoutButton.addEventListener('click', async () => {
      await state.client.auth.signOut();
      resetForm();
      await showLoggedOut();
    });

    elements.releaseDate.addEventListener('input', updateAutomaticReleaseStatus);
    elements.releaseDate.addEventListener('change', updateAutomaticReleaseStatus);
    setInterval(updateAutomaticReleaseStatus, 60000);

    elements.isCoop.addEventListener('change', () => updateCoopEditor(true));
    [elements.coopMinPlayers, elements.coopMaxPlayers].forEach(input => {
      input.addEventListener('input', () => updateCoopEditor(true));
    });

    elements.steamUrl.addEventListener('input', () => {
      state.lastImportedSteamUrl = '';
      scheduleSteamAutoImport();
    });

    elements.steamUrl.addEventListener('paste', () => {
      state.lastImportedSteamUrl = '';
      setTimeout(() => scheduleSteamAutoImport(120), 0);
    });

    elements.steamUrl.addEventListener('change', () => scheduleSteamAutoImport(0));

    elements.steamImportButton.addEventListener('click', async () => {
      try {
        await importSteamFromCurrentUrl({ overwrite: true, notify: true, force: true });
      } catch (error) {
        console.error(error);
        showNotice(error.message || 'Не удалось загрузить данные Steam.', 'error', true);
      }
    });

    elements.changeGameButton.addEventListener('click', () => {
      setImportReady(false);
      state.lastImportedSteamUrl = '';
      setTimeout(() => {
        elements.steamUrl.focus();
        elements.steamUrl.select();
      }, 380);
    });

    elements.gameForm.addEventListener('submit', async event => {
      event.preventDefault();
      setBusy(elements.saveButton, true, 'Сохранение…');
      try {
        const normalizedSteamUrl = normalizeUrl(elements.steamUrl.value, true);

        if ((!elements.title.value.trim() || !elements.description.value.trim() || !elements.steamAppId.value) && normalizedSteamUrl) {
          showNotice('Получаем название и описание из Steam…', 'info', true);
          await importSteamFromCurrentUrl({ overwrite: true, notify: false, force: true });
        }

        const payload = {
          title: elements.title.value.trim(),
          steam_url: normalizedSteamUrl,
          cover_url: normalizeUrl(elements.coverUrl.value),
          description: elements.description.value.trim(),
          author_comment: elements.authorComment.value.trim(),
          display_order: Number.parseInt(elements.displayOrder.value, 10) || 0,
          published: elements.published.checked,
          steam_app_id: elements.steamAppId.value ? Number(elements.steamAppId.value) : null,
          release_date: elements.releaseDate.value || null,
          release_date_text: elements.releaseDateText.value.trim(),
          coming_soon: updateAutomaticReleaseStatus(),
          is_coop: elements.isCoop.checked,
          coop_type: elements.isCoop.checked ? (elements.coopType.value || 'generic') : '',
          coop_min_players: elements.isCoop.checked && elements.coopMinPlayers.value ? Number(elements.coopMinPlayers.value) : null,
          coop_max_players: elements.isCoop.checked && elements.coopMaxPlayers.value ? Number(elements.coopMaxPlayers.value) : null,
          coop_source: elements.coopSource.value.trim(),
          steam_synced_at: elements.steamAppId.value ? new Date().toISOString() : null
        };

        if (!payload.title || !payload.description) {
          throw new Error('Steam не заполнил название или описание. Нажми «Обновить из Steam» и проверь ссылку.');
        }
        if (payload.is_coop && payload.coop_min_players && payload.coop_max_players && payload.coop_min_players > payload.coop_max_players) {
          throw new Error('Минимальное число игроков не может быть больше максимального.');
        }
        if (!state.editingId && payload.steam_app_id) {
          const duplicateCount = state.games.filter(game => Number(game.steam_app_id) === payload.steam_app_id).length;
          if (duplicateCount && !(await confirmDuplicateGame(payload.title, duplicateCount))) return;
        }

        if (state.editingId) {
          await persistGame(payload);
          showNotice('Изменения сохранены и уже доступны на сайте.', 'success');
        } else {
          await persistGame(payload);
          showNotice('Игра опубликована и уже доступна на сайте.', 'success');
        }

        resetForm();
        await loadGames();
      } catch (error) {
        console.error(error);
        showNotice(error.message || 'Не удалось сохранить игру.', 'error', true);
      } finally {
        setBusy(elements.saveButton, false, 'Сохранение…');
      }
    });

    elements.cancelEditButton.addEventListener('click', resetForm);

    elements.catalogSearch.addEventListener('input', () => {
      state.catalogQuery = elements.catalogSearch.value;
      elements.catalogSearchClear.hidden = !state.catalogQuery;
      renderGames();
    });

    elements.catalogSearchClear.addEventListener('click', () => {
      elements.catalogSearch.value = '';
      state.catalogQuery = '';
      elements.catalogSearchClear.hidden = true;
      renderGames();
      elements.catalogSearch.focus();
    });

    elements.catalogSort.addEventListener('change', () => {
      state.catalogSort = elements.catalogSort.value;
      renderGames();
    });

    elements.gameList.addEventListener('click', async event => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      try {
        if (button.dataset.action === 'edit') editGame(button.dataset.id);
        if (button.dataset.action === 'sync') await syncGame(button.dataset.id);
        if (button.dataset.action === 'delete') await deleteGame(button.dataset.id);
      } catch (error) {
        console.error(error);
        showNotice(error.message || 'Операция не выполнена.', 'error', true);
      }
    });

    if (window.supabase?.createClient) boot();
    else window.addEventListener('cr7:supabase-ready',boot,{ once: true });

})();
