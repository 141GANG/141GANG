(() => {
  const portal = document.getElementById('adminPortal');
  const adminSection = document.getElementById('adminSection');
  const list = document.getElementById('suggestionModerationList');
  const search = document.getElementById('proposalGameSearch');
  const statusButtons = [...document.querySelectorAll('[data-suggestion-status]')];
  const pendingButton = statusButtons.find(button => button.dataset.suggestionStatus === 'pending');
  const publishedButton = statusButtons.find(button => button.dataset.suggestionStatus === 'approved');
  if (!portal || !adminSection || !list || !pendingButton || !publishedButton) return;

  const state = {
    games: [],
    query: '',
    sort: 'newest',
    loaded: false,
    loading: false,
    active: false,
    reactionLoading: false,
    reactionTimer: 0,
    catalogChannel: null,
    filters: {
      releases: [],
      statuses: [],
      minPlayers: 0,
      maxPlayers: Number.MAX_SAFE_INTEGER
    }
  };

  // Each script instance binds to the current filter panel once.
  // This also makes a freshly loaded script recover an already-created panel
  // left behind by an older/cached script instance.
  const boundFilterBoxes = new WeakSet();

  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);

  const CATALOG_ICONS = {
    player: '<img class="admin-catalog-fact-icon admin-catalog-player-icon" src="./assets/images/figma/cheloveck.png" alt="" aria-hidden="true">',
    day: '<img class="admin-catalog-fact-icon admin-catalog-day-icon" src="./assets/images/figma/calendar.png" alt="" aria-hidden="true">',
    like: '<img class="admin-catalog-reaction-icon" src="./assets/images/figma/like.png" alt="" aria-hidden="true">',
    dislike: '<img class="admin-catalog-reaction-icon" src="./assets/images/figma/dislike.png" alt="" aria-hidden="true">'
  };

  function reactionMarkup(likes = 0, dislikes = 0) {
    return `<span>${CATALOG_ICONS.like}<b data-reaction-count="like">${Number(likes) || 0}</b></span><span>${CATALOG_ICONS.dislike}<b data-reaction-count="dislike">${Number(dislikes) || 0}</b></span>`;
  }

  function client() {
    if (window.CR7_SUPABASE_CLIENT) return window.CR7_SUPABASE_CLIENT;
    if (typeof getConfiguredClient === 'function') return getConfiguredClient();
    return null;
  }

  function playerWord(number) {
    const value = Math.abs(Number(number) || 0) % 100;
    const last = value % 10;
    if (value > 10 && value < 20) return 'игроков';
    if (last === 1) return 'игрок';
    if (last >= 2 && last <= 4) return 'игрока';
    return 'игроков';
  }

  function playerRange(game) {
    const storedMin = Number(game?.players_min);
    const storedMax = Number(game?.players_max);
    const hasStoredRange = Boolean(String(game?.player_count_source || '').trim())
      && Number.isFinite(storedMin)
      && Number.isFinite(storedMax)
      && storedMin >= 1
      && storedMax >= storedMin;
    if (hasStoredRange) return { min: storedMin, max: storedMax };
    if (!game?.is_coop) return { min: 1, max: 1 };
    const min = Number(game.coop_min_players) || 2;
    const max = Number(game.coop_max_players) || min;
    return { min, max };
  }

  function playersLabel(game) {
    const { min, max } = playerRange(game);
    return min === max ? `${max} ${playerWord(max)}` : `${min}–${max} ${playerWord(max)}`;
  }

  function releaseLabel(game) {
    if (!game.release_date) return game.coming_soon ? 'Скоро' : 'Без даты';
    const date = new Date(`${game.release_date}T12:00:00`);
    if (Number.isNaN(date.getTime())) return 'Без даты';
    return date > new Date() ? new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    }).format(date) : 'Вышла';
  }

  function statusLabel(value) {
    return ({ completed: 'Пройдено', dropped: 'Дропнуто', ignored: 'Неинтересно' })[value] || '';
  }

  function releaseGroup(game) {
    if (!game.release_date) return game.coming_soon ? 'upcoming' : 'unknown';
    const date = new Date(`${game.release_date}T12:00:00`);
    if (Number.isNaN(date.getTime())) return 'unknown';
    return date > new Date() ? 'upcoming' : 'released';
  }

  function syncFiltersFromBox(box) {
    state.filters.releases = [...box.querySelectorAll('[data-admin-release-filter]:checked')]
      .map(input => input.dataset.adminReleaseFilter);
    state.filters.statuses = [...box.querySelectorAll('[data-admin-status-filter]:checked')]
      .map(input => input.dataset.adminStatusFilter);
    state.filters.minPlayers = Math.max(0, Number(box.querySelector('[data-admin-players-min]')?.value) || 0);
    state.filters.maxPlayers = Math.max(
      state.filters.minPlayers || 0,
      Number(box.querySelector('[data-admin-players-max]')?.value) || Number.MAX_SAFE_INTEGER
    );
  }

  function bindLiveFilters(box) {
    if (!box || boundFilterBoxes.has(box)) return;
    boundFilterBoxes.add(box);

    const apply = () => {
      syncFiltersFromBox(box);
      render();
    };

    // Delegation is intentional: it survives DOM normalization and also works
    // when the panel was created by an older cached version of this script.
    box.addEventListener('change', event => {
      if (event.target.matches('[data-admin-release-filter], [data-admin-status-filter]')) apply();
    });
    box.addEventListener('input', event => {
      if (event.target.matches('[data-admin-players-min], [data-admin-players-max]')) apply();
    });
  }

  function ensureFilters() {
    let box = document.getElementById('adminCatalogFilters');
    if (!box) {
      box = document.createElement('details');
      box.id = 'adminCatalogFilters';
      box.className = 'proposal-filter-box admin-catalog-filter-box';
      box.open = true;
      box.innerHTML = `
        <summary>Фильтры</summary>
        <fieldset>
          <legend>Статус выхода</legend>
          <label><input data-admin-release-filter="released" type="checkbox"> Вышла</label>
          <label><input data-admin-release-filter="upcoming" type="checkbox"> Скоро</label>
          <label><input data-admin-release-filter="unknown" type="checkbox"> Без даты</label>
        </fieldset>
        <fieldset>
          <legend>Количество игроков</legend>
          <div class="admin-catalog-player-range">
            <input aria-label="Минимальное количество игроков" data-admin-players-min inputmode="numeric" min="1" placeholder="Мин" type="number">
            <span aria-hidden="true">–</span>
            <input aria-label="Максимальное количество игроков" data-admin-players-max inputmode="numeric" min="1" placeholder="Макс" type="number">
          </div>
        </fieldset>
        <fieldset>
          <legend>Отмечено как</legend>
          <div class="admin-catalog-status-filter-grid">
            <label><input data-admin-status-filter="completed" type="checkbox"> Пройдено</label>
            <label><input data-admin-status-filter="dropped" type="checkbox"> Дропнуто</label>
            <label><input data-admin-status-filter="ignored" type="checkbox"> Неинтересно</label>
          </div>
        </fieldset>
        <label class="admin-catalog-filter-sort">
          <span>Сортировка</span>
          <select data-admin-catalog-sort>
            <option value="newest">Сначала новые</option>
            <option value="oldest">Сначала старые</option>
            <option value="title">По названию</option>
          </select>
        </label>`;
      document.querySelector('.proposal-game-tools')?.appendChild(box);
    }

    // If an older cached script created the panel, normalize it to the new
    // buttonless live-filter UI instead of returning before event binding.
    box.querySelector('.admin-catalog-filter-actions')?.remove();
    bindLiveFilters(box);
    syncFiltersFromBox(box);

    const sort = box.querySelector('.admin-catalog-filter-sort');
    const select = sort?.querySelector('[data-admin-catalog-sort]');
    if (select && !select.dataset.liveSortBound) {
      select.dataset.liveSortBound = '1';
      select.addEventListener('change', event => {
        state.sort = event.target.value;
        render();
      });
    }
    if (sort && sort.parentElement !== document.querySelector('.proposal-game-tools')) {
      document.querySelector('.proposal-game-tools')?.appendChild(sort);
    } else if (sort) {
      document.querySelector('.proposal-game-tools')?.appendChild(sort);
    }
    return box;
  }

  function ensureSort() {
    ensureFilters();
    return document.querySelector('.admin-catalog-filter-sort');
  }

  function setCatalogMode(active) {
    state.active = active;
    adminSection.dataset.catalogTab = active ? 'true' : 'false';
    list.classList.toggle('is-catalog-list', active);
    const sort = ensureSort();
    const filters = ensureFilters();
    const proposalSort = document.querySelector('.proposal-game-tools > .proposal-sort');
    sort.hidden = !active;
    if (proposalSort) proposalSort.hidden = active;
    filters.hidden = !active;
    if (active) filters.open = true;
    if (active) startCatalogMonitoring();
    else stopCatalogMonitoring();
  }

  function filteredGames() {
    const query = state.query.trim().toLocaleLowerCase('ru-RU');
    const releaseFilters = new Set(state.filters.releases);
    const statusFilters = new Set(state.filters.statuses);
    const games = state.games.filter(game => game.published !== false)
      .filter(game => !query || [game.title, game.description, game.release_date_text]
        .some(value => String(value || '').toLocaleLowerCase('ru-RU').includes(query)))
      .filter(game => !releaseFilters.size || releaseFilters.has(releaseGroup(game)))
      .filter(game => {
        const players = playerRange(game).max;
        return players >= state.filters.minPlayers && players <= state.filters.maxPlayers;
      })
      .filter(game => !statusFilters.size || statusFilters.has(String(game.library_status || '')));
    games.sort((a, b) => {
      if (state.sort === 'title') return String(a.title || '').localeCompare(String(b.title || ''), 'ru-RU');
      const direction = state.sort === 'oldest' ? 1 : -1;
      return (new Date(a.created_at || 0) - new Date(b.created_at || 0)) * direction;
    });
    return games;
  }

  function render() {
    if (!state.active) return;
    const games = filteredGames();
    publishedButton.dataset.catalogCount = String(state.games.filter(game => game.published !== false).length);
    if (!games.length) {
      list.innerHTML = '<div class="suggestions-empty">В опубликованном каталоге нет подходящих игр.</div>';
      return;
    }

    list.innerHTML = games.map(game => {
      const current = String(game.library_status || '');
      const cover = game.cover_url || './assets/images/figma/game-placeholder.svg';
      const steam = String(game.steam_url || '');
      const likes = Number(game.like_count) || 0;
      const dislikes = Number(game.dislike_count) || 0;
      return `
        <article class="admin-catalog-card" data-game-id="${escapeHtml(game.id)}" data-library-status="${escapeHtml(current)}" data-published-icons-ready="2">
          <div class="admin-catalog-card-side">
            <img src="${escapeHtml(cover)}" alt="Обложка ${escapeHtml(game.title)}" onerror="this.src='./assets/images/figma/game-placeholder.svg'">
            <div class="admin-catalog-facts">
              <span class="admin-catalog-players">${CATALOG_ICONS.player}<span>${escapeHtml(playersLabel(game))}</span></span>
              <span class="admin-catalog-release">${CATALOG_ICONS.day}<span>${escapeHtml(releaseLabel(game))}</span></span>
              <span class="admin-catalog-reactions">${reactionMarkup(likes, dislikes)}</span>
            </div>
          </div>
          <div class="admin-catalog-card-copy">
            <h3>${escapeHtml(game.title || 'Без названия')}</h3>
            <p class="admin-catalog-description">${escapeHtml(game.description || 'Описание не указано.')}</p>
            <span class="admin-catalog-status-label">Отметить как</span>
            <div class="admin-catalog-statuses" role="group" aria-label="Статус игры">
              ${['completed','dropped','ignored'].map(status => `<button class="${current === status ? 'active' : ''}" data-library-value="${status}" type="button">${statusLabel(status)}</button>`).join('')}
            </div>
            <div class="admin-catalog-actions">
              ${steam ? `<a href="${escapeHtml(steam)}" target="_blank" rel="noopener noreferrer">Открыть в Steam ↗</a>` : ''}
              <button class="admin-catalog-save" data-catalog-action="save" type="button">Сохранить ↗</button>
              <button class="admin-catalog-delete" data-catalog-action="delete" aria-label="Удалить игру" type="button">×</button>
            </div>
          </div>
        </article>`;
    }).join('');
  }

  async function loadReactionCounts(supabase, renderAfter = true) {
    if (!supabase || state.reactionLoading) return;
    state.reactionLoading = true;
    try {
      const { data, error } = await supabase.rpc('get_game_vote_scores');
      if (error) throw error;
      const totals = new Map((data || []).map(item => [String(item.game_id), {
        like_count: Number(item.like_count) || 0,
        dislike_count: Number(item.dislike_count) || 0,
        reaction_score: Number(item.score) || 0
      }]));
      state.games = state.games.map(game => ({
        ...game,
        like_count: 0,
        dislike_count: 0,
        reaction_score: 0,
        ...(totals.get(String(game.id)) || {})
      }));
      if (renderAfter) {
        list.querySelectorAll('.admin-catalog-card[data-game-id]').forEach(card => {
          const game = state.games.find(item => String(item.id) === String(card.dataset.gameId));
          const element = card.querySelector('.admin-catalog-reactions');
          if (!game || !element) return;
          const likeCount = element.querySelector('[data-reaction-count="like"]');
          const dislikeCount = element.querySelector('[data-reaction-count="dislike"]');
          if (likeCount && dislikeCount) {
            likeCount.textContent = String(Number(game.like_count) || 0);
            dislikeCount.textContent = String(Number(game.dislike_count) || 0);
          } else {
            element.innerHTML = reactionMarkup(game.like_count, game.dislike_count);
          }
        });
      }
    } catch (error) {
      console.warn('Не удалось обновить реакции каталога:', error?.message || error);
    } finally {
      state.reactionLoading = false;
    }
  }

  function stopCatalogMonitoring() {
    window.clearInterval(state.reactionTimer);
    state.reactionTimer = 0;
    if (state.catalogChannel) {
      try { state.catalogChannel.unsubscribe(); } catch {}
      state.catalogChannel = null;
    }
  }

  function startCatalogMonitoring() {
    const supabase = client();
    if (!supabase) return;
    if (!state.reactionTimer) {
      state.reactionTimer = window.setInterval(() => {
        if (state.active && !document.hidden) loadReactionCounts(supabase);
      }, 4000);
    }
    if (!state.catalogChannel) {
      state.catalogChannel = supabase
        .channel('cr7-admin-published-games-v1')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, () => {
          if (state.active) loadGames(true, true);
        })
        .subscribe();
    }
  }

  async function loadGames(force = false, silent = false) {
    if (state.loading || (state.loaded && !force)) return;
    const supabase = client();
    if (!supabase) {
      list.innerHTML = '<div class="suggestions-empty">Supabase не настроен.</div>';
      return;
    }
    state.loading = true;
    if (!silent) list.innerHTML = '<div class="suggestions-empty">Загружаем опубликованные игры…</div>';
    try {
      const { data, error } = await supabase.from('games').select('id,title,steam_url,steam_app_id,cover_url,description,created_at,published,release_date,release_date_text,coming_soon,is_coop,coop_min_players,coop_max_players,players_min,players_max,player_count_source,library_status');
      if (error) throw error;
      state.games = Array.isArray(data) ? data : [];
      await loadReactionCounts(supabase, false);
      state.loaded = true;
      render();
    } catch (error) {
      list.innerHTML = `<div class="suggestions-empty">${escapeHtml(error?.message || 'Не удалось загрузить каталог.')}</div>`;
    } finally {
      state.loading = false;
    }
  }

  async function saveStatus(card, button) {
    const supabase = client();
    if (!supabase) return;
    const id = card.dataset.gameId;
    const status = card.dataset.libraryStatus || '';
    button.disabled = true;
    const defaultText = button.textContent;
    button.textContent = 'Сохраняем…';
    const { error } = await supabase.from('games').update({ library_status: status }).eq('id', id);
    button.disabled = false;
    button.textContent = error ? 'Ошибка' : 'Сохранено';
    if (!error) {
      const game = state.games.find(item => String(item.id) === String(id));
      if (game) game.library_status = status;
    }
    window.setTimeout(() => { button.textContent = defaultText; }, 1300);
  }

  async function deleteGame(card, button) {
    const game = state.games.find(item => String(item.id) === String(card.dataset.gameId));
    if (!game || !window.confirm(`Удалить «${game.title}» из каталога?`)) return;
    const supabase = client();
    if (!supabase) return;
    button.disabled = true;
    let error = null;
    try {
      if (typeof window.CR7_INVOKE_STEAM_FUNCTION !== 'function') throw new Error('Сервис удаления ещё не готов. Обнови страницу.');
      const result = await window.CR7_INVOKE_STEAM_FUNCTION({ action: 'delete-published-game', gameId: Number(game.id) });
      if (!result?.deleted) throw new Error(result?.error || 'Сервер не подтвердил удаление игры.');
    } catch (requestError) {
      error = requestError;
    }
    if (error) {
      button.disabled = false;
      window.alert(error.message || 'Не удалось удалить игру.');
      return;
    }
    state.games = state.games.filter(item => String(item.id) !== String(game.id));
    render();
  }

  publishedButton.textContent = 'Опубликованные';
  publishedButton.dataset.catalogCount = '0';

  publishedButton.addEventListener('click', () => {
    setCatalogMode(true);
    loadGames(true);
  }, true);

  pendingButton.addEventListener('click', () => {
    setCatalogMode(false);
    window.setTimeout(() => document.getElementById('suggestionModerationRefresh')?.click(), 0);
  }, true);

  search?.addEventListener('input', event => {
    state.query = event.target.value;
    if (state.active) render();
  });

  list.addEventListener('click', event => {
    if (!state.active) return;
    const card = event.target.closest('.admin-catalog-card');
    if (!card) return;
    const status = event.target.closest('[data-library-value]');
    if (status) {
      const value = status.dataset.libraryValue;
      const next = card.dataset.libraryStatus === value ? '' : value;
      card.dataset.libraryStatus = next;
      card.querySelectorAll('[data-library-value]').forEach(button => button.classList.toggle('active', button.dataset.libraryValue === next));
      return;
    }
    const action = event.target.closest('[data-catalog-action]');
    if (!action) return;
    if (action.dataset.catalogAction === 'save') saveStatus(card, action);
    if (action.dataset.catalogAction === 'delete') deleteGame(card, action);
  });

  window.addEventListener('cr7:supabase-ready', () => {
    if (state.active) loadGames(true);
  });
  window.addEventListener('cr7:game-published', () => {
    if (state.active) loadGames(true, true);
  });
  window.addEventListener('focus', () => {
    if (state.active) Promise.all([loadGames(true, true), loadReactionCounts(client())]);
  });
  window.addEventListener('beforeunload', stopCatalogMonitoring);
})();
