'use strict';

(function setupSiteLoader() {
  const loader = document.getElementById('siteLoader');
  if (!loader) return;

  document.body.classList.add('is-ready');

  const startedAt = performance.now();
  const minimumVisibleMs = 380;
  const maximumVisibleMs = 9000;
  let hideRequested = false;

  function hideLoader() {
    if (hideRequested) return;
    hideRequested = true;

    const elapsed = performance.now() - startedAt;
    const delay = Math.max(0, minimumVisibleMs - elapsed);

    window.setTimeout(() => {
      loader.classList.add('is-hidden');
      document.body.classList.add('assets-loaded');
      window.setTimeout(() => loader.remove(), 900);
    }, delay);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hideLoader, { once: true });
  } else {
    hideLoader();
  }

  window.addEventListener('load', hideLoader, { once: true });
  window.setTimeout(hideLoader, maximumVisibleMs);
})();
