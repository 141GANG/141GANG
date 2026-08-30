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
  const closeButton = document.getElementById('gangClose');
  const status = document.getElementById('gangStatus');
  if (!panel || !grid || !detectors || !openButton || !closeButton || !status) return;

  let lastFocusedElement = null;
  let refreshTimer = 0;
  let requestController = null;
  let players = [];
  let fallbackTimeout = 0;
  let uptimeTimer = 0;
  const regionRestrictedChannels = new Set(['yurapivo','r4dom1r']);

  const label = channel => channel.replace(/(^|_)(\w)/g,(_,prefix,letter) => `${prefix}${letter.toUpperCase()}`);
  const channelUrl = ({ provider,channel }) => `https://${provider === 'kick' ? 'kick.com' : 'www.twitch.tv'}/${channel}`;
  const fallbackAvatar = ({ provider,channel }) => `https://unavatar.io/${provider}/${encodeURIComponent(channel)}?fallback=false`;
  const imageUrl = value => {
    const url = String(value || '').trim();
    if (url.startsWith('//')) return `https:${url}`;
    if (url.startsWith('/')) return `https://kick.com${url}`;
    return /^https?:\/\//i.test(url) ? url : '';
  };

  function renderCards() {
    grid.innerHTML = streamers.map(streamer => `
      <a class="gang-card is-checking" data-channel="${streamer.channel}" data-provider="${streamer.provider}" data-order="${streamer.order}" data-status="checking" href="${channelUrl(streamer)}" rel="noopener noreferrer" target="_blank">
        <span class="gang-card-media">
          <span aria-hidden="true" class="gang-avatar-fallback">${label(streamer.channel).slice(0,1)}</span>
          <img alt="Аватар канала ${label(streamer.channel)}" class="gang-avatar" decoding="async" loading="lazy" onerror="this.hidden=true" referrerpolicy="no-referrer" src="${fallbackAvatar(streamer)}"/>
          <img alt="" aria-hidden="true" class="gang-preview" decoding="async" loading="lazy" referrerpolicy="no-referrer"/>
        </span>
        <span class="gang-card-copy">
          <span class="gang-card-topline"><span class="gang-live">Проверяем эфир</span><span class="gang-provider">${streamer.provider}</span></span>
          <h3>${label(streamer.channel)}</h3>
          <span class="gang-category" hidden></span>
          <p class="gang-stream-title">Получаем актуальный статус…</p>
          <span class="gang-uptime" hidden></span>
          <small>${streamer.provider === 'kick' ? 'kick.com' : 'twitch.tv'}/${streamer.channel}</small>
        </span>
        <span class="gang-card-arrow" aria-hidden="true">↗</span>
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

  function updateSummary(message = '') {
    if (message) {
      status.textContent = message;
      return;
    }
    const cards = [...grid.children];
    const liveCount = cards.filter(card => card.dataset.status === 'live').length;
    const checkingCount = cards.filter(card => card.dataset.status === 'checking').length;
    const unavailableCount = cards.filter(card => card.dataset.status === 'unavailable').length;
    if (checkingCount) status.textContent = `Проверяем каналы: ${cards.length - checkingCount} из ${cards.length}`;
    else if (liveCount) status.textContent = `Сейчас стримят: ${liveCount} · онлайн-каналы показаны первыми`;
    else if (unavailableCount === cards.length) status.textContent = 'Статусы временно недоступны · каналы можно открыть вручную';
    else status.textContent = 'Сейчас все участники вне эфира';
  }

  function formatUptime(value) {
    const startedAt = Date.parse(value || '');
    if (!Number.isFinite(startedAt)) return '';
    const totalMinutes = Math.max(0,Math.floor((Date.now() - startedAt) / 60000));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor(totalMinutes % 1440 / 60);
    const minutes = totalMinutes % 60;
    return `В эфире ${days ? `${days} д ` : ''}${hours ? `${hours} ч ` : ''}${minutes} мин`;
  }

  function updateUptimes() {
    grid.querySelectorAll('.gang-card.is-live').forEach(card => {
      const uptime = card.querySelector('.gang-uptime');
      const text = formatUptime(card.dataset.startedAt);
      uptime.textContent = text;
      uptime.hidden = !text;
    });
  }

  function applyStatus(item) {
    const card = cardFor(item);
    if (!card) return;
    const live = item.live === true;
    const nextStatus = live ? 'live' : item.available === false ? 'unavailable' : 'offline';
    const avatar = card.querySelector('.gang-avatar');
    const preview = card.querySelector('.gang-preview');
    const category = card.querySelector('.gang-category');
    const uptime = card.querySelector('.gang-uptime');
    card.dataset.status = nextStatus;
    card.dataset.startedAt = live ? (item.startedAt || '') : '';
    card.classList.toggle('is-live',live);
    card.classList.remove('has-live-preview','is-checking');
    card.querySelector('.gang-live').textContent = live ? 'Сейчас в эфире' : nextStatus === 'unavailable' ? 'Статус недоступен' : 'Не в эфире';
    card.querySelector('.gang-stream-title').textContent = live ? (item.title || 'Прямой эфир') : nextStatus === 'unavailable' ? 'Открой канал, чтобы проверить эфир' : 'Канал сейчас отдыхает';
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

  async function twitchFallbackMetadata(channel) {
    const read = async path => {
      const response = await fetch(
        `https://decapi.me/twitch/${path}/${encodeURIComponent(channel)}`,
        { signal: requestController?.signal }
      );
      if (!response.ok) throw new Error(`Twitch metadata: ${response.status}`);
      return (await response.text()).trim();
    };
    const [title,category,uptime] = await Promise.all([
      read('title'),
      read('game'),
      read('uptime')
    ]);
    const offlinePattern = /(?:channel is offline|not live|currently offline|offline)/i;
    const startedAt = startedAtFromUptime(uptime);
    if (!startedAt && !offlinePattern.test(uptime)) {
      throw new Error(`Unknown Twitch uptime response: ${uptime}`);
    }
    return {
      available: true,
      live: Boolean(startedAt),
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
    updateSummary();
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

  async function checkRegionRestrictedChannel(streamer) {
    try {
      const metadata = await twitchFallbackMetadata(streamer.channel);
      applyStatus({
        ...streamer,
        ...metadata,
        thumbnailUrl: metadata.live
          ? `https://static-cdn.jtvnw.net/previews-ttv/live_user_${streamer.channel}-640x360.jpg?t=${Date.now()}`
          : '',
        avatarUrl: '',
      });
      return true;
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.warn(`141 GANG regional check (${streamer.channel}):`,error);
      }
      return false;
    }
  }

  function waitForTwitchPlayer(signal) {
    if (window.Twitch?.Player) return Promise.resolve(true);
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
    const restricted = streamersToCheck.filter(
      streamer => regionRestrictedChannels.has(streamer.channel)
    );
    const regionalResults = await Promise.all(
      restricted.map(checkRegionRestrictedChannel)
    );
    if (signal?.aborted) return;
    const resolved = new Set(
      restricted
        .filter((_,index) => regionalResults[index])
        .map(streamer => streamer.channel)
    );
    const playerStreamers = streamersToCheck.filter(
      streamer => !resolved.has(streamer.channel)
    );
    if (!playerStreamers.length) {
      sortCards();
      updateSummary();
      return;
    }

    const playerReady = await waitForTwitchPlayer(signal);
    if (signal?.aborted) return;
    if (!playerReady) {
      playerStreamers.forEach(streamer => applyStatus({ ...streamer, available: false }));
      sortCards();
      updateSummary();
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
      updateSummary();
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
    destroyFallbackPlayers();
    [...grid.children].forEach(card => {
      card.dataset.status = 'checking';
      card.classList.add('is-checking');
    });
    sortCards();
    updateSummary();

    const twitch = streamers.filter(streamer => streamer.provider === 'twitch');
    const kick = streamers.filter(streamer => streamer.provider === 'kick');
    await Promise.all([
      checkTwitchWithPlayer(twitch,requestController.signal),
      Promise.all(kick.map(checkKickDirect))
    ]);
    sortCards();
    updateSummary();

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
      closeButton.focus();
    });
    window.clearInterval(uptimeTimer);
    uptimeTimer = window.setInterval(updateUptimes,30000);
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
  closeButton.addEventListener('click',closePanel);
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

