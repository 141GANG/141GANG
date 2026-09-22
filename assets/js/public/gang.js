(() => {
  'use strict';

  const streamers = [
    ['twitch','rostikfacekid'], ['twitch','tankzor'], ['twitch','sasavot'],
    ['twitch','yurapivo'], ['twitch','r4dom1r'], ['twitch','iceicell'],
    ['twitch','poisonika'], ['twitch','formixyouknow'], ['twitch','narek_cr'],
    ['kick','helin139ban'], ['twitch','timaevvv'], ['twitch','gagik'],
    ['twitch','kennethonline']
  ].map(([provider,channel],order) => ({ provider, channel, order }));
  const panel = document.getElementById('gangPanel');
  const grid = document.getElementById('gangGrid');
  const detectors = document.getElementById('gangDetectors');
  const openButton = document.getElementById('gangOpen');
  const dialog = panel?.querySelector('.gang-dialog');
  if (!panel || !grid || !detectors || !openButton || !dialog) return;

  let lastFocusedElement = null;
  let refreshTimer = 0;
  let requestController = null;
  let players = [];
  let fallbackTimeout = 0;
  let uptimeTimer = 0;
  const statusCacheKey = '141gang:stream-status:v1';
  const statusCacheMaxAge = 120000;
  const label = channel => channel.replace(/(^|_)(\w)/g,(_,prefix,letter) => `${prefix}${letter.toUpperCase()}`);
  const platformBadge = provider => provider === 'twitch'
    ? '<span class="gang-platform-icon" role="img" aria-label="Twitch"><img alt="" src="./assets/images/figma/twitch-icon.webp"/></span>'
    : provider === 'kick'
      ? '<span class="gang-platform-icon is-kick" role="img" aria-label="Kick"><img alt="" src="./assets/images/figma/kick-icon.jpg"/></span>'
      : '';
  const channelUrl = ({ provider,channel }) => `https://${provider === 'kick' ? 'kick.com' : 'www.twitch.tv'}/${channel}`;
  const fallbackAvatar = ({ provider,channel }) => `https://unavatar.io/${provider}/${encodeURIComponent(channel)}?fallback=false`;
  const imageUrl = value => {
    const url = String(value || '').trim();
    if (url.startsWith('//')) return `https:${url}`;
    if (url.startsWith('/')) return `https://kick.com${url}`;
    return /^https?:\/\//i.test(url) ? url : '';
  };

  const streamerKey = item => `${item.provider}:${String(item.channel).toLowerCase()}`;

  function rememberStatus(item) {
    if (item.available !== true) return;
    try {
      const stored = JSON.parse(sessionStorage.getItem(statusCacheKey) || '{}');
      const previous = Date.now() - Number(stored.checkedAt || 0) < statusCacheMaxAge
        && Array.isArray(stored.streamers) ? stored.streamers : [];
      const byChannel = new Map(previous.map(entry => [streamerKey(entry),entry]));
      byChannel.set(streamerKey(item),item);
      sessionStorage.setItem(statusCacheKey,JSON.stringify({
        checkedAt: Date.now(),
        streamers: [...byChannel.values()],
      }));
    } catch {}
  }

  function restoreCachedStatuses() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(statusCacheKey) || '{}');
      if (Date.now() - Number(cached.checkedAt || 0) >= statusCacheMaxAge) return;
      if (!Array.isArray(cached.streamers)) return;
      const allowed = new Set(streamers.map(streamerKey));
      cached.streamers.forEach(item => {
        if (item && item.available === true && allowed.has(streamerKey(item))) {
          applyStatus(item,false);
        }
      });
      sortCards();
    } catch {}
  }

  async function fetchSupabaseStatuses(signal) {
    const baseUrl = String(window.CR7_CONFIG?.supabaseUrl || '').replace(/\/$/,'');
    const apiKey = String(window.CR7_CONFIG?.supabasePublishableKey || '');
    if (!baseUrl.startsWith('https://') || !apiKey) throw new Error('Supabase stream status is not configured');
    const timeout = new AbortController();
    const timer = window.setTimeout(() => timeout.abort(),7000);
    const abort = () => timeout.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener('abort',abort,{ once: true });
    try {
      const response = await fetch(`${baseUrl}/functions/v1/stream-status`,{
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: apiKey },
        body: JSON.stringify({ streamers: streamers.map(({ provider,channel }) => ({ provider,channel })) }),
        signal: timeout.signal,
      });
      if (!response.ok) throw new Error(`Supabase stream status: ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload.streamers)) throw new Error('Invalid Supabase stream status response');
      const allowed = new Set(streamers.map(streamerKey));
      return payload.streamers.filter(item => item
        && allowed.has(streamerKey(item))
        && typeof item.available === 'boolean'
        && typeof item.live === 'boolean');
    } finally {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort',abort);
    }
  }

  function renderCards() {
    grid.innerHTML = streamers.map(streamer => `
      <a class="gang-card is-checking" data-channel="${streamer.channel}" data-provider="${streamer.provider}" data-order="${streamer.order}" data-status="checking" href="${channelUrl(streamer)}" rel="noopener noreferrer" target="_blank">
        <span class="gang-card-media">
          <span aria-hidden="true" class="gang-avatar-fallback">OFFLINE</span>
          <img alt="Аватар канала ${label(streamer.channel)}" class="gang-avatar" decoding="async" loading="lazy" onerror="this.hidden=true" referrerpolicy="no-referrer" src="${fallbackAvatar(streamer)}"/>
          <img alt="" aria-hidden="true" class="gang-preview" decoding="async" loading="lazy" referrerpolicy="no-referrer"/>
        </span>
        <span class="gang-card-badges">
          <span class="gang-category" hidden></span>
          <span class="gang-uptime" hidden title="Время эфира"></span>
        </span>
        <span class="gang-card-copy">
          <h3><span>${label(streamer.channel)}</span>${platformBadge(streamer.provider)}</h3>
          <p class="gang-stream-title">Загружаем статус канала…</p>
          <small>${streamer.provider === 'kick' ? 'kick.com' : 'twitch.tv'}/${streamer.channel}</small>
        </span>
      </a>`).join('');
  }

  function cardFor(item) {
    return grid.querySelector(`[data-provider="${item.provider}"][data-channel="${String(item.channel).toLowerCase()}"]`);
  }

  function sortCards() {
    const rank = { live: 0, checking: 1, offline: 2, unavailable: 3 };
    [...grid.children]
      .sort((a,b) => rank[a.dataset.status] - rank[b.dataset.status] || Number(a.dataset.order) - Number(b.dataset.order))
      .forEach(card => grid.appendChild(card));
  }

  function formatUptime(value) {
    const startedAt = Date.parse(value || '');
    if (!Number.isFinite(startedAt)) return '';
    const totalSeconds = Math.max(0,Math.floor((Date.now() - startedAt) / 1000));
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2,'0');
    const minutes = String(Math.floor(totalSeconds % 3600 / 60)).padStart(2,'0');
    const seconds = String(totalSeconds % 60).padStart(2,'0');
    return `${hours}:${minutes}:${seconds}`;
  }

  function updateUptimes() {
    grid.querySelectorAll('.gang-card.is-live').forEach(card => {
      const uptime = card.querySelector('.gang-uptime');
      const text = formatUptime(card.dataset.startedAt);
      uptime.textContent = text;
      uptime.hidden = !text;
    });
  }

  function applyStatus(item,remember = true) {
    const card = cardFor(item);
    if (!card) return;
    const live = item.live === true;
    const nextStatus = live ? 'live' : item.available === false ? 'unavailable' : 'offline';
    const avatar = card.querySelector('.gang-avatar');
    const preview = card.querySelector('.gang-preview');
    const category = card.querySelector('.gang-category');
    const uptime = card.querySelector('.gang-uptime');
    const fallback = card.querySelector('.gang-avatar-fallback');
    card.dataset.status = nextStatus;
    card.dataset.startedAt = live ? (item.startedAt || '') : '';
    card.classList.toggle('is-live',live);
    card.classList.remove('has-live-preview','is-checking');
    fallback.textContent = live ? 'LIVE' : 'OFFLINE';
    const streamTitle = card.querySelector('.gang-stream-title');
    streamTitle.textContent = live ? (item.title || 'Прямой эфир') : nextStatus === 'unavailable' ? 'Статус временно недоступен' : '';
    streamTitle.hidden = !streamTitle.textContent;
    category.textContent = item.category || '';
    category.hidden = !live || !item.category;
    const uptimeText = live ? formatUptime(item.startedAt) : '';
    uptime.textContent = uptimeText;
    uptime.hidden = !uptimeText;
    const avatarSource = imageUrl(item.avatarUrl);
    const previewSource = imageUrl(item.thumbnailUrl).replace('{width}','640').replace('{height}','360');
    if (avatarSource) {
      avatar.hidden = false;
      avatar.src = avatarSource;
    }
    preview.onload = () => {
      preview.hidden = false;
      card.classList.add('has-live-preview');
    };
    preview.onerror = () => {
      preview.hidden = true;
      card.classList.remove('has-live-preview');
      preview.removeAttribute('src');
    };
    if (live && previewSource) {
      preview.hidden = false;
      preview.src = previewSource;
    } else {
      preview.hidden = true;
      preview.removeAttribute('src');
    }
    if (remember) rememberStatus(item);
  }

  function destroyFallbackPlayers() {
    window.clearTimeout(fallbackTimeout);
    players.forEach(player => {
      try {
        player.destroy();
      } catch {}
    });
    players = [];
    detectors.replaceChildren();
  }

  function startedAtFromUptime(value) {
    const text = String(value || '').toLowerCase();
    const units = [
      [/([\d.]+)\s*(?:days?|д(?:н(?:я|ей)?)?)/,86400000],
      [/([\d.]+)\s*(?:hours?|hrs?|ч(?:ас(?:а|ов)?)?)/,3600000],
      [/([\d.]+)\s*(?:minutes?|mins?|мин(?:ут[ы]?)?)/,60000],
      [/([\d.]+)\s*(?:seconds?|secs?|сек(?:унд[ы]?)?)/,1000],
    ];
    const elapsed = units.reduce(
      (total,[pattern,multiplier]) => total + Number(text.match(pattern)?.[1] || 0) * multiplier,
      0
    );
    return elapsed > 0 ? new Date(Date.now() - elapsed).toISOString() : '';
  }

  async function fillMissingTwitchUptime(item,signal) {
    if (item.provider !== 'twitch' || !item.live || Number.isFinite(Date.parse(item.startedAt || ''))) return;
    const timeout = new AbortController();
    const timer = window.setTimeout(() => timeout.abort(),6000);
    const abort = () => timeout.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener('abort',abort,{ once: true });
    try {
      const response = await fetch(
        `https://decapi.me/twitch/uptime/${encodeURIComponent(item.channel)}`,
        { signal: timeout.signal }
      );
      if (!response.ok) return;
      const startedAt = startedAtFromUptime(await response.text());
      const card = cardFor(item);
      if (!startedAt || signal?.aborted || card?.dataset.status !== 'live' || card.dataset.startedAt) return;
      card.dataset.startedAt = startedAt;
      const uptime = card.querySelector('.gang-uptime');
      uptime.textContent = formatUptime(startedAt);
      uptime.hidden = false;
      rememberStatus({ ...item,startedAt });
    } catch (error) {
      if (error?.name !== 'AbortError') console.warn(`141 GANG uptime (${item.channel}):`,error);
    } finally {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort',abort);
    }
  }

  async function twitchFallbackMetadata(channel) {
    const read = async path => {
      const timeout = new AbortController();
      const timer = window.setTimeout(() => timeout.abort(),6000);
      const abort = () => timeout.abort();
      const parentSignal = requestController?.signal;
      if (parentSignal?.aborted) abort();
      parentSignal?.addEventListener('abort',abort,{ once: true });
      try {
        const response = await fetch(
          `https://decapi.me/twitch/${path}/${encodeURIComponent(channel)}`,
          { signal: timeout.signal }
        );
        if (!response.ok) throw new Error(`Twitch metadata: ${response.status}`);
        return (await response.text()).trim();
      } finally {
        window.clearTimeout(timer);
        parentSignal?.removeEventListener('abort',abort);
      }
    };
    const uptime = await read('uptime');
    const offlinePattern = /(?:channel is offline|not live|currently offline|offline)/i;
    const startedAt = startedAtFromUptime(uptime);
    if (offlinePattern.test(uptime)) {
      return { available: true, live: false, title: '', category: '', startedAt: '' };
    }
    if (!startedAt) {
      throw new Error(`Unknown Twitch uptime response: ${uptime}`);
    }
    const [titleResult,categoryResult] = await Promise.allSettled([read('title'),read('game')]);
    const title = titleResult.status === 'fulfilled' ? titleResult.value : '';
    const category = categoryResult.status === 'fulfilled' ? categoryResult.value : '';
    return {
      available: true,
      live: true,
      title: offlinePattern.test(title) ? '' : title,
      category: offlinePattern.test(category) ? '' : category,
      startedAt,
    };
  }

  async function applyTwitchFallback(channel,live) {
    const streamer = streamers.find(item => item.provider === 'twitch' && item.channel === channel);
    if (!streamer) return;
    const fallback = {
      ...streamer,
      available: true,
      live,
      title: live ? 'Прямой эфир — открыть на Twitch' : '',
      category: '',
      thumbnailUrl: live
        ? `https://static-cdn.jtvnw.net/previews-ttv/live_user_${channel}-640x360.jpg?t=${Date.now()}`
        : '',
      avatarUrl: '',
      startedAt: '',
    };
    applyStatus(fallback);
    sortCards();
    if (!live) return;
    try {
      const metadata = await twitchFallbackMetadata(channel);
      const card = cardFor(streamer);
      if (card?.dataset.status === 'live') {
        applyStatus({ ...fallback,...metadata,available: true,live: true });
      }
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.warn(`141 GANG metadata (${channel}):`,error);
      }
    }
  }

  async function checkTwitchDirect(streamer) {
    try {
      const metadata = await twitchFallbackMetadata(streamer.channel);
      if (requestController?.signal.aborted) return false;
      applyStatus({
        ...streamer,
        ...metadata,
        thumbnailUrl: metadata.live
          ? `https://static-cdn.jtvnw.net/previews-ttv/live_user_${streamer.channel}-640x360.jpg?t=${Date.now()}`
          : '',
        avatarUrl: '',
      });
      sortCards();
      return true;
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.warn(`141 GANG direct check (${streamer.channel}):`,error);
      }
      return false;
    }
  }

  function waitForTwitchPlayer(signal) {
    if (window.Twitch?.Player) return Promise.resolve(true);
    if (!document.getElementById('twitchPlayerSdk')) {
      const script = document.createElement('script');
      script.id = 'twitchPlayerSdk';
      script.src = 'https://player.twitch.tv/js/embed/v1.js';
      script.async = true;
      document.head.appendChild(script);
    }
    return new Promise(resolve => {
      const startedAt = Date.now();
      const poll = () => {
        if (signal?.aborted) {
          resolve(false);
          return;
        }
        if (window.Twitch?.Player) {
          resolve(true);
          return;
        }
        if (Date.now() - startedAt >= 10000) {
          resolve(false);
          return;
        }
        window.setTimeout(poll,50);
      };
      poll();
    });
  }

  async function checkTwitchWithPlayer(streamersToCheck,signal) {
    if (!streamersToCheck.length) return;
    const directResults = await Promise.all(
      streamersToCheck.map(checkTwitchDirect)
    );
    if (signal?.aborted) return;
    const resolved = new Set(
      streamersToCheck
        .filter((_,index) => directResults[index])
        .map(streamer => streamer.channel)
    );
    const playerStreamers = streamersToCheck.filter(
      streamer => !resolved.has(streamer.channel)
    );
    if (!playerStreamers.length) {
      sortCards();
      return;
    }

    const playerReady = await waitForTwitchPlayer(signal);
    if (signal?.aborted) return;
    if (!playerReady) {
      playerStreamers.forEach(streamer => applyStatus({ ...streamer, available: false }));
      sortCards();
      return;
    }

    const parent = window.location.hostname || 'localhost';
    playerStreamers.forEach(streamer => {
      const detector = document.createElement('div');
      detector.className = 'gang-detector';
      detector.id = `gangDetector-${streamer.channel}`;
      detectors.appendChild(detector);
      const player = new window.Twitch.Player(detector.id,{
        channel: streamer.channel,
        parent: [parent],
        width: 400,
        height: 300,
        autoplay: false,
        muted: true
      });
      player.addEventListener(
        window.Twitch.Player.ONLINE,
        () => applyTwitchFallback(streamer.channel,true)
      );
      player.addEventListener(
        window.Twitch.Player.OFFLINE,
        () => applyTwitchFallback(streamer.channel,false)
      );
      players.push(player);
    });

    fallbackTimeout = window.setTimeout(() => {
      playerStreamers.forEach(streamer => {
        const card = cardFor(streamer);
        if (card?.dataset.status === 'checking') {
          applyStatus({ ...streamer, available: false });
        }
      });
      sortCards();
    },15000);
  }

  async function checkKickDirect(streamer) {
    try {
      const response = await fetch(
        `https://kick.com/api/v2/channels/${encodeURIComponent(streamer.channel)}`,
        { headers: { Accept: 'application/json' }, signal: requestController?.signal }
      );
      if (!response.ok) throw new Error(`Kick: ${response.status}`);
      const data = await response.json();
      const live = data.livestream || null;
      const thumbnail = live?.thumbnail?.url
        || (typeof live?.thumbnail === 'string' ? live.thumbnail : '')
        || live?.thumbnail_url
        || data.banner_image?.url
        || data.banner_image?.src
        || '';
      const avatar = data.user?.profile_pic
        || data.user?.profile_picture
        || data.profile_picture
        || data.user?.avatar
        || data.avatar
        || '';
      applyStatus({
        ...streamer,
        available: true,
        live: Boolean(live),
        title: live?.session_title || '',
        category: live?.categories?.[0]?.name || live?.category?.name || '',
        thumbnailUrl: thumbnail,
        avatarUrl: avatar,
        startedAt: live?.start_time || live?.created_at || live?.started_at || '',
      });
    } catch (error) {
      if (error?.name === 'AbortError') return;
      console.warn('141 GANG Kick fallback:',error);
      applyStatus({ ...streamer, available: false });
    }
  }

  async function checkLiveChannels() {
    window.clearTimeout(refreshTimer);
    requestController?.abort();
    requestController = new AbortController();
    const signal = requestController.signal;
    destroyFallbackPlayers();

    let verified = [];
    try {
      verified = (await fetchSupabaseStatuses(signal)).filter(item => item.available === true);
      if (signal.aborted) return;
      verified.forEach(item => applyStatus(item));
      sortCards();
    } catch (error) {
      if (signal.aborted) return;
      console.warn('141 GANG Supabase stream status:',error);
    }

    const resolved = new Set(verified.map(streamerKey));
    const twitch = streamers.filter(streamer => streamer.provider === 'twitch' && !resolved.has(streamerKey(streamer)));
    const kick = streamers.filter(streamer => streamer.provider === 'kick' && !resolved.has(streamerKey(streamer)));
    await Promise.all([
      checkTwitchWithPlayer(twitch,signal),
      Promise.all(kick.map(checkKickDirect)),
      Promise.all(verified.map(item => fillMissingTwitchUptime(item,signal)))
    ]);
    if (signal.aborted) return;
    sortCards();

    if (panel.getAttribute('aria-hidden') === 'false') {
      refreshTimer = window.setTimeout(checkLiveChannels,120000);
    }
  }

  function openPanel() {
    lastFocusedElement = document.activeElement;
    panel.hidden = false;
    panel.setAttribute('aria-hidden','false');
    openButton.setAttribute('aria-expanded','true');
    document.body.classList.add('gang-open');
    requestAnimationFrame(() => {
      panel.classList.add('is-open');
      dialog.focus({ preventScroll: true });
    });
    window.clearInterval(uptimeTimer);
    uptimeTimer = window.setInterval(updateUptimes,1000);
    restoreCachedStatuses();
    checkLiveChannels();
  }

  function closePanel() {
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden','true');
    openButton.setAttribute('aria-expanded','false');
    document.body.classList.remove('gang-open');
    window.clearTimeout(refreshTimer);
    window.clearInterval(uptimeTimer);
    requestController?.abort();
    destroyFallbackPlayers();
    window.setTimeout(() => {
      panel.hidden = true;
      lastFocusedElement?.focus();
    },420);
  }

  renderCards();
  openButton.addEventListener('click',openPanel);
  panel.addEventListener('click',event => {
    if (event.target.matches('[data-gang-close]')) closePanel();
  });
  document.addEventListener('keydown',event => {
    if (panel.hidden) return;
    if (event.key === 'Escape') closePanel();
    if (event.key !== 'Tab') return;
    const focusable = [...panel.querySelectorAll('button,a[href]')];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (document.activeElement === dialog) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
})();

