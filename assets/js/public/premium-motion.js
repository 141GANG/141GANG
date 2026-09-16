(() => {
  'use strict';

  const root = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const panelSelector = [
    '.gang-panel',
    '.auction-panel',
    '.tier-panel',
    '.suggestions-panel',
    '.suggestion-comments-panel',
    '.media-panel',
    '.media-file-preview',
    '.site-auth-panel',
    '.feature-panel',
    '.admin-portal',
    '.duplicate-modal'
  ].join(',');

  const surfaceSelectors = [
    ['.media-panel', '.media-workspace'],
    ['.media-file-preview', '.media-file-preview-dialog'],
    ['.gang-panel', '.gang-dialog'],
    ['.auction-panel', '.auction-dialog'],
    ['.tier-panel', '.tier-dialog'],
    ['.suggestions-panel', '.suggestions-dialog'],
    ['.suggestion-comments-panel', '.suggestion-comments-dialog'],
    ['.site-auth-panel', '.site-auth-dialog'],
    ['.feature-panel', '.feature-dialog'],
    ['.admin-portal', '.admin-portal-dialog'],
    ['.duplicate-modal', '.duplicate-dialog']
  ];

  const backdropSelector = [
    '.modal-backdrop',
    '.gang-backdrop',
    '.auction-backdrop',
    '.tier-backdrop',
    '.suggestions-backdrop',
    '.suggestion-comments-backdrop',
    '.media-backdrop',
    '.media-file-preview-backdrop',
    '.site-auth-backdrop',
    '.feature-backdrop',
    '.admin-portal-backdrop',
    '.duplicate-backdrop'
  ].join(',');

  const pieceSelector = [
    '.figma-upload-media-pane',
    '.figma-upload-author',
    '.figma-media-category-field',
    '.media-fields',
    '.media-submit-row',
    '.modal-media',
    '.modal-badges',
    '.modal-release',
    '.modal-title',
    '.modal-description',
    '.modal-actions',
    '.gang-head',
    '.gang-status',
    '.gang-grid',
    '.auction-sidebar',
    '.auction-content',
    '.tier-dialog > header',
    '.tier-board',
    '.suggestions-head',
    '.suggestions-tabs',
    '.suggestions-view:not([hidden])',
    '.site-auth-kicker',
    '.site-auth-dialog > h2',
    '.site-auth-description',
    '.site-auth-providers',
    '.site-auth-account:not([hidden])',
    '.admin-portal-head',
    '.admin-shell',
    '.duplicate-kicker',
    '.duplicate-dialog > h2',
    '.duplicate-dialog > p',
    '.duplicate-actions'
  ].join(',');

  const revealObserver = !reduceMotion.matches && 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const element = entry.target;
          revealObserver.unobserve(element);
          requestAnimationFrame(() => element.classList.add('premium-inview'));
          window.setTimeout(() => {
            element.classList.remove('premium-reveal', 'premium-inview');
            element.style.removeProperty('--premium-reveal-delay');
          }, 1050);
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.045 })
    : null;

  const revealed = new WeakSet();
  const preparedPanels = new WeakSet();
  const preparedPieces = new WeakSet();
  const panelPieceCounts = new WeakMap();
  const scheduledPanels = new WeakSet();
  let motionStarted = false;

  function prepareReveal(element, index = 0) {
    if (!element || revealed.has(element) || reduceMotion.matches) return;
    revealed.add(element);
    element.classList.add('premium-reveal');
    element.style.setProperty('--premium-reveal-delay', `${Math.min(index, 5) * 48}ms`);
    if (revealObserver) revealObserver.observe(element);
    else element.classList.add('premium-inview');
  }

  function preparePageReveals(scope = document) {
    if (reduceMotion.matches) return;
    if (scope instanceof Element && scope.matches('.content-menu-card, .catalog-toolbar, #gameGrid .game-card, .footer-inner')) {
      prepareReveal(scope);
    }
    scope.querySelectorAll?.('.content-menu-card').forEach((element, index) => prepareReveal(element, index));
    scope.querySelectorAll?.('.catalog-toolbar').forEach(element => prepareReveal(element));
    scope.querySelectorAll?.('#gameGrid .game-card').forEach((element, index) => prepareReveal(element, index % 4));
    scope.querySelectorAll?.('.footer-inner').forEach(element => prepareReveal(element));
  }

  function panelSurface(panel) {
    // The game card owns a viewport-fit transform (centering + responsive
    // scale). Its existing transition is already part of the design, so only
    // its backdrop and inner content participate in the shared choreography.
    if (panel.matches('.game-modal')) return null;

    const match = surfaceSelectors.find(([panelSelectorItem]) => panel.matches(panelSelectorItem));
    return match ? panel.querySelector(match[1]) : null;
  }

  function preparePanelPiece(panel, element) {
    if (!element || preparedPieces.has(element)) return;

    const index = panelPieceCounts.get(panel) || 0;
    if (index >= 7) return;

    preparedPieces.add(element);
    panelPieceCounts.set(panel, index + 1);
    element.classList.add('premium-window-piece');
    element.style.setProperty('--premium-piece-index', String(index));
  }

  function preparePanelPieces(panel, scope = panel) {
    // The game card fades as one complete composition. Hiding individual
    // pieces on close used to leave its background shell visible for a beat.
    if (panel.matches('.game-modal')) return;

    if (scope instanceof Element && scope.matches(pieceSelector)) {
      preparePanelPiece(panel, scope);
    }
    scope.querySelectorAll?.(pieceSelector).forEach(element => preparePanelPiece(panel, element));
  }

  function preparePanel(panel) {
    if (!(panel instanceof Element)) return;

    if (!preparedPanels.has(panel)) {
      preparedPanels.add(panel);
      panel.classList.add('premium-window');
      panel.classList.toggle('premium-window-side', panel.matches('.gang-panel, .admin-portal'));
      panel.querySelector(backdropSelector)?.classList.add('premium-window-backdrop');
      panelSurface(panel)?.classList.add('premium-window-surface');
    }

    preparePanelPieces(panel);
  }

  function panelShouldBeOpen(panel) {
    return !panel.hidden && panel.getAttribute('aria-hidden') !== 'true';
  }

  function syncPanel(panel) {
    preparePanel(panel);
    const shouldOpen = motionStarted && panelShouldBeOpen(panel);
    if (panel.classList.contains('premium-open') === shouldOpen) return;

    if (!shouldOpen) {
      panel.classList.remove('premium-open');
      return;
    }

    if (scheduledPanels.has(panel)) return;
    scheduledPanels.add(panel);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      scheduledPanels.delete(panel);
      if (motionStarted && panelShouldBeOpen(panel)) panel.classList.add('premium-open');
    }));
  }

  function scanPanels(scope = document) {
    if (scope instanceof Element && scope.matches(panelSelector)) syncPanel(scope);
    scope.querySelectorAll?.(panelSelector).forEach(syncPanel);
  }

  function startMotion() {
    if (motionStarted) return;
    motionStarted = true;
    root.classList.add('premium-motion-enabled');

    if (reduceMotion.matches) root.classList.add('premium-motion-reduced');

    requestAnimationFrame(() => {
      root.classList.add('premium-motion-ready');
      root.classList.remove('premium-motion-pending');
      scanPanels();
    });
  }

  root.classList.add('premium-motion-enabled');
  preparePageReveals();
  scanPanels();

  const mutationObserver = new MutationObserver(records => {
    records.forEach(record => {
      if (record.type === 'childList') {
        record.addedNodes.forEach(node => {
          if (!(node instanceof Element)) return;
          preparePageReveals(node);

          if (node.matches(panelSelector) || node.querySelector(panelSelector)) {
            scanPanels(node);
          }

          const ownerPanel = node.closest(panelSelector);
          if (ownerPanel) preparePanelPieces(ownerPanel, node);
        });
      }

      if (record.type === 'attributes' && record.target instanceof Element) {
        if (record.target.matches(panelSelector)) {
          syncPanel(record.target);
        } else {
          const ownerPanel = record.target.closest(panelSelector);
          if (ownerPanel) preparePanelPieces(ownerPanel, record.target);
        }
      }
    });
  });

  mutationObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['hidden', 'aria-hidden'],
    childList: true,
    subtree: true
  });

  reduceMotion.addEventListener?.('change', () => location.reload());

  const loader = document.getElementById('siteLoader');
  if (!loader || loader.classList.contains('is-hidden')) {
    startMotion();
  } else {
    const loaderObserver = new MutationObserver(() => {
      if (!loader.classList.contains('is-hidden')) return;
      loaderObserver.disconnect();
      startMotion();
    });
    loaderObserver.observe(loader, { attributes: true, attributeFilter: ['class'] });
    window.setTimeout(startMotion, 1200);
  }
})();
