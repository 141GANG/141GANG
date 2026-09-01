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

  // This stylesheet already exists in the project. Load the current revision here
  // with a fresh query string so the admin card fixes cannot be masked by a
  // previously cached v=1.1 copy. figma-ui.js reuses this same element id.
  const adminCardStyleId = 'adminCardIconsStyles';
  const adminCardStyleHref = './assets/css/public/admin-card-icons.css?v=1.5-comments-druk';
  let adminCardStyle = document.getElementById(adminCardStyleId);
  if (!adminCardStyle) {
    adminCardStyle = document.createElement('link');
    adminCardStyle.id = adminCardStyleId;
    adminCardStyle.rel = 'stylesheet';
    document.head.appendChild(adminCardStyle);
  }
  if (!String(adminCardStyle.getAttribute('href') || '').includes('v=1.5-comments-druk')) {
    adminCardStyle.href = adminCardStyleHref;
  }

  // Refresh the existing title stylesheet as well. It remains the single
  // source of truth for Druk titles; this only avoids a stale cached copy.
  const adminTitleStyleHref = './assets/css/public/admin-druk-title-final.css?v=1.1-all-game-titles';
  const adminTitleStyle = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .find(link => String(link.getAttribute('href') || '').includes('admin-druk-title-final.css'));
  if (adminTitleStyle && !String(adminTitleStyle.getAttribute('href') || '').includes('v=1.1-all-game-titles')) {
    adminTitleStyle.href = adminTitleStyleHref;
  }

  if (!document.getElementById('adminGamesTabsV4Script')) {
    const script = document.createElement('script');
    script.id = 'adminGamesTabsV4Script';
    script.src = './assets/js/public/admin-games-tabs-v4.js?v=2.1-action-parity';
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

  /*
   * Карточка «На рассмотрении»: Steam остаётся доступен через название игры,
   * а нижняя строка действий не дублирует отдельную кнопку «Открыть Steam».
   * Нормализация живёт здесь, рядом с остальными DOM-правками админки, чтобы
   * не добавлять ещё один поверхностный UI-скрипт.
   */
  const moderationList = document.getElementById('suggestionModerationList');
  let pendingCardHeightRem = 0;

  function rememberPendingCardHeight(card) {
    if (!(card instanceof Element) || card.classList.contains('admin-catalog-card')) return;
    const rootSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 1;
    const height = card.getBoundingClientRect().height;
    if (height > 0) pendingCardHeightRem = height / rootSize;
  }

  function copyPublishTypography(publishButton, commentsButton) {
    const label = commentsButton?.querySelector(':scope > span');
    if (!publishButton || !label) return;

    const apply = () => {
      if (!publishButton.isConnected || !label.isConnected) return;

      // The visible "Опубликовать" label may be drawn by ::before while the
      // button itself still inherits Manrope. Reading only the button therefore
      // copied the wrong family into "Комментарии" as an inline style.
      const direct = window.getComputedStyle(publishButton);
      const pseudo = window.getComputedStyle(publishButton, '::before');
      const pseudoContent = String(pseudo.content || '').replace(/["']/g, '').trim();
      const source = pseudoContent && !['none', 'normal'].includes(pseudoContent)
        ? pseudo
        : direct;

      // Font family is explicit: comments must always use the same Druk Cyr
      // face as the visible action labels. Other metrics follow the source label
      // so the proportions stay identical across responsive breakpoints.
      label.style.fontFamily = "'DrukCyr-Heavy', 'Druk Cyr', sans-serif";
      label.style.fontSize = source.fontSize;
      label.style.fontWeight = '900';
      label.style.fontStyle = source.fontStyle || 'normal';
      label.style.lineHeight = source.lineHeight;
      label.style.letterSpacing = source.letterSpacing;
      label.style.textTransform = 'uppercase';
    };

    // First pass handles the current frame; the second pass handles stylesheets
    // and the Druk face finishing after the card itself was inserted.
    apply();
    requestAnimationFrame(apply);
    document.fonts?.ready?.then(apply).catch(() => {});
  }

  function normalizeModerationCard(card) {
    if (!(card instanceof Element)) return;
    const actions = card.querySelector('.moderation-actions');
    if (!actions) return;

    const steamAction = actions.querySelector('.moderation-steam[href]');
    const titleControl = card.querySelector('.moderation-title-open');
    if (steamAction && titleControl && titleControl.tagName !== 'A') {
      const titleLink = document.createElement('a');
      titleLink.className = titleControl.className;
      titleLink.href = steamAction.getAttribute('href');
      titleLink.target = '_blank';
      titleLink.rel = 'noopener noreferrer';
      titleLink.textContent = titleControl.textContent;
      titleControl.replaceWith(titleLink);
    }

    const publishButton = actions.querySelector('[data-action="approve"]');
    const commentsButton = card.querySelector('.moderation-support-comments-open');
    if (publishButton && commentsButton && commentsButton.parentElement !== actions) {
      publishButton.after(commentsButton);
    }
    if (publishButton && commentsButton) {
      actions.classList.add('has-inline-comments');
      copyPublishTypography(publishButton, commentsButton);
    }

    steamAction?.remove();

    rememberPendingCardHeight(card);
    requestAnimationFrame(() => rememberPendingCardHeight(card));
    document.fonts?.ready?.then(() => rememberPendingCardHeight(card)).catch(() => {});
  }

  function normalizePublishedCard(card) {
    if (!(card instanceof Element)) return;
    const actions = card.querySelector('.admin-catalog-actions');
    if (!actions) return;

    card.classList.add('is-published-parity');

    const steamAction = actions.querySelector('a[href]');
    const title = card.querySelector('.admin-catalog-card-copy h3');
    if (steamAction && title && !title.querySelector('a')) {
      const titleLink = document.createElement('a');
      titleLink.className = 'admin-catalog-title-open';
      titleLink.href = steamAction.getAttribute('href');
      titleLink.target = '_blank';
      titleLink.rel = 'noopener noreferrer';
      titleLink.textContent = title.textContent;
      title.replaceChildren(titleLink);
    }

    const statusLabel = card.querySelector('.admin-catalog-status-label');
    const statuses = card.querySelector('.admin-catalog-statuses');
    if (statusLabel && statuses && !statusLabel.closest('.admin-catalog-status-row')) {
      const row = document.createElement('div');
      row.className = 'admin-catalog-status-row';
      statusLabel.before(row);
      row.append(statusLabel, statuses);
    }

    steamAction?.remove();

    const saveButton = actions.querySelector('.admin-catalog-save');
    let commentsButton = actions.querySelector('.admin-catalog-comments-open');
    if (!commentsButton && card.dataset.gameId) {
      commentsButton = document.createElement('button');
      commentsButton.className = 'moderation-support-comments-open admin-catalog-comments-open';
      commentsButton.type = 'button';
      commentsButton.dataset.publishedComments = card.dataset.gameId;
      commentsButton.setAttribute('aria-label', `Открыть комментарии игры ${title?.textContent?.trim() || ''}`);
      commentsButton.innerHTML = '<span>Комментарии</span><img alt="" aria-hidden="true" src="./assets/images/figma/arrow-circle-white.svg">';
      if (saveButton) saveButton.after(commentsButton);
      else actions.prepend(commentsButton);
    }

    actions.classList.add('has-published-parity');

    if (pendingCardHeightRem > 0 && window.innerWidth > 720) {
      card.style.height = 'auto';
      card.style.minHeight = `${pendingCardHeightRem}rem`;
      card.style.maxHeight = 'none';
    }
  }

  function openPublishedComments(gameId) {
    const id = String(gameId || '').trim();
    if (!id) return;

    const openModal = typeof window.openGameModal === 'function'
      ? window.openGameModal
      : typeof openGameModal === 'function'
        ? openGameModal
        : null;
    if (!openModal) return;

    openModal(id);
    window.setTimeout(() => {
      const modal = document.querySelector('.game-modal:not([hidden])');
      const comments = modal?.querySelector('.modal-comments');
      if (!comments) return;
      comments.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 90);
  }

  function normalizeAdminCards(root = moderationList) {
    if (!root) return;
    if (root.matches?.('.moderation-card')) normalizeModerationCard(root);
    if (root.matches?.('.admin-catalog-card')) normalizePublishedCard(root);
    root.querySelectorAll?.('.moderation-card').forEach(normalizeModerationCard);
    root.querySelectorAll?.('.admin-catalog-card').forEach(normalizePublishedCard);
  }

  let normalizationFrame = 0;
  function scheduleAdminCardNormalization() {
    if (!moderationList || normalizationFrame) return;
    normalizationFrame = requestAnimationFrame(() => {
      normalizationFrame = 0;
      normalizeAdminCards(moderationList);
    });
  }

  if (moderationList) {
    normalizeAdminCards();
    new MutationObserver(scheduleAdminCardNormalization).observe(moderationList, {
      childList: true,
      subtree: true
    });
  }

  moderationList?.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('[data-published-comments]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    openPublishedComments(button.dataset.publishedComments);
  }, true);

  // The published tab redraws the same list asynchronously. Re-run after the
  // click as a deterministic fallback in addition to MutationObserver.
  document.querySelector('[data-suggestion-status="approved"]')?.addEventListener('click', () => {
    const pendingCard = moderationList?.querySelector('.moderation-card:not(.admin-catalog-card)');
    if (pendingCard) rememberPendingCardHeight(pendingCard);
    scheduleAdminCardNormalization();
    window.setTimeout(scheduleAdminCardNormalization, 40);
    window.setTimeout(scheduleAdminCardNormalization, 180);
  }, true);

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
    if (document.querySelector('.game-modal:not([hidden])')) return;
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
