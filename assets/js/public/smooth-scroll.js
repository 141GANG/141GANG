(() => {
  'use strict';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const modalSelector = '[aria-modal="true"], dialog[open]';
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
        prevent: node => node.matches(modalSelector)
      })
    : null;

  window.CR7_LENIS = lenis;

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
    lenis?.destroy();
  }, { once: true });
})();
