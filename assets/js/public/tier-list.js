(() => {
  const panel = document.getElementById('tierListPanel');
  const openButton = document.getElementById('tierListOpen');
  const closeButton = document.getElementById('tierListClose');
  const board = document.getElementById('tierBoard');
  const adminStatus = document.getElementById('tierAdminStatus');
  const adminTools = document.getElementById('tierAdminTools');
  const rowDialog = document.getElementById('tierRowDialog');
  const rowLabel = document.getElementById('tierRowLabel');
  const rowColor = document.getElementById('tierRowColor');
  const resetButton = document.getElementById('tierReset');
  const resetDialog = document.getElementById('tierResetDialog');
  const colorPresets = document.getElementById('tierColorPresets');
  const resetConfirm = document.getElementById('tierResetConfirm');
  const rowSave = document.getElementById('tierRowSave');
  const ownerButtons = [...document.querySelectorAll('[data-tier-owner]')];
  const listButtons = [...document.querySelectorAll('[data-tier-list]')];
  const standalone = new URLSearchParams(location.search).get('view') === 'tier'
    || /\/tier-list\.html$/i.test(location.pathname);

  function getConfiguredClient() {
    if (window.CR7_SUPABASE_CLIENT) return window.CR7_SUPABASE_CLIENT;
    const config = window.CR7_CONFIG || {};
    const url = String(config.supabaseUrl || '');
    const key = String(config.supabasePublishableKey || '');
    const configured = url.startsWith('https://')
      && !url.includes('YOUR-PROJECT')
      && key
      && !key.includes('YOUR-PUBLISHABLE');
    if (!configured || !window.supabase?.createClient) return null;
    window.CR7_SUPABASE_CLIENT = window.supabase.createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
    return window.CR7_SUPABASE_CLIENT;
  }

  if (!panel || !closeButton || !board || !adminStatus || !adminTools || !rowDialog || !rowLabel || !rowColor || !resetButton || !resetDialog || !colorPresets || !resetConfirm || !rowSave || !ownerButtons.length || !listButtons.length) return;

  const base = [
    { id: 'S', label: 'S', color: '#e63d3d' },
    { id: 'A', label: 'A', color: '#e6913d' },
    { id: 'B', label: 'B', color: '#e6d23d' },
    { id: 'C', label: 'C', color: '#a5e63d' },
    { id: 'D', label: 'D', color: '#4be63d' }
  ];
  const legacyColors = {
    '#ff7f7f': '#e63d3d',
    '#ffbf7f': '#e6913d',
    '#ffdf7f': '#e6d23d',
    '#ffff7f': '#a5e63d',
    '#bfff7f': '#4be63d'
  };
  const validTiers = new Set(base.map(row => row.id));
  const cache = new Map();
  const storagePrefix = '141gang:tier-board:v2:';

  let activeOwner = 'sasaavot';
  let activeList = 'games';
  let currentBoard = createBoard();
  let rows = currentBoard.rows;
  let isAdmin = false;
  let multiBoardReady = null;
  let lastFocus = null;
  let draggedId = '';
  let dragPreview = null;
  let editingRow = '';
  let opening = null;
  let loadSequence = 0;
  let saveChain = Promise.resolve();

  function cloneRows(source = base) {
    return source.map(row => ({ ...row }));
  }

  function normalizeRows(config) {
    if (!Array.isArray(config)) return cloneRows();
    const valid = config
      .filter(row => row && validTiers.has(String(row.id || '').toUpperCase()))
      .map(row => ({
        id: String(row.id).toUpperCase(),
        label: String(row.label || row.id).trim() || String(row.id).toUpperCase(),
        color: legacyColors[String(row.color || '').toLowerCase()] || row.color || base.find(item => item.id === String(row.id).toUpperCase())?.color
      }));
    // Repair the reversed B-D tail produced by the previous row controls,
    // while preserving any other deliberately customised row order.
    if (valid.map(row => row.id).join(',') === 'S,A,D,C,B') {
      valid.sort((a, b) => base.findIndex(row => row.id === a.id) - base.findIndex(row => row.id === b.id));
    }
    return valid.length === base.length ? valid : cloneRows();
  }

  function normalizePlacements(source) {
    const placements = new Map();
    if (!Array.isArray(source)) return placements;
    source.forEach((entry, fallbackOrder) => {
      const id = String(entry?.id ?? '').trim();
      if (!id) return;
      const requestedTier = String(entry?.tier || '').trim().toUpperCase();
      placements.set(id, {
        tier: validTiers.has(requestedTier) ? requestedTier : '',
        order: Number.isFinite(Number(entry?.order)) ? Number(entry.order) : fallbackOrder
      });
    });
    return placements;
  }

  function createBoard(config, placements) {
    return {
      rows: normalizeRows(config),
      placements: placements instanceof Map ? new Map(placements) : normalizePlacements(placements)
    };
  }

  function boardKey(owner = activeOwner, list = activeList) {
    return `${owner}:${list}`;
  }

  function eligibleGames() {
    return state.games
      .filter(game => ['completed', 'dropped'].includes(String(game.library_status || '')))
      .sort((a, b) => {
        const order = (Number(a.tier_order) || 0) - (Number(b.tier_order) || 0);
        return order || String(a.title || '').localeCompare(String(b.title || ''), 'ru');
      });
  }

  function sourceItems() {
    // Food and cars intentionally start empty. Their future content never
    // inherits game records from the catalog.
    return activeList === 'games' ? eligibleGames() : [];
  }

  function itemId(item) {
    return String(item.id);
  }

  function ensurePlacements() {
    sourceItems().forEach((item, index) => {
      const id = itemId(item);
      if (!currentBoard.placements.has(id)) {
        const useLegacyPlacement = multiBoardReady === false && activeOwner === 'sasaavot' && activeList === 'games';
        const legacyTier = useLegacyPlacement ? String(item.tier_rank || '').trim().toUpperCase() : '';
        currentBoard.placements.set(id, {
          tier: validTiers.has(legacyTier) ? legacyTier : '',
          order: useLegacyPlacement ? Number(item.tier_order) || index : index
        });
      }
    });
  }

  function placementFor(item) {
    const id = itemId(item);
    return currentBoard.placements.get(id) || { tier: '', order: Number.MAX_SAFE_INTEGER };
  }

  function itemsInTier(tier) {
    ensurePlacements();
    return sourceItems()
      .filter(item => placementFor(item).tier === tier)
      .sort((a, b) => {
        const order = placementFor(a).order - placementFor(b).order;
        return order || String(a.title || '').localeCompare(String(b.title || ''), 'ru');
      });
  }

  function gameCard(game) {
    const cover = safeExternalUrl(game.cover_url) || './assets/images/figma/game-placeholder.svg';
    return `<article class="tier-game" ${isAdmin ? 'draggable="true" tabindex="0"' : ''} data-tier-game="${escapeHtml(game.id)}" title="${escapeHtml(game.title)}"><img alt="Обложка ${escapeHtml(game.title)}" src="${escapeHtml(cover)}" draggable="false" loading="lazy" decoding="async" referrerpolicy="no-referrer"><span>${escapeHtml(game.title)}</span></article>`;
  }

  function removeDragPreview() {
    dragPreview?.remove();
    dragPreview = null;
  }

  function useCardDragPreview(event, card) {
    removeDragPreview();
    const rect = card.getBoundingClientRect();
    const preview = card.cloneNode(true);
    preview.removeAttribute('id');
    preview.removeAttribute('tabindex');
    preview.removeAttribute('draggable');
    preview.removeAttribute('data-tier-game');
    preview.classList.remove('is-dragging');
    preview.classList.add('tier-drag-preview');
    preview.setAttribute('aria-hidden', 'true');
    preview.style.width = `${rect.width}px`;
    preview.style.height = `${rect.height}px`;
    document.body.appendChild(preview);
    dragPreview = preview;

    const offsetX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const offsetY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    event.dataTransfer.setDragImage(preview, offsetX, offsetY);
  }

  function renderTierList() {
    const allRows = [...rows, { id: '', label: 'Без оценки', color: '#202020' }];
    board.innerHTML = allRows.map((row, index) => {
      const entries = itemsInTier(row.id);
      const empty = row.id === '' ? 'Здесь появятся новые элементы' : 'Перетащите элементы сюда';
      return `<section class="tier-row${row.id === '' ? ' is-pool' : ''}" data-tier="${row.id}" style="--tier-color:${row.color}"><strong>${escapeHtml(row.label)}</strong><div class="tier-dropzone">${entries.length ? entries.map(gameCard).join('') : `<p>${empty}</p>`}</div></section>`;
    }).join('');
  }

  function cardPositions() {
    return new Map([...board.querySelectorAll('[data-tier-game]')].map(card => [
      card.dataset.tierGame,
      card.getBoundingClientRect()
    ]));
  }

  function animateCardSwap(previousPositions) {
    if (!previousPositions?.size || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    board.querySelectorAll('[data-tier-game]').forEach(card => {
      const previous = previousPositions.get(card.dataset.tierGame);
      if (!previous) return;
      const current = card.getBoundingClientRect();
      const deltaX = previous.left - current.left;
      const deltaY = previous.top - current.top;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;
      card.animate([
        { transform: `translate(${deltaX}px, ${deltaY}px)`, zIndex: 2 },
        { transform: 'translate(0, 0)', zIndex: 2 }
      ], {
        duration: 320,
        easing: 'cubic-bezier(.22, 1, .36, 1)'
      });
    });
  }

  function syncSelectors() {
    ownerButtons.forEach(button => {
      const active = button.dataset.tierOwner === activeOwner;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    listButtons.forEach(button => {
      const active = button.dataset.tierList === activeList;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }

  function readLocalBoard(owner, list) {
    try {
      const value = JSON.parse(localStorage.getItem(`${storagePrefix}${boardKey(owner, list)}`) || 'null');
      return value ? createBoard(value.config, value.placements) : null;
    } catch {
      return null;
    }
  }

  function writeLocalBoard(owner, list, snapshot) {
    try {
      localStorage.setItem(`${storagePrefix}${boardKey(owner, list)}`, JSON.stringify(snapshot));
    } catch {
      // A private browser session can deny storage; database persistence still works.
    }
  }

  function isMissingMultiBoardTable(error) {
    const message = `${error?.message || ''} ${error?.details || ''}`;
    return error?.code === '42P01' || error?.code === 'PGRST205' || /tier_list_boards.*(?:does not exist|schema cache|not found)/i.test(message);
  }

  async function legacyBoard(owner, list) {
    let config = cloneRows();
    const placements = new Map();

    if (list === 'games') {
      eligibleGames().forEach((game, index) => {
        const legacyTier = owner === 'sasaavot' ? String(game.tier_rank || '').trim().toUpperCase() : '';
        placements.set(itemId(game), {
          tier: validTiers.has(legacyTier) ? legacyTier : '',
          order: owner === 'sasaavot' ? Number(game.tier_order) || index : index
        });
      });
    }

    if (owner === 'sasaavot' && list === 'games') {
      const client = getConfiguredClient();
      if (client) {
        const { data, error } = await client.from('tier_list_settings').select('config').eq('id', 1).maybeSingle();
        if (!error && Array.isArray(data?.config)) config = normalizeRows(data.config);
      }
    }

    return createBoard(config, placements);
  }

  async function loadBoard(owner, list) {
    const key = boardKey(owner, list);
    if (cache.has(key)) return cache.get(key);

    let result = readLocalBoard(owner, list) || await legacyBoard(owner, list);
    const client = getConfiguredClient();

    if (client && multiBoardReady !== false) {
      const { data, error } = await client
        .from('tier_list_boards')
        .select('config,placements')
        .eq('owner_key', owner)
        .eq('list_key', list)
        .maybeSingle();

      if (isMissingMultiBoardTable(error)) {
        multiBoardReady = false;
      } else if (!error) {
        multiBoardReady = true;
        if (data) result = createBoard(data.config, data.placements);
      }
    }

    cache.set(key, result);
    return result;
  }

  async function selectBoard(owner, list) {
    activeOwner = owner;
    activeList = list;
    syncSelectors();
    const sequence = ++loadSequence;
    const cached = cache.get(boardKey(owner, list));
    if (cached) {
      currentBoard = cached;
      rows = currentBoard.rows;
      renderTierList();
      return;
    }

    currentBoard = createBoard();
    rows = currentBoard.rows;
    renderTierList();
    const loaded = await loadBoard(owner, list);
    if (sequence !== loadSequence) return;
    currentBoard = loaded;
    rows = currentBoard.rows;
    renderTierList();
  }

  function setAdminMode(nextValue) {
    const nextAdmin = nextValue === true;
    const changed = isAdmin !== nextAdmin;
    isAdmin = nextAdmin;
    // Editing stays intentionally invisible: admin mode only enables dragging.
    adminTools.hidden = true;
    resetButton.hidden = true;
    adminStatus.textContent = '';
    if (changed && !panel.hidden) renderTierList();
  }

  async function checkAdmin() {
    const client = getConfiguredClient();
    if (!client) {
      setAdminMode(false);
      return;
    }
    const { data: session } = await client.auth.getSession();
    if (!session?.session?.user || session.session.user.is_anonymous) {
      setAdminMode(false);
      return;
    }
    const { data, error } = await client.rpc('is_site_admin');
    setAdminMode(!error && data === true);
  }

  function boardSnapshot() {
    ensurePlacements();
    const allowedIds = new Set(sourceItems().map(itemId));
    return {
      owner: activeOwner,
      list: activeList,
      config: cloneRows(rows),
      placements: [...currentBoard.placements.entries()]
        .filter(([id]) => allowedIds.has(id))
        .map(([id, placement]) => ({ id, tier: placement.tier, order: placement.order }))
    };
  }

  async function persistLegacy(snapshot) {
    if (snapshot.owner !== 'sasaavot' || snapshot.list !== 'games') return null;
    const client = getConfiguredClient();
    if (!client) return new Error('Нет подключения к базе данных');

    const settingsResult = await client.from('tier_list_settings').upsert({
      id: 1,
      config: snapshot.config,
      updated_at: new Date().toISOString()
    });
    if (settingsResult.error) return settingsResult.error;

    const updates = snapshot.placements.map(item => client
      .from('games')
      .update({ tier_rank: item.tier, tier_order: item.order })
      .eq('id', item.id));
    const results = await Promise.all(updates);
    return results.find(result => result.error)?.error || null;
  }

  async function persistSnapshot(snapshot) {
    writeLocalBoard(snapshot.owner, snapshot.list, snapshot);
    const client = getConfiguredClient();
    let error = null;

    if (client && multiBoardReady !== false) {
      const result = await client.from('tier_list_boards').upsert({
        owner_key: snapshot.owner,
        list_key: snapshot.list,
        config: snapshot.config,
        placements: snapshot.placements,
        updated_at: new Date().toISOString()
      }, { onConflict: 'owner_key,list_key' });
      if (isMissingMultiBoardTable(result.error)) multiBoardReady = false;
      else if (result.error) error = result.error;
      else multiBoardReady = true;
    }

    if (multiBoardReady === false && !error) error = await persistLegacy(snapshot);
    return error;
  }

  function queueSave() {
    if (!isAdmin) return;
    const snapshot = boardSnapshot();
    adminStatus.textContent = 'Сохранение…';
    saveChain = saveChain
      .then(() => persistSnapshot(snapshot))
      .then(error => {
        const usesLegacyServerStorage = snapshot.owner === 'sasaavot' && snapshot.list === 'games';
        adminStatus.textContent = error ? error.message : multiBoardReady === false && !usesLegacyServerStorage
          ? 'Сохранено в этом браузере'
          : 'Сохранено';
      })
      .catch(error => {
        adminStatus.textContent = error?.message || 'Не удалось сохранить';
      });
  }

  function applyOrder(ids, tier) {
    ids.forEach((id, order) => {
      currentBoard.placements.set(String(id), { tier, order });
    });
  }

  function moveGame(id, targetTier, requestedIndex) {
    if (!isAdmin || activeList !== 'games') return;
    ensurePlacements();
    const game = sourceItems().find(item => itemId(item) === String(id));
    if (!game) return;

    const previousPositions = cardPositions();
    const movingId = itemId(game);
    const oldTier = placementFor(game).tier;
    const oldIds = itemsInTier(oldTier).map(itemId).filter(item => item !== movingId);
    const targetIds = oldTier === targetTier
      ? oldIds
      : itemsInTier(targetTier).map(itemId).filter(item => item !== movingId);
    const index = Math.max(0, Math.min(Number(requestedIndex) || 0, targetIds.length));

    if (oldTier !== targetTier) applyOrder(oldIds, oldTier);
    targetIds.splice(index, 0, movingId);
    applyOrder(targetIds, targetTier);
    renderTierList();
    animateCardSwap(previousPositions);
    queueSave();
  }

  function clearDropIndicators() {
    board.querySelectorAll('.is-over, .is-drop-target, .is-insert-before').forEach(element => {
      element.classList.remove('is-over', 'is-drop-target', 'is-insert-before');
    });
  }

  function insertionIndex(event, zone) {
    const cards = [...zone.querySelectorAll('[data-tier-game]')]
      .filter(card => card.dataset.tierGame !== draggedId);
    let index = cards.length;

    for (let cardIndex = 0; cardIndex < cards.length; cardIndex += 1) {
      const rect = cards[cardIndex].getBoundingClientRect();
      if (event.clientY < rect.top || (event.clientY <= rect.bottom && event.clientX < rect.left + rect.width / 2)) {
        index = cardIndex;
        break;
      }
    }

    return index;
  }

  async function open() {
    if (opening) return opening;
    opening = (async () => {
      lastFocus = document.activeElement;
      panel.hidden = false;
      panel.setAttribute('aria-hidden', 'false');
      openButton?.setAttribute('aria-expanded', 'true');
      if (!standalone) document.body.classList.add('tier-open');
      await checkAdmin();
      await selectBoard(activeOwner, activeList);
      requestAnimationFrame(() => panel.classList.add('is-open'));
      if (!standalone) closeButton.focus();
    })();
    try {
      await opening;
    } finally {
      opening = null;
    }
  }

  function close() {
    if (standalone) return;
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    openButton?.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('tier-open');
    window.setTimeout(() => {
      panel.hidden = true;
      lastFocus?.focus();
    }, 280);
  }

  ownerButtons.forEach(button => button.addEventListener('click', () => {
    if (button.dataset.tierOwner !== activeOwner) selectBoard(button.dataset.tierOwner, activeList);
  }));

  listButtons.forEach(button => button.addEventListener('click', () => {
    if (button.dataset.tierList !== activeList) selectBoard(activeOwner, button.dataset.tierList);
  }));

  openButton?.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  panel.addEventListener('click', event => {
    if (event.target.matches('[data-tier-close]')) close();
  });

  board.addEventListener('dragstart', event => {
    const card = event.target.closest('[data-tier-game]');
    if (!card || !isAdmin || activeList !== 'games') return;
    draggedId = card.dataset.tierGame;
    useCardDragPreview(event, card);
    card.classList.add('is-dragging');
    board.classList.add('is-sorting');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggedId);
  });

  board.addEventListener('dragend', event => {
    event.target.closest('[data-tier-game]')?.classList.remove('is-dragging');
    draggedId = '';
    removeDragPreview();
    board.classList.remove('is-sorting');
    clearDropIndicators();
  });

  board.addEventListener('dragover', event => {
    const row = event.target.closest('[data-tier]');
    if (!row || !isAdmin || !draggedId || activeList !== 'games') return;
    event.preventDefault();
    clearDropIndicators();
    const zone = row.querySelector('.tier-dropzone');
    insertionIndex(event, zone);
    event.dataTransfer.dropEffect = 'move';
  });

  board.addEventListener('drop', event => {
    const row = event.target.closest('[data-tier]');
    if (!row || !draggedId || activeList !== 'games') return;
    event.preventDefault();
    const id = draggedId;
    const zone = row.querySelector('.tier-dropzone');
    const index = insertionIndex(event, zone);
    clearDropIndicators();
    moveGame(id, row.dataset.tier, index);
    draggedId = '';
    removeDragPreview();
  });

  board.addEventListener('click', event => {
    const settings = event.target.closest('[data-row-settings]');
    const move = event.target.closest('[data-row-move]');
    if (settings) {
      editingRow = settings.dataset.rowSettings;
      const row = rows.find(item => item.id === editingRow);
      rowLabel.value = row.label;
      rowColor.value = row.color;
      rowDialog.showModal();
    }
    if (move) {
      const index = rows.findIndex(item => item.id === move.dataset.rowId);
      const next = move.dataset.rowMove === 'up' ? index - 1 : index + 1;
      if (next >= 0 && next < rows.length) {
        [rows[index], rows[next]] = [rows[next], rows[index]];
        currentBoard.rows = rows;
        renderTierList();
        queueSave();
      }
    }
  });

  colorPresets.addEventListener('click', event => {
    const button = event.target.closest('[data-tier-color]');
    if (button) rowColor.value = button.dataset.tierColor;
  });

  resetButton.addEventListener('click', () => resetDialog.showModal());
  resetConfirm.addEventListener('click', event => {
    event.preventDefault();
    if (!isAdmin) return;
    resetDialog.close();
    rows = cloneRows();
    currentBoard.rows = rows;
    currentBoard.placements.clear();
    sourceItems().forEach((item, order) => {
      currentBoard.placements.set(itemId(item), { tier: '', order });
    });
    renderTierList();
    queueSave();
  });

  rowSave.addEventListener('click', event => {
    event.preventDefault();
    const row = rows.find(item => item.id === editingRow);
    if (!row || !rowLabel.value.trim()) return;
    row.label = rowLabel.value.trim();
    row.color = rowColor.value;
    currentBoard.rows = rows;
    rowDialog.close();
    renderTierList();
    queueSave();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !standalone && !panel.hidden && !rowDialog.open) close();
  });

  window.addEventListener('cr7:games-loaded', () => {
    if (!panel.hidden && activeList === 'games') renderTierList();
  });

  // Authentication restoration is asynchronous. The standalone tier page can
  // open before Supabase has restored the saved session, so keep editor access
  // in sync with both the shared site-admin check and later auth events.
  window.addEventListener('cr7:admin-state', event => {
    setAdminMode(event.detail?.isAdmin === true);
  });

  const authClient = getConfiguredClient();
  authClient?.auth?.onAuthStateChange?.(() => {
    window.setTimeout(() => checkAdmin(), 0);
  });
  window.addEventListener('pageshow', () => checkAdmin());

  if (standalone) open();
})();
