(() => {
  const styleLayers = [
    ['adminFigmaTabsFixStyles', './assets/css/public/admin-figma-tabs-fix.css?v=1.0'],
    ['adminFigmaTemplateV3Styles', './assets/css/public/admin-figma-template-v3.css?v=1.0'],
    ['adminGamesTabsV4Styles', './assets/css/public/admin-games-tabs-v4.css?v=1.5'],
    ['adminPublishedIconsFixStyles', './assets/css/public/admin-published-icons-fix.css?v=1.2'],
    ['adminModeratorLayoutV5Styles', './assets/css/public/admin-moderator-layout-v5.css?v=1.2'],
    ['adminInterfaceRefinementV8Styles', './assets/css/public/admin-interface-refinement-v8.css?v=1.8-p0-parity'],
    ['adminMediaLayoutV6Styles', './assets/css/public/admin-media-layout-v6.css?v=1.3']
  ];

  styleLayers.forEach(([id, href]) => {
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  });

  if (!document.getElementById('adminGamesTabsV4Script')) {
    const script = document.createElement('script');
    script.id = 'adminGamesTabsV4Script';
    script.src = './assets/js/public/admin-games-tabs-v4.js?v=2.0-player-range';
    script.defer = true;
    document.head.appendChild(script);
  }

  if (!document.getElementById('adminPublishedIconsFixScript')) {
    const script = document.createElement('script');
    script.id = 'adminPublishedIconsFixScript';
    script.src = './assets/js/public/admin-published-icons-fix.js?v=1.1';
    script.defer = true;
    document.head.appendChild(script);
  }

  const portal = document.getElementById('adminPortal');
  const openButton = document.getElementById('adminPortalOpen');
  const closeButton = document.getElementById('adminPortalClose');
  const proposalExitLinks = [...document.querySelectorAll('.site-header a[href="#top"], .site-header a[href="#catalog"]')];
  const adminSection = document.getElementById('adminSection');
  const viewButtons = [...document.querySelectorAll('[data-admin-view]')];
  if (!portal || !openButton || !closeButton) return;

  const gameTools = document.querySelector('.proposal-game-tools');
  const proposalFilters = gameTools?.querySelector('.proposal-filter-box');
  const proposalSort = proposalFilters?.querySelector('.proposal-sort');
  const proposalReset = document.getElementById('proposalFiltersReset');
  if (gameTools && proposalSort) gameTools.appendChild(proposalSort);
  const proposalReleaseLegend = proposalFilters?.querySelector('fieldset:first-of-type legend');
  if (proposalReleaseLegend) proposalReleaseLegend.textContent = 'Статус выхода';
  const proposalPlayerFieldset = proposalFilters?.querySelector('fieldset:nth-of-type(2)');
  const proposalPlayerInputs = proposalPlayerFieldset ? [...proposalPlayerFieldset.querySelectorAll('input[type="number"]')] : [];
  const proposalPlayerContainer = proposalPlayerFieldset?.querySelector('div');
  if (proposalPlayerContainer && proposalPlayerInputs.length === 2) {
    const labels = proposalPlayerInputs.map(input => input.closest('label'));
    labels.forEach((label, index) => {
      if (!label) return;
      label.replaceChildren(proposalPlayerInputs[index]);
    });
    const separator = document.createElement('span');
    separator.setAttribute('aria-hidden', 'true');
    separator.textContent = '–';
    labels[0]?.after(separator);
    proposalPlayerContainer.classList.add('proposal-player-range');
  }
  proposalFilters?.querySelector('.proposal-filter-actions')?.remove();
  proposalReset?.remove();
  if (adminSection && proposalFilters && proposalFilters.parentElement !== adminSection) {
    adminSection.appendChild(proposalFilters);
  }

  const mediaPanel = document.getElementById('adminMediaPanel');
  let mediaFilters = document.getElementById('adminMediaFilters');
  if (adminSection && mediaPanel && !mediaFilters) {
    mediaFilters = document.createElement('details');
    mediaFilters.id = 'adminMediaFilters';
    mediaFilters.className = 'proposal-filter-box admin-media-filter-box';
    mediaFilters.open = true;
    mediaFilters.innerHTML = `
      <summary>Фильтры</summary>
      <fieldset>
        <legend>Формат</legend>
        <div class="admin-media-filter-grid admin-media-format-filters">
          <label><input data-admin-media-format="photo" type="checkbox"> Фото</label>
          <label><input data-admin-media-format="video" type="checkbox"> Видео</label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Категория</legend>
        <div class="admin-media-filter-grid admin-media-category-filters">
          <label><input data-admin-media-category="creative" type="checkbox"> Творчество</label>
          <label><input data-admin-media-category="personal" type="checkbox"> Личное</label>
          <label><input data-admin-media-category="internet" type="checkbox"> Интернет</label>
        </div>
      </fieldset>`;
    adminSection.appendChild(mediaFilters);
  }
  /* Старые версии панели могли оставить кнопки. Новая композиция их не использует. */
  mediaFilters?.querySelector('.admin-media-filter-actions')?.remove();

  let lastFocused = null;

  function setView(view = 'games', proposalMode = true) {
    const target = ['games', 'media', 'catalog'].includes(view) ? view : 'games';
    adminSection?.setAttribute('data-admin-view', target);
    portal.dataset.portalMode = proposalMode ? 'proposal' : 'catalog';
    document.body.classList.toggle('proposal-portal-open', proposalMode);
    viewButtons.forEach(button => button.classList.toggle('active', button.dataset.adminView === target));
  }

  function openPortal(view = 'games', proposalMode = true) {
    setView(view, proposalMode);
    lastFocused = document.activeElement;
    portal.hidden = false;
    portal.setAttribute('aria-hidden','false');
    openButton.setAttribute('aria-expanded','true');
    document.body.classList.add('admin-portal-open');
    requestAnimationFrame(() => { portal.classList.add('is-open'); closeButton.focus(); });
  }

  function closePortal() {
    portal.classList.remove('is-open');
    portal.setAttribute('aria-hidden','true');
    openButton.setAttribute('aria-expanded','false');
    document.body.classList.remove('admin-portal-open');
    document.body.classList.remove('proposal-portal-open');
    window.setTimeout(() => { portal.hidden = true; lastFocused?.focus(); },360);
  }

  proposalExitLinks.forEach(link => link.addEventListener('click',() => {
    if (portal.dataset.portalMode === 'proposal' && !portal.hidden) closePortal();
  }));
  viewButtons.forEach(button => button.addEventListener('click',() => setView(button.dataset.adminView, true)));
  closeButton.addEventListener('click',closePortal);
  portal.addEventListener('click',event => { if (event.target.matches('[data-admin-portal-close]')) closePortal(); });
  document.addEventListener('keydown',event => {
    if (portal.hidden) return;
    if (event.key === 'Escape') closePortal();
    if (event.key !== 'Tab') return;
    const focusable = [...portal.querySelectorAll('button:not([hidden]):not(:disabled),a[href],input:not([type="hidden"]):not(:disabled),textarea:not(:disabled),select:not(:disabled)')];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  window.CR7_ADMIN_PORTAL = { open: openPortal, close: closePortal, setView };
  if (location.hash === '#admin') openPortal('games', true);
})();
