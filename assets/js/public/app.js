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

    const PUBLIC_GAME_FIELDS = 'id,title,steam_url,cover_url,description,author_comment,created_at,display_order,steam_app_id,release_date,release_date_text,coming_soon,steam_synced_at,is_coop,coop_type,coop_min_players,coop_max_players,coop_source';

    function runPublicRequest(client, operation) {
      return window.CR7_AUTH?.runPublicRequest
        ? window.CR7_AUTH.runPublicRequest(client,operation)
        : operation();
    }

    function getUsableSession(client) {
      return window.CR7_AUTH?.getUsableSession
        ? window.CR7_AUTH.getUsableSession(client)
        : client.auth.getSession();
    }

    function isMissingLibraryColumn(error) {
      if (!error) return false;
      const details = `${error.code || ''} ${error.message || ''} ${error.details || ''}`;
      return error.code === '42703'
        || /(?:library_status|is_favorite|tier_rank).*(?:does not exist|schema cache)/i.test(details)
        || /(?:does not exist|schema cache).*(?:library_status|is_favorite|tier_rank)/i.test(details);
    }

    function isMissingReputationRpc(error) {
      if (!error) return false;
      const details = `${error.code || ''} ${error.message || ''} ${error.details || ''}`;
      return ['42883','PGRST202'].includes(error.code) || /get_game_vote_scores|game_votes/i.test(details);
    }

    function resetReputationState() {
      state.reputationSchemaReady = false;
      state.reputationScores = {};
      state.reputationStats = {};
      state.currentVotes = {};
    }

    let reputationRefreshPromise = null;
    let reputationRefreshTimer = 0;
    let reputationMonitorClient = null;

    function reputationSnapshot() {
      const ordered = value => Object.entries(value || {}).sort(([left],[right]) => left.localeCompare(right));
      return JSON.stringify({
        scores: ordered(state.reputationScores),
        stats: ordered(state.reputationStats),
        votes: ordered(state.currentVotes)
      });
    }

    function updateReputationInPlace() {
      document.querySelectorAll('.game-card[data-game-id]').forEach(card => {
        const gameId = String(card.dataset.gameId || '');
        const score = Number(state.reputationScores?.[gameId] || 0);
        const element = card.querySelector('.game-reputation');
        if (!element) return;
        element.textContent = String(score);
        element.setAttribute('aria-label', `Голосов за игру: ${score}`);
      });
    }

    async function loadReputation(client) {
      const before = reputationSnapshot();
      const { data,error } = await runPublicRequest(client,() => client.rpc('get_game_vote_scores'));
      if (error) {
        if (!isMissingReputationRpc(error)) console.warn('Не удалось загрузить репутацию игр:',error.message || error);
        resetReputationState();
        return before !== reputationSnapshot();
      }
      state.reputationSchemaReady = true;
      state.reputationScores = Object.fromEntries((data || []).map(item => [String(item.game_id),Number(item.score) || 0]));
      state.reputationStats = Object.fromEntries((data || []).map(item => [String(item.game_id),{
        likes: Number(item.like_count) || 0,
        dislikes: Number(item.dislike_count) || 0,
        total: Number(item.reaction_count) || 0
      }]));
      const { data: sessionData } = await getUsableSession(client);
      if (!sessionData?.session?.user) {
        state.currentVotes = {};
        return before !== reputationSnapshot();
      }
      const { data: votes,error: votesError } = await runPublicRequest(client,() => client.rpc('get_my_game_votes'));
      state.currentVotes = votesError ? {} : Object.fromEntries((votes || []).map(item => [String(item.game_id),Number(item.vote) || 0]));
      return before !== reputationSnapshot();
    }

    function refreshReputation(client = reputationMonitorClient) {
      if (!client || reputationRefreshPromise) return reputationRefreshPromise;
      reputationRefreshPromise = loadReputation(client)
        .then(changed => {
          if (!changed) return;
          if (state.sort === 'rating-desc' || state.sort === 'rating-asc') render();
          else updateReputationInPlace();
          if (state.activeGameId) renderModalReactionState(state.activeGameId);
          window.dispatchEvent(new CustomEvent('cr7:reputation-refreshed'));
        })
        .catch(error => {
          console.warn('Репутация временно недоступна:', error?.message || error);
          resetReputationState();
        })
        .finally(() => { reputationRefreshPromise = null; });
      return reputationRefreshPromise;
    }

    function startReputationMonitor(client) {
      reputationMonitorClient = client;
      window.clearInterval(reputationRefreshTimer);
      reputationRefreshTimer = window.setInterval(() => {
        if (!document.hidden) refreshReputation(client);
      }, 4000);
    }

    async function loadGames(client) {
      const selectGames = fields => runPublicRequest(client,() => client
        .from('games')
        .select(fields)
        .eq('published', true));
      let result = await selectGames(`${PUBLIC_GAME_FIELDS},library_status,is_favorite,tier_rank,tier_order`);

      // Не скрываем весь каталог, если frontend опубликован раньше SQL-миграции.
      // После выполнения game_library_status.sql следующий Realtime/reload вернёт отметки.
      if (isMissingLibraryColumn(result.error)) {
        state.tierSchemaReady = false;
        result = await selectGames(`${PUBLIC_GAME_FIELDS},library_status,is_favorite`);
        if (isMissingLibraryColumn(result.error)) {
          state.librarySchemaReady = false;
          console.warn('Отметки библиотеки ещё не добавлены в Supabase; загружаем каталог без них.');
          result = await selectGames(PUBLIC_GAME_FIELDS);
        } else state.librarySchemaReady = true;
      } else {
        state.librarySchemaReady = true;
        state.tierSchemaReady = true;
      }

      if (result.error) throw result.error;
      state.games = (Array.isArray(result.data) ? result.data : []).map(game => ({
        library_status: '',
        is_favorite: false,
        tier_rank: '',
        tier_order: 0,
        ...game
      }));
      // Каталог не должен ждать необязательную RPC репутации: сначала показываем игры,
      // затем безопасно дорисовываем рейтинг отдельным запросом.
      render();
      refreshReputation(client);
    }

    async function start() {
      const client = getConfiguredClient();
      if (!client) {
        showFatal('Supabase ещё не настроен', 'Открой config.js и вставь Project URL и публичный publishable/anon key.');
        return;
      }

      try {
        await loadGames(client);
        setConnection('online', 'Каталог подключён');

        state.channel = client
          .channel('cr7-games-public-v2')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, async () => {
            try { await loadGames(client); } catch (error) { console.error(error); }
          })
          .subscribe(status => {
            if (status === 'SUBSCRIBED') setConnection('online', 'Обновляется онлайн');
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConnection('error', 'Связь потеряна');
          });
        startReputationMonitor(client);
      } catch (error) {
        console.error(error);
        showFatal('Не удалось загрузить игры', error.message || 'Проверь обновление таблицы и настройки Supabase.');
      }
    }

    elements.search.addEventListener('input', event => {
      state.query = event.target.value;
      render();
    });

    elements.filters.forEach(button => button.addEventListener('click', () => {
      state.filter = button.dataset.filter;
      elements.filters.forEach(item => item.classList.toggle('active', item === button));
      render();
    }));

    elements.libraryFilters.forEach(button => button.addEventListener('click', () => {
      const value = button.dataset.libraryFilter;
      if (state.libraryFilters.has(value)) state.libraryFilters.delete(value);
      else state.libraryFilters.add(value);
      button.classList.toggle('active', state.libraryFilters.has(value));
      button.setAttribute('aria-pressed', String(state.libraryFilters.has(value)));
      render();
    }));

    elements.libraryFiltersReset?.addEventListener('click', () => {
      state.libraryFilters.clear();
      elements.libraryFilters.forEach(button => {
        button.classList.remove('active');
        button.setAttribute('aria-pressed', 'false');
      });
      render();
    });

    elements.sort.addEventListener('change', event => {
      state.sort = event.target.value;
      render();
    });


    elements.heroHighlights.addEventListener('click', event => {
      const button = event.target.closest('.quick-game-card');
      if (!button || !button.dataset.gameId) return;
      openGameModal(button.dataset.gameId);
    });

    elements.modalClose.addEventListener('click', closeGameModal);
    elements.modal.addEventListener('click', event => {
      if (event.target.matches('[data-modal-close]')) closeGameModal();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !elements.modal.hidden) closeGameModal();
    });
    elements.nextRelease.addEventListener('click', () => {
      if (elements.nextRelease.dataset.gameId) openGameModal(elements.nextRelease.dataset.gameId);
    });
    elements.nextRelease.addEventListener('keydown', event => {
      if (!['Enter', ' '].includes(event.key) || !elements.nextRelease.dataset.gameId) return;
      event.preventDefault();
      openGameModal(elements.nextRelease.dataset.gameId);
    });

    window.addEventListener('beforeunload', () => {
      if (state.channel) state.channel.unsubscribe();
      window.clearInterval(reputationRefreshTimer);
    });
    window.addEventListener('focus', () => refreshReputation());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshReputation();
    });

    const cursorGlow = document.getElementById('cursorGlow');
    if (window.matchMedia('(pointer: fine)').matches && cursorGlow) {
      window.addEventListener('pointermove', event => {
        document.body.classList.add('pointer-active');
        cursorGlow.style.left = `${event.clientX}px`;
        cursorGlow.style.top = `${event.clientY}px`;
      }, { passive: true });
      document.addEventListener('mouseleave', () => document.body.classList.remove('pointer-active'));
    }

    function showSdkFailure() {
      showFatal('Не удалось подключить библиотеку Supabase','Проверь соединение, блокировщик контента или доступ к CDN и обнови страницу.');
    }

    let publicAppStarted = false;
    function startPublicApp() {
      if (publicAppStarted) return;
      if (!window.supabase?.createClient) {
        if (window.CR7_SUPABASE_SDK_STATUS === 'error') showSdkFailure();
        return;
      }
      publicAppStarted = true;
      start();
    }

    setupInfiniteTicker();
    activateDynamicEffects();
    window.addEventListener('cr7:supabase-ready',startPublicApp,{ once: true });
    window.addEventListener('cr7:supabase-error',showSdkFailure,{ once: true });
    startPublicApp();
    window.setTimeout(() => {
      if (!publicAppStarted && !window.supabase?.createClient) showSdkFailure();
    },13000);
