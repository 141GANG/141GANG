(() => {
  'use strict';

  const REFRESH_INTERVAL_MS = 120000;
  const REALTIME_CHANNEL = 'cr7-games-public-guard-v1';
  let refreshTimer = 0;
  let refreshPromise = null;
  let guardChannel = null;
  let lastRefreshAt = 0;

  function getClient() {
    try {
      if (typeof getConfiguredClient === 'function') return getConfiguredClient();
    } catch (error) {
      console.warn('Не удалось получить Supabase-клиент для обновления каталога:', error?.message || error);
    }
    return window.CR7_SUPABASE_CLIENT || null;
  }

  async function refreshCatalog(reason = 'manual') {
    if (document.hidden && reason === 'interval') return;
    if (refreshPromise) return refreshPromise;
    if (Date.now() - lastRefreshAt < 3000) return;

    const client = getClient();
    if (!client || typeof loadGames !== 'function') return;

    refreshPromise = Promise.resolve()
      .then(() => loadGames(client))
      .then(() => {
        lastRefreshAt = Date.now();
        window.dispatchEvent(new CustomEvent('cr7:catalog-refreshed', { detail: { reason } }));
      })
      .catch(error => {
        console.warn(`Не удалось обновить каталог (${reason}):`, error?.message || error);
      })
      .finally(() => {
        refreshPromise = null;
      });

    return refreshPromise;
  }

  function scheduleInterval() {
    window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(() => refreshCatalog('interval'), REFRESH_INTERVAL_MS);
  }

  function subscribeGuard() {
    const client = getClient();
    if (!client || guardChannel) return;

    guardChannel = client
      .channel(REALTIME_CHANNEL)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, () => {
        window.clearTimeout(subscribeGuard.debounceTimer);
        subscribeGuard.debounceTimer = window.setTimeout(() => refreshCatalog('realtime'), 180);
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') return;
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          try { guardChannel?.unsubscribe?.(); } catch {}
          guardChannel = null;
          window.setTimeout(subscribeGuard, 5000);
        }
      });
  }

  function startGuard() {
    subscribeGuard();
    scheduleInterval();
    refreshCatalog('startup');
  }

  window.addEventListener('focus', () => refreshCatalog('focus'));
  window.addEventListener('online', () => {
    subscribeGuard();
    refreshCatalog('online');
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshCatalog('visibility');
  });
  window.addEventListener('beforeunload', () => {
    window.clearInterval(refreshTimer);
    try { guardChannel?.unsubscribe?.(); } catch {}
  });

  if (window.CR7_SUPABASE_CLIENT || window.supabase?.createClient) startGuard();
  else window.addEventListener('cr7:supabase-ready', startGuard, { once: true });
})();
