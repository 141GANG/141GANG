(() => {
  'use strict';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const modalSelector = '[aria-modal="true"], dialog[open]';
  const standalonePanels = {
    'standalone-tier': 'tierListPanel',
    'standalone-auction': 'auctionPanel'
  };

  function isStandalonePageRoot(root) {
    return Object.entries(standalonePanels).some(([className, panelId]) => (
      document.body.classList.contains(className) && root?.id === panelId
    ));
  }

  function isStandalonePageDialog(node) {
    return Object.entries(standalonePanels).some(([className, panelId]) => (
      document.body.classList.contains(className)
      && node?.matches?.('[aria-modal="true"]')
      && node.parentElement?.id === panelId
    ));
  }

  const canUseLenis = typeof window.Lenis === 'function' && !reducedMotion;

  const lenis = canUseLenis
    ? new window.Lenis({
        autoRaf: true,
        autoToggle: false,
        anchors: false,
        smoothWheel: true,
        syncTouch: false,
        lerp: 0.1,
        wheelMultiplier: 0.9,
        // Dedicated pages reuse the modal markup as their main content. Their
        // root dialog must remain controlled by Lenis; real nested modals keep
        // their own native scrolling.
        prevent: node => node.matches(modalSelector) && !isStandalonePageDialog(node)
      })
    : null;

  window.CR7_LENIS = lenis;

  // The management page is intentionally locked to the viewport: its header
  // stays fixed while the game cards scroll inside their own column. Give that
  // column a dedicated Lenis instance instead of trying to move the document.
  const adminCatalogScroller = document.getElementById('suggestionModerationList');
  const adminCatalogContent = adminCatalogScroller?.querySelector(':scope > .admin-catalog-scroll-content');
  const adminCatalogLenis = canUseLenis && adminCatalogScroller && adminCatalogContent
    ? new window.Lenis({
        wrapper: adminCatalogScroller,
        content: adminCatalogContent,
        eventsTarget: adminCatalogScroller,
        autoRaf: true,
        autoToggle: false,
        smoothWheel: true,
        syncTouch: false,
        lerp: 0.1,
        wheelMultiplier: 0.9
      })
    : null;

  window.CR7_ADMIN_CATALOG_LENIS = adminCatalogLenis;

  let scrollLocked = false;

  function getModalRoots() {
    const roots = new Set();
    document.querySelectorAll(modalSelector).forEach(dialog => {
      roots.add(dialog.closest('[aria-hidden]') || dialog);
    });
    return [...roots];
  }

  function syncModalScroll() {
    const shouldLock = getModalRoots().some(root => {
      // On dedicated URLs these panels are the page itself, not overlays.
      // Locking the document there would stop Lenis for the whole page.
      if (isStandalonePageRoot(root)) {
        return false;
      }
      if (root instanceof HTMLDialogElement) return root.open;
      return !root.hidden;
    });

    document.documentElement.classList.toggle('modal-scroll-locked', shouldLock);
    document.body.classList.toggle('modal-scroll-locked', shouldLock);

    if (shouldLock === scrollLocked) return;
    scrollLocked = shouldLock;

    if (lenis) {
      if (shouldLock) lenis.stop();
      else lenis.start();
    }
  }

  const modalObserver = new MutationObserver(syncModalScroll);
  modalObserver.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['hidden', 'aria-hidden', 'open']
  });

  syncModalScroll();

  window.addEventListener('beforeunload', () => {
    modalObserver.disconnect();
    adminCatalogLenis?.destroy();
    lenis?.destroy();
  }, { once: true });
})();
