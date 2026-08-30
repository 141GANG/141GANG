(() => {
  const byId = id => document.getElementById(id);
  const panel = byId('auctionPanel');
  const openButton = byId('auctionOpen');
  const closeButton = byId('auctionClose');
  const list = byId('auctionList');
  const manageList = byId('auctionManageList');
  const form = byId('auctionForm');
  const wheel = byId('auctionWheel');
  const spinButton = byId('auctionSpin');
  const timerDisplay = byId('auctionTimer');

  if (!panel || !openButton || !closeButton || !list || !manageList || !form || !wheel || !spinButton || !timerDisplay) return;

  const storageKey = 'predlozhka141.auction.v4';
  const colors = ['#ef3d35', '#f39a2b', '#2b91e8', '#51b97d', '#9b72df', '#e96f8d', '#68c6bd', '#f0cf55'];
  const defaultRules = '<h2>Правила аукциона</h2><p>Добавьте условия участия и проведения розыгрыша.</p><ul><li>Сумма лота определяет его шанс на колесе.</li><li>Результат фиксируется после подтверждения победителя.</li></ul>';
  const defaultSettings = {
    initialMinutes: 10,
    showTimer: true,
    showBank: true,
    showChances: true,
    compactList: false,
    autoHide: false,
    accent: '#ef3d35',
    mode: 'winner',
    spinDuration: 6,
    randomDuration: false,
    spinMin: 4,
    spinMax: 10,
    overlay: {
      timer: true,
      leader: true,
      bank: true,
      transparent: false
    }
  };
  const defaultState = {
    version: 4,
    startedAt: new Date().toISOString(),
    items: [],
    activity: [],
    spins: [],
    archives: [],
    rules: defaultRules,
    timer: { remaining: defaultSettings.initialMinutes * 60, running: false, endsAt: null },
    settings: defaultSettings
  };

  let state = loadState();
  let lastFocusedElement = null;
  let spinning = false;
  let rotation = 0;
  let pendingWinner = null;
  let activeTab = 'manage';
  let searchQuery = '';
  let rulesSaveTimer = 0;
  let isAdmin = document.body.classList.contains('is-site-admin');

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function requireAdmin(message = 'Управление аукционом доступно только администратору.') {
    if (isAdmin && document.body.classList.contains('is-site-admin')) return true;
    const result = byId('auctionResult');
    if (result) result.textContent = message;
    return false;
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (!saved || typeof saved !== 'object') return clone(defaultState);
      return {
        ...clone(defaultState),
        ...saved,
        items: Array.isArray(saved.items) ? saved.items : [],
        activity: Array.isArray(saved.activity) ? saved.activity : [],
        spins: Array.isArray(saved.spins) ? saved.spins : [],
        archives: Array.isArray(saved.archives) ? saved.archives : [],
        rules: typeof saved.rules === 'string' ? saved.rules : defaultRules,
        timer: { ...defaultState.timer, ...(saved.timer || {}) },
        settings: {
          ...clone(defaultSettings),
          ...(saved.settings || {}),
          overlay: { ...defaultSettings.overlay, ...(saved.settings?.overlay || {}) }
        }
      };
    } catch (_) {
      return clone(defaultState);
    }
  }

  function saveState() {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
  }

  function uid(prefix = 'lot') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function money(value) {
    return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(value) || 0)} ₽`;
  }

  function percent(value) {
    return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(Number(value) || 0)}%`;
  }

  function timestamp(value = new Date()) {
    return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(value);
  }

  function activeItems() {
    return state.items.filter(item => !item.eliminated && Number(item.amount) > 0);
  }

  function bankTotal() {
    return activeItems().reduce((sum, item) => sum + Number(item.amount), 0);
  }

  function selectionEntries() {
    const active = activeItems();
    const sum = active.reduce((total, item) => total + Number(item.amount), 0);
    return active.map(item => ({
      item,
      weight: state.settings.mode === 'elimination'
        ? Math.max(1, sum - Number(item.amount))
        : Number(item.amount)
    }));
  }

  function selectionTotal() {
    return selectionEntries().reduce((sum, entry) => sum + entry.weight, 0);
  }

  function itemChance(item) {
    const total = selectionTotal();
    const entry = selectionEntries().find(candidate => candidate.item.id === item.id);
    return total && entry ? entry.weight / total * 100 : 0;
  }

  function recordActivity(label) {
    state.activity.unshift({ id: uid('event'), label, at: new Date().toISOString() });
    state.activity = state.activity.slice(0, 60);
    saveState();
  }

  function wheelGradient(highlightId = '') {
    const entries = selectionEntries();
    const total = selectionTotal();
    if (!total) return 'conic-gradient(from 0deg, #252525 0 100%)';
    let cursor = 0;
    return `conic-gradient(from 0deg, ${entries.map(({ item, weight }, index) => {
      const start = cursor;
      cursor += weight / total * 100;
      const sourceColor = colors[state.items.indexOf(item) % colors.length];
      const color = highlightId && item.id !== highlightId ? '#292929' : sourceColor;
      return `${color} ${start}% ${cursor}%`;
    }).join(', ')})`;
  }

  function sortedItems() {
    return [...state.items].sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      if (left.eliminated !== right.eliminated) return left.eliminated ? 1 : -1;
      return Number(right.amount) - Number(left.amount);
    });
  }

  function visibleItems() {
    const query = searchQuery.toLocaleLowerCase('ru');
    return sortedItems().filter(item => {
      if (state.settings.autoHide && item.eliminated) return false;
      return !query || item.title.toLocaleLowerCase('ru').includes(query);
    });
  }

  function renderManageList() {
    const items = visibleItems();
    manageList.innerHTML = items.length ? items.map((item, index) => `
      <article class="auction-manage-item${item.eliminated ? ' is-eliminated' : ''}" data-auction-id="${escapeHtml(item.id)}">
        <span class="auction-lot-index">${String(index + 1).padStart(2, '0')}</span>
        <input aria-label="Название лота" class="auction-lot-title" data-lot-field="title" maxlength="120" value="${escapeHtml(item.title)}">
        <label class="auction-lot-amount"><input aria-label="Сумма лота" data-lot-field="amount" min="1" step="1" type="number" value="${Number(item.amount) || 0}"><span>₽</span></label>
        <div class="auction-lot-tools">
          <label class="auction-lot-add"><input aria-label="Добавить сумму" min="1" placeholder="+ ₽" type="number"><button aria-label="Прибавить сумму" data-lot-action="add" type="button">＋</button></label>
          <button aria-label="${item.pinned ? 'Открепить лот' : 'Закрепить лот'}" class="${item.pinned ? 'is-active' : ''}" data-lot-action="pin" title="Закрепить" type="button">⌖</button>
          <button aria-label="${item.eliminated ? 'Вернуть лот' : 'Исключить лот'}" class="${item.eliminated ? 'is-active' : ''}" data-lot-action="eliminate" title="Исключить" type="button">⊘</button>
          <button aria-label="Удалить лот" data-lot-action="delete" title="Удалить" type="button">×</button>
        </div>
      </article>
    `).join('') : `
      <div class="auction-empty">
        <strong>${searchQuery ? 'Ничего не найдено' : 'Добавьте первый лот'}</strong>
        <span>${searchQuery ? 'Измените поисковый запрос.' : 'Название и сумма появятся в колесе автоматически.'}</span>
      </div>`;
  }

  function renderWheelList() {
    const hideEliminated = byId('auctionHideEliminated')?.checked;
    const entries = sortedItems().filter(item => !hideEliminated || !item.eliminated);
    list.innerHTML = entries.length ? entries.map((item, index) => `
      <article class="auction-item${item.eliminated ? ' is-eliminated' : ''}" data-auction-id="${escapeHtml(item.id)}">
        <span class="auction-color" style="--lot-color:${colors[state.items.indexOf(item) % colors.length]}">${String(index + 1).padStart(2, '0')}</span>
        <div class="auction-item-copy"><h3>${escapeHtml(item.title)}</h3><p>${money(item.amount)}</p></div>
        <div class="auction-item-chance"><span>${item.eliminated ? 'Статус' : state.settings.mode === 'elimination' ? 'Шанс вылета' : 'Шанс победы'}</span><strong>${item.eliminated ? 'Выбыл' : percent(itemChance(item))}</strong></div>
      </article>
    `).join('') : '<div class="auction-empty"><strong>Колесо пустое</strong><span>Добавьте активные лоты во вкладке «Лоты».</span></div>';
  }

  function renderActivity() {
    const container = byId('auctionHistory');
    if (!container) return;
    container.innerHTML = state.activity.length ? state.activity.slice(0, 12).map(entry => `
      <article><span>${escapeHtml(entry.label)}</span><time>${timestamp(new Date(entry.at))}</time></article>
    `).join('') : '<p>Изменений пока нет</p>';
  }

  function renderArchive() {
    const sessions = state.archives;
    const allSpins = [...state.spins, ...sessions.flatMap(session => session.spins || [])];
    byId('auctionArchiveCount').textContent = String(sessions.length);
    byId('auctionSpinCount').textContent = String(allSpins.length);
    byId('auctionLastWinner').textContent = allSpins[0]?.winner || '—';
    const archiveList = byId('auctionArchiveList');
    if (!archiveList) return;
    const current = state.spins.length ? [{
      id: 'current',
      finishedAt: null,
      bank: bankTotal(),
      lots: state.items.length,
      spins: state.spins
    }] : [];
    const entries = [...current, ...sessions];
    archiveList.innerHTML = entries.length ? entries.map(session => `
      <article class="auction-archive-card">
        <header><div><span>${session.id === 'current' ? 'Текущая сессия' : 'Завершённый аукцион'}</span><strong>${session.finishedAt ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(session.finishedAt)) : 'Сейчас'}</strong></div><b>${money(session.bank)}</b></header>
        <div>${(session.spins || []).length ? session.spins.map(spin => `<p><span>${escapeHtml(spin.winner)}</span><small>${percent(spin.chance)} · ${timestamp(new Date(spin.at))}</small></p>`).join('') : '<p><span>Без подтверждённых победителей</span></p>'}</div>
      </article>
    `).join('') : '<div class="auction-empty"><strong>История пуста</strong><span>Подтвердите победителя или завершите текущий аукцион.</span></div>';
  }

  function renderWinner() {
    const card = byId('auctionWinnerCard');
    if (!card) return;
    if (!pendingWinner) {
      card.hidden = true;
      return;
    }
    const item = state.items.find(entry => entry.id === pendingWinner.itemId);
    if (!item) {
      pendingWinner = null;
      card.hidden = true;
      return;
    }
    card.hidden = false;
    byId('auctionWinnerName').textContent = item.title;
    byId('auctionWinnerChance').textContent = percent(pendingWinner.chance);
    byId('auctionWinnerCumulative').textContent = percent(pendingWinner.cumulative);
    const confirm = byId('auctionWinnerConfirm');
    confirm.disabled = Boolean(pendingWinner.confirmed);
    confirm.textContent = pendingWinner.confirmed ? 'Победитель сохранён' : 'Подтвердить';
  }

  function remainingSeconds() {
    if (state.timer.running && state.timer.endsAt) {
      return Math.max(0, Math.ceil((Number(state.timer.endsAt) - Date.now()) / 1000));
    }
    return Math.max(0, Number(state.timer.remaining) || 0);
  }

  function timerText(seconds, includeHours = true) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    const remainder = seconds % 60;
    const values = includeHours ? [hours, minutes, remainder] : [hours * 60 + minutes, remainder];
    return values.map(value => String(value).padStart(2, '0')).join(':');
  }

  function drawTimer() {
    const seconds = remainingSeconds();
    timerDisplay.textContent = timerText(seconds);
    byId('auctionOverlayTimer').textContent = timerText(seconds, false);
    const liveTimer = byId('auctionLiveTimer');
    if (liveTimer) {
      liveTimer.textContent = timerText(seconds);
      liveTimer.hidden = !state.settings.showTimer;
    }
    if (!seconds && state.timer.running) {
      state.timer = { remaining: 0, running: false, endsAt: null };
      saveState();
    }
    const toggle = byId('auctionTimerToggle');
    if (toggle) {
      toggle.textContent = state.timer.running ? 'Ⅱ' : '▶';
      toggle.title = state.timer.running ? 'Пауза' : 'Продолжить';
    }
  }

  function renderOverlay() {
    const active = [...activeItems()].sort((left, right) => Number(right.amount) - Number(left.amount));
    byId('auctionOverlayLeader').textContent = active[0] ? `${active[0].title} · ${money(active[0].amount)}` : 'Лидер появится после добавления лотов';
    byId('auctionOverlayBank').textContent = money(bankTotal());
    const preview = byId('auctionOverlayPreview');
    preview.classList.toggle('is-transparent', state.settings.overlay.transparent);
    byId('auctionOverlayTimer').hidden = !state.settings.overlay.timer;
    byId('auctionOverlayLeader').hidden = !state.settings.overlay.leader;
    byId('auctionOverlayBank').parentElement.hidden = !state.settings.overlay.bank;
  }

  function applySettings() {
    const settings = state.settings;
    panel.style.setProperty('--auction-accent', settings.accent);
    panel.classList.toggle('auction-hide-bank', !settings.showBank);
    panel.classList.toggle('auction-hide-chances', !settings.showChances);
    panel.classList.toggle('auction-compact-list', settings.compactList);
    byId('auctionInitialMinutes').value = settings.initialMinutes;
    byId('auctionShowTimer').checked = settings.showTimer;
    byId('auctionShowBank').checked = settings.showBank;
    byId('auctionShowChances').checked = settings.showChances;
    byId('auctionCompactList').checked = settings.compactList;
    byId('auctionAutoHide').checked = settings.autoHide;
    byId('auctionSpinDuration').value = settings.spinDuration;
    byId('auctionRandomDuration').checked = settings.randomDuration;
    byId('auctionSpinMin').value = settings.spinMin;
    byId('auctionSpinMax').value = settings.spinMax;
    byId('auctionRandomRange').hidden = !settings.randomDuration;
    byId('auctionQuickHide').checked = byId('auctionHideEliminated').checked;
    byId('auctionQuickChances').checked = settings.showChances;
    document.querySelectorAll('[name="auctionMode"]').forEach(input => {
      input.disabled = !isAdmin;
      input.checked = input.value === settings.mode;
    });
    ['auctionSpinDuration', 'auctionRandomDuration', 'auctionSpinMin', 'auctionSpinMax'].forEach(id => {
      byId(id).disabled = !isAdmin;
    });
    document.querySelectorAll('#auctionAccentColors [data-color]').forEach(button => {
      button.classList.toggle('active', button.dataset.color === settings.accent);
    });
    byId('auctionOverlayShowTimer').checked = settings.overlay.timer;
    byId('auctionOverlayShowLeader').checked = settings.overlay.leader;
    byId('auctionOverlayShowBank').checked = settings.overlay.bank;
    byId('auctionOverlayTransparent').checked = settings.overlay.transparent;
  }

  function applyAdminAccess() {
    const readonly = !isAdmin;
    panel.classList.toggle('auction-readonly', readonly);

    const badge = byId('auctionAccessBadge');
    if (badge) {
      badge.classList.toggle('is-admin', isAdmin);
      badge.lastChild.textContent = isAdmin ? ' Администратор' : ' Только просмотр';
    }

    const notice = byId('auctionSetupNotice');
    if (notice) {
      notice.hidden = isAdmin;
      notice.innerHTML = '<strong>Режим просмотра</strong><span>Изменять лоты, правила, настройки и запускать розыгрыш может только администратор.</span>';
    }

    form.hidden = readonly;
    ['auctionAdminToggle', 'auctionSave', 'auctionNew'].forEach(id => {
      const control = byId(id);
      if (control) control.hidden = readonly;
    });

    manageList.querySelectorAll('[data-lot-field]').forEach(input => {
      input.readOnly = readonly;
      input.tabIndex = readonly ? -1 : 0;
    });
    manageList.querySelectorAll('.auction-lot-tools').forEach(tools => {
      tools.hidden = readonly;
    });

    const adminControls = [
      'auctionSpin', 'auctionWinnerConfirm', 'auctionWinnerReroll', 'auctionWinnerRemove',
      'auctionSettingsToggle', 'auctionQuickChances', 'auctionTimerToggle', 'auctionTimerReset',
      'auctionTimerAdd', 'auctionTimerSubtract', 'auctionTimerStep', 'auctionTimerUnit',
      'auctionHistoryClear', 'auctionSettingsReset'
    ];
    adminControls.forEach(id => {
      const control = byId(id);
      if (control) control.disabled = readonly || (id === 'auctionSpin' && (spinning || !selectionTotal()));
    });

    document.querySelectorAll('[data-auction-panel="settings"] input, [data-auction-panel="settings"] button, .auction-overlay-page .auction-settings-card input').forEach(control => {
      control.disabled = readonly;
    });

    const toolbar = panel.querySelector('.auction-editor-toolbar');
    if (toolbar) toolbar.hidden = readonly;
    rulesEditor.contentEditable = isAdmin ? 'true' : 'false';
    rulesEditor.setAttribute('aria-readonly', String(readonly));
    rulesStatus.textContent = isAdmin ? 'Сохранено' : 'Только просмотр';
  }

  function syncAdminAccess(force = false) {
    const next = document.body.classList.contains('is-site-admin');
    if (!force && next === isAdmin) return;
    isAdmin = next;
    applySettings();
    renderAll();
  }

  function renderAll() {
    const total = bankTotal();
    byId('auctionTotal').textContent = money(total);
    byId('auctionCount').textContent = String(activeItems().length);
    wheel.style.background = wheelGradient();
    spinButton.disabled = spinning || !selectionTotal();
    renderManageList();
    renderWheelList();
    renderActivity();
    renderArchive();
    renderWinner();
    renderOverlay();
    drawTimer();
    applyAdminAccess();
  }

  function saveAndRender() {
    saveState();
    applySettings();
    renderAll();
  }

  function addLot(event) {
    event.preventDefault();
    if (!requireAdmin()) return;
    const title = byId('auctionItemTitle').value.trim();
    const amount = Math.round(Number(byId('auctionItemAmount').value));
    if (!title || !Number.isFinite(amount) || amount <= 0) return;
    state.items.push({ id: uid(), title, amount, eliminated: false, pinned: false });
    recordActivity(`Добавлен лот «${title}» на ${money(amount)}`);
    form.reset();
    saveAndRender();
    byId('auctionItemTitle').focus();
  }

  function updateLot(row, field, value) {
    if (!requireAdmin()) return;
    const item = state.items.find(entry => entry.id === row?.dataset.auctionId);
    if (!item) return;
    if (field === 'title') {
      const title = String(value).trim().slice(0, 120);
      if (title) item.title = title;
    }
    if (field === 'amount') {
      const amount = Math.round(Number(value));
      if (Number.isFinite(amount) && amount > 0) item.amount = amount;
    }
    saveAndRender();
  }

  function lotAction(button) {
    if (!requireAdmin()) return;
    const row = button.closest('[data-auction-id]');
    const item = state.items.find(entry => entry.id === row?.dataset.auctionId);
    if (!item) return;
    const action = button.dataset.lotAction;
    if (action === 'delete') {
      state.items = state.items.filter(entry => entry.id !== item.id);
      recordActivity(`Удалён лот «${item.title}»`);
    }
    if (action === 'pin') {
      item.pinned = !item.pinned;
      recordActivity(`${item.pinned ? 'Закреплён' : 'Откреплён'} лот «${item.title}»`);
    }
    if (action === 'eliminate') {
      item.eliminated = !item.eliminated;
      recordActivity(`${item.eliminated ? 'Исключён' : 'Возвращён'} лот «${item.title}»`);
    }
    if (action === 'add') {
      const input = row.querySelector('.auction-lot-add input');
      const amount = Math.round(Number(input?.value));
      if (!Number.isFinite(amount) || amount <= 0) return;
      item.amount = Number(item.amount) + amount;
      recordActivity(`«${item.title}»: +${money(amount)}`);
    }
    saveAndRender();
  }

  function pickWinner() {
    const entries = selectionEntries();
    const total = selectionTotal();
    if (!entries.length || !total) return null;
    const random = window.crypto?.getRandomValues
      ? window.crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296
      : Math.random();
    let target = random * total;
    let start = 0;
    for (const entry of entries) {
      if (target < entry.weight) return { ...entry, start, total };
      target -= entry.weight;
      start += entry.weight;
    }
    return { ...entries.at(-1), start: total - entries.at(-1).weight, total };
  }

  function cumulativeChance(item) {
    const active = activeItems();
    const total = active.reduce((sum, entry) => sum + Number(entry.amount), 0);
    const cumulative = active
      .filter(entry => Number(entry.amount) <= Number(item.amount))
      .reduce((sum, entry) => sum + Number(entry.amount), 0);
    return total ? cumulative / total * 100 : 0;
  }

  function normaliseDuration(value, fallback) {
    const duration = Math.floor(Number(value));
    return Number.isFinite(duration) && duration >= 1 ? duration : fallback;
  }

  function waitForSpin(milliseconds, callback) {
    const maxTimeout = 2147480000;
    const chunk = Math.min(milliseconds, maxTimeout);
    window.setTimeout(() => {
      if (milliseconds > chunk) waitForSpin(milliseconds - chunk, callback);
      else callback();
    }, chunk);
  }

  function spin() {
    if (!requireAdmin('Запустить розыгрыш может только администратор.')) return;
    if (spinning) return;
    const winner = pickWinner();
    if (!winner) return;
    spinning = true;
    pendingWinner = null;
    renderWinner();
    spinButton.disabled = true;
    byId('auctionResult').textContent = 'Колесо вращается…';
    const settings = state.settings;
    const min = normaliseDuration(settings.spinMin, 4);
    const max = Math.max(min, normaliseDuration(settings.spinMax, 10));
    const duration = settings.randomDuration
      ? min + Math.random() * (max - min)
      : normaliseDuration(settings.spinDuration, 6);
    const middle = (winner.start + winner.weight / 2) / winner.total * 360;
    rotation += 1800 + (360 - middle) - (rotation % 360);
    wheel.style.transitionDuration = `${duration}s`;
    wheel.style.transform = `rotate(${rotation}deg)`;
    waitForSpin(duration * 1000 + 120, () => {
      spinning = false;
      pendingWinner = {
        itemId: winner.item.id,
        chance: winner.weight / winner.total * 100,
        cumulative: cumulativeChance(winner.item),
        confirmed: false
      };
      byId('auctionResult').innerHTML = `${settings.mode === 'elimination' ? 'Выбывает' : 'Победитель'}: <strong>${escapeHtml(winner.item.title)}</strong>`;
      recordActivity(`Колесо выбрало «${winner.item.title}»`);
      saveAndRender();
    }, duration * 1000 + 120);
  }

  function confirmWinner() {
    if (!requireAdmin()) return;
    if (!pendingWinner || pendingWinner.confirmed) return;
    const item = state.items.find(entry => entry.id === pendingWinner.itemId);
    if (!item) return;
    pendingWinner.confirmed = true;
    state.spins.unshift({
      id: uid('spin'),
      winner: item.title,
      itemId: item.id,
      amount: Number(item.amount),
      chance: pendingWinner.chance,
      mode: state.settings.mode,
      at: new Date().toISOString()
    });
    if (state.settings.mode === 'elimination') item.eliminated = true;
    recordActivity(`Подтверждён результат: «${item.title}»`);
    saveAndRender();
  }

  function removeWinner() {
    if (!requireAdmin()) return;
    if (!pendingWinner) return;
    const item = state.items.find(entry => entry.id === pendingWinner.itemId);
    if (item) {
      item.eliminated = true;
      recordActivity(`Исключён лот «${item.title}»`);
    }
    pendingWinner = null;
    saveAndRender();
  }

  function adjustTimer(delta) {
    if (!requireAdmin()) return;
    const next = Math.max(0, remainingSeconds() + delta);
    state.timer.remaining = next;
    if (state.timer.running) state.timer.endsAt = Date.now() + next * 1000;
    saveState();
    drawTimer();
  }

  function timerStep() {
    return Math.max(1, Number(byId('auctionTimerStep').value) || 1) * Number(byId('auctionTimerUnit').value || 1);
  }

  function toggleTimer() {
    if (!requireAdmin()) return;
    if (state.timer.running) {
      state.timer.remaining = remainingSeconds();
      state.timer.running = false;
      state.timer.endsAt = null;
    } else {
      if (!state.timer.remaining) state.timer.remaining = Math.max(1, state.settings.initialMinutes) * 60;
      state.timer.running = true;
      state.timer.endsAt = Date.now() + state.timer.remaining * 1000;
    }
    saveState();
    drawTimer();
  }

  function resetTimer() {
    if (!requireAdmin()) return;
    state.timer = {
      remaining: Math.max(1, Number(state.settings.initialMinutes) || 10) * 60,
      running: false,
      endsAt: null
    };
    saveState();
    drawTimer();
  }

  function switchManageView(viewName) {
    document.querySelectorAll('[data-manage-panel]').forEach(view => {
      const active = view.dataset.managePanel === viewName;
      view.hidden = !active;
      view.classList.toggle('active', active);
    });
  }

  function switchTab(tabName) {
    activeTab = tabName;
    document.querySelectorAll('[data-auction-tab]').forEach(button => {
      button.classList.toggle('active', button.dataset.auctionTab === tabName);
    });
    const panelName = tabName === 'rules' ? 'manage' : tabName;
    document.querySelectorAll('[data-auction-panel]').forEach(view => {
      const active = view.dataset.auctionPanel === panelName;
      view.hidden = !active;
      view.classList.toggle('active', active);
    });
    switchManageView(tabName === 'rules' ? 'rules' : 'lots');
    panel.classList.toggle('is-rules-tab', tabName === 'rules');
    if (tabName === 'rules' && isAdmin) byId('auctionRulesEditor').focus();
    if (tabName === 'wheel') renderAll();
  }

  function archiveAuction() {
    if (!requireAdmin()) return;
    const hasData = state.items.length || state.spins.length;
    if (!hasData) return;
    if (!window.confirm('Завершить текущий аукцион и начать новый? Лоты будут перенесены в историю.')) return;
    state.archives.unshift({
      id: uid('auction'),
      startedAt: state.startedAt,
      finishedAt: new Date().toISOString(),
      bank: state.items.reduce((sum, item) => sum + Number(item.amount || 0), 0),
      lots: state.items.length,
      spins: clone(state.spins)
    });
    state.archives = state.archives.slice(0, 30);
    state.startedAt = new Date().toISOString();
    state.items = [];
    state.activity = [];
    state.spins = [];
    pendingWinner = null;
    resetTimer();
    saveAndRender();
    switchTab('manage');
  }

  function exportHistory() {
    const payload = JSON.stringify({
      exportedAt: new Date().toISOString(),
      current: {
        startedAt: state.startedAt,
        items: state.items,
        spins: state.spins
      },
      archives: state.archives
    }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `141-auction-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function updateSetting(key, value) {
    if (!requireAdmin()) {
      applySettings();
      return;
    }
    state.settings[key] = value;
    saveAndRender();
  }

  function updateOverlaySetting(key, value) {
    if (!requireAdmin()) {
      applySettings();
      return;
    }
    state.settings.overlay[key] = value;
    saveAndRender();
  }

  function ensureLiveTimer() {
    if (byId('auctionLiveTimer')) return;
    const timer = document.createElement('strong');
    timer.className = 'auction-live-timer';
    timer.id = 'auctionLiveTimer';
    timer.hidden = !state.settings.showTimer;
    panel.querySelector('.auction-wheel-toolbar')?.append(timer);
  }

  function openAuction() {
    syncAdminAccess(true);
    if (!isAdmin && activeTab === 'manage') activeTab = 'wheel';
    lastFocusedElement = document.activeElement;
    panel.hidden = false;
    panel.setAttribute('aria-hidden', 'false');
    openButton.setAttribute('aria-expanded', 'true');
    document.body.classList.add('auction-open');
    ensureLiveTimer();
    applySettings();
    renderAll();
    switchTab(activeTab);
    requestAnimationFrame(() => {
      panel.classList.add('is-open');
      closeButton.focus();
    });
  }

  function closeAuction() {
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    openButton.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('auction-open');
    window.setTimeout(() => {
      panel.hidden = true;
      lastFocusedElement?.focus();
    }, 240);
  }

  const rulesEditor = byId('auctionRulesEditor');
  const rulesStatus = byId('auctionRulesStatus');
  rulesEditor.innerHTML = state.rules || defaultRules;
  form.hidden = !isAdmin;

  openButton.addEventListener('click', openAuction);
  closeButton.addEventListener('click', closeAuction);
  panel.addEventListener('click', event => {
    if (event.target.matches('[data-auction-close]')) closeAuction();
  });
  form.addEventListener('submit', addLot);
  byId('auctionAdminToggle').addEventListener('click', () => byId('auctionItemTitle').focus());
  byId('auctionSearch').addEventListener('input', event => {
    searchQuery = event.target.value.trim();
    renderManageList();
  });
  manageList.addEventListener('change', event => {
    const field = event.target.dataset.lotField;
    if (field) updateLot(event.target.closest('[data-auction-id]'), field, event.target.value);
  });
  manageList.addEventListener('click', event => {
    const button = event.target.closest('[data-lot-action]');
    if (button) lotAction(button);
  });
  document.querySelectorAll('[data-auction-tab]').forEach(button => {
    button.addEventListener('click', () => switchTab(button.dataset.auctionTab));
  });

  list.addEventListener('mouseover', event => {
    const row = event.target.closest('[data-auction-id]');
    if (!row) return;
    wheel.style.background = wheelGradient(row.dataset.auctionId);
    list.querySelectorAll('[data-auction-id]').forEach(item => {
      item.classList.toggle('is-dimmed', item !== row);
      item.classList.toggle('is-highlighted', item === row);
    });
  });
  list.addEventListener('mouseleave', () => {
    wheel.style.background = wheelGradient();
    list.querySelectorAll('[data-auction-id]').forEach(item => item.classList.remove('is-dimmed', 'is-highlighted'));
  });

  spinButton.addEventListener('click', spin);
  byId('auctionWinnerConfirm').addEventListener('click', confirmWinner);
  byId('auctionWinnerReroll').addEventListener('click', () => {
    if (!requireAdmin()) return;
    pendingWinner = null;
    renderWinner();
    spin();
  });
  byId('auctionWinnerRemove').addEventListener('click', removeWinner);
  byId('auctionHideEliminated').addEventListener('change', renderAll);
  byId('auctionQuickHide').addEventListener('change', event => {
    byId('auctionHideEliminated').checked = event.target.checked;
    renderAll();
  });
  byId('auctionQuickChances').addEventListener('change', event => updateSetting('showChances', event.target.checked));
  byId('auctionSettingsToggle').addEventListener('click', () => {
    const quick = byId('auctionSettings');
    quick.hidden = !quick.hidden;
    byId('auctionSettingsToggle').setAttribute('aria-expanded', String(!quick.hidden));
  });
  panel.querySelector('[data-open-auction-settings]').addEventListener('click', () => {
    byId('auctionSettings').hidden = true;
    switchTab('settings');
  });

  byId('auctionTimerToggle').addEventListener('click', toggleTimer);
  byId('auctionTimerReset').addEventListener('click', resetTimer);
  byId('auctionTimerAdd').addEventListener('click', () => adjustTimer(timerStep()));
  byId('auctionTimerSubtract').addEventListener('click', () => adjustTimer(-timerStep()));
  byId('auctionHistoryClear').addEventListener('click', () => {
    if (!requireAdmin()) return;
    state.activity = [];
    saveAndRender();
  });
  byId('auctionSave').addEventListener('click', event => {
    if (!requireAdmin()) return;
    saveState();
    const button = event.currentTarget;
    const previous = button.textContent;
    button.textContent = '✓';
    window.setTimeout(() => { button.textContent = previous; }, 900);
  });
  byId('auctionNew').addEventListener('click', archiveAuction);
  byId('auctionHistoryExport').addEventListener('click', exportHistory);

  byId('auctionInitialMinutes').addEventListener('change', event => updateSetting('initialMinutes', Math.max(1, Math.min(360, Number(event.target.value) || 10))));
  byId('auctionShowTimer').addEventListener('change', event => updateSetting('showTimer', event.target.checked));
  byId('auctionShowBank').addEventListener('change', event => updateSetting('showBank', event.target.checked));
  byId('auctionShowChances').addEventListener('change', event => updateSetting('showChances', event.target.checked));
  byId('auctionCompactList').addEventListener('change', event => updateSetting('compactList', event.target.checked));
  byId('auctionAutoHide').addEventListener('change', event => updateSetting('autoHide', event.target.checked));
  byId('auctionSpinDuration').addEventListener('input', event => updateSetting('spinDuration', normaliseDuration(event.target.value, 6)));
  byId('auctionRandomDuration').addEventListener('change', event => updateSetting('randomDuration', event.target.checked));
  byId('auctionSpinMin').addEventListener('input', event => updateSetting('spinMin', normaliseDuration(event.target.value, 4)));
  byId('auctionSpinMax').addEventListener('input', event => updateSetting('spinMax', Math.max(state.settings.spinMin, normaliseDuration(event.target.value, 10))));
  document.querySelectorAll('[name="auctionMode"]').forEach(input => {
    input.addEventListener('change', event => updateSetting('mode', event.target.value));
  });
  byId('auctionAccentColors').addEventListener('click', event => {
    const button = event.target.closest('[data-color]');
    if (button) updateSetting('accent', button.dataset.color);
  });
  byId('auctionSettingsReset').addEventListener('click', () => {
    if (!requireAdmin()) return;
    state.settings = clone(defaultSettings);
    saveAndRender();
  });

  byId('auctionOverlayShowTimer').addEventListener('change', event => updateOverlaySetting('timer', event.target.checked));
  byId('auctionOverlayShowLeader').addEventListener('change', event => updateOverlaySetting('leader', event.target.checked));
  byId('auctionOverlayShowBank').addEventListener('change', event => updateOverlaySetting('bank', event.target.checked));
  byId('auctionOverlayTransparent').addEventListener('change', event => updateOverlaySetting('transparent', event.target.checked));
  byId('auctionOverlayCopy').addEventListener('click', async event => {
    const url = `${location.origin}${location.pathname}?auction-overlay=1`;
    try {
      await navigator.clipboard.writeText(url);
      event.currentTarget.textContent = 'Ссылка скопирована';
      window.setTimeout(() => { event.currentTarget.textContent = 'Копировать ссылку'; }, 1200);
    } catch (_) {
      event.currentTarget.textContent = url;
    }
  });

  rulesEditor.addEventListener('input', () => {
    if (!requireAdmin()) {
      rulesEditor.innerHTML = state.rules || defaultRules;
      return;
    }
    rulesStatus.textContent = 'Сохранение…';
    window.clearTimeout(rulesSaveTimer);
    rulesSaveTimer = window.setTimeout(() => {
      state.rules = rulesEditor.innerHTML;
      saveState();
      rulesStatus.textContent = 'Сохранено';
    }, 350);
  });
  rulesEditor.addEventListener('paste', event => {
    if (!requireAdmin()) return;
    event.preventDefault();
    document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
  });
  panel.querySelector('.auction-editor-toolbar').addEventListener('click', event => {
    if (!requireAdmin()) return;
    const button = event.target.closest('button');
    if (!button) return;
    rulesEditor.focus();
    if (button.hasAttribute('data-editor-clear')) document.execCommand('removeFormat');
    else document.execCommand(button.dataset.editorCommand, false, button.dataset.editorValue || null);
    rulesEditor.dispatchEvent(new Event('input'));
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) closeAuction();
  });
  window.addEventListener('storage', event => {
    if (event.key !== storageKey) return;
    state = loadState();
    applySettings();
    renderAll();
  });
  new MutationObserver(() => syncAdminAccess()).observe(document.body, {
    attributes: true,
    attributeFilter: ['class']
  });
  window.setInterval(drawTimer, 250);

  applySettings();
  ensureLiveTimer();
  renderAll();
  switchTab(isAdmin ? 'manage' : 'wheel');

  if (new URLSearchParams(location.search).get('auction-overlay') === '1') {
    activeTab = 'overlay';
    openAuction();
    panel.classList.add('auction-overlay-only');
  }
})();

(() => {
  const panel = document.getElementById('featurePanel');
  const buttons = [...document.querySelectorAll('.coming-soon-trigger')];
  const closeButton = document.getElementById('featureClose');
  const kicker = document.getElementById('featureKicker');
  const title = document.getElementById('featureTitle');
  const description = document.getElementById('featureDescription');
  if (!panel || !buttons.length || !closeButton || !kicker || !title || !description) return;
  let activeButton = null;

  function close() {
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
    activeButton?.setAttribute('aria-expanded', 'false');
    activeButton?.focus();
    activeButton = null;
  }

  buttons.forEach(button => button.addEventListener('click', () => {
    activeButton = button;
    kicker.textContent = button.dataset.comingKicker || 'Новый раздел';
    title.textContent = button.dataset.comingTitle || 'Скоро';
    description.textContent = button.dataset.comingDescription || 'Функция находится в разработке.';
    panel.hidden = false;
    panel.setAttribute('aria-hidden', 'false');
    button.setAttribute('aria-expanded', 'true');
    closeButton.focus();
  }));
  closeButton.addEventListener('click', close);
  panel.addEventListener('click', event => {
    if (event.target.matches('[data-feature-close]')) close();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) close();
  });
})();
