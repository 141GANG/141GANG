(() => {
  const catalog = document.getElementById('catalog');
  const catalogToolbar = catalog?.querySelector('.catalog-toolbar');
  const catalogLink = document.querySelector('.nav-link[href="#catalog"]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let frame = 0;
  const compactSentinel = catalog?.querySelector('.catalog-compact-sentinel');

  function updatePageState() {
    frame = 0;
    document.body.classList.toggle('has-scrolled',window.scrollY > 24);
  }

  function scheduleUpdate() {
    if (!frame) frame = requestAnimationFrame(updatePageState);
  }

  if (catalogToolbar && compactSentinel && 'IntersectionObserver' in window) {
    const compactObserver = new IntersectionObserver(([entry]) => {
      catalogToolbar.classList.toggle('is-compact',!entry.isIntersecting&&entry.boundingClientRect.top<180);
    },{ rootMargin:'-180px 0px 0px',threshold:0 });
    compactObserver.observe(compactSentinel);
  }

  if (catalog && catalogLink && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      catalogLink.classList.toggle('is-current',entries.some(entry => entry.isIntersecting));
    },{ rootMargin: '-20% 0px -65%',threshold: 0 });
    observer.observe(catalog);
  }

  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click',event => {
      const hash = link.getAttribute('href');
      if (!hash || hash === '#') return;
      const target = document.querySelector(hash);
      if (!target || reducedMotion) return;
      event.preventDefault();
      const targetTop = Math.max(0, window.scrollY + target.getBoundingClientRect().top);
      if (window.CR7_LENIS) {
        window.CR7_LENIS.resize();
        window.CR7_LENIS.scrollTo(targetTop, { immediate: false });
      }
      else window.scrollTo({ top: targetTop, behavior: 'smooth' });
      history.replaceState(null,'',hash);
    }, { capture: true });
  });

  window.addEventListener('scroll',scheduleUpdate,{ passive: true });
  window.addEventListener('resize',scheduleUpdate,{ passive: true });
  updatePageState();
})();
