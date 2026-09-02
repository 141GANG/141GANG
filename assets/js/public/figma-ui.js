(() => {
  const FIGMA_UI_BUILD = '8.4-media-auth-submit';
  const assets = [
    ['style','figmaMainFinalStyles','./assets/css/public/figma-main-final.css?v=2.0'],
    ['style','adminFigmaFinalStyles','./assets/css/public/admin-figma-final.css?v=1.0'],
    ['style','proposalWindowsFigmaStyles','./assets/css/public/proposal-windows-figma.css?v=4.8'],
    ['style','proposalMediaFigmaExactStyles','./assets/css/public/proposal-media-figma-exact.css?v=3.1-preview-slider'],
    ['style','adminCardIconsStyles','./assets/css/public/admin-card-icons.css?v=1.1'],
    ['style','figmaTypographyFinalStyles','./assets/css/public/figma-typography-final.css?v=4.7'],
    ['style','e2eResponsiveP0Styles','./assets/css/public/e2e-responsive-p0.css?v=1.1-rem'],
    ['style','gameCommentManagementStyles','./assets/css/public/game-comment-management.css?v=1.0'],
    ['script','proposalWindowsFigmaScript','./assets/js/public/proposal-windows-figma.js?v=3.5-media-preview'],
    ['script','adminCardIconsScriptV2','./assets/js/public/admin-card-icons-v2.js?v=2.0'],
    ['script','catalogLiveRefreshScript','./assets/js/public/catalog-live-refresh.js?v=1.0'],
    ['script','mediaAuthenticatedSubmitBridge','./assets/js/public/media-authenticated-submit-bridge.js?v=1.0']
  ];
  assets.forEach(([type,id,src]) => {
    if (document.getElementById(id)) return;
    const node = document.createElement(type === 'style' ? 'link' : 'script');
    node.id = id;
    if (type === 'style') { node.rel = 'stylesheet'; node.href = src; }
    else { node.src = src; node.defer = true; }
    document.head.appendChild(node);
  });

  document.addEventListener('dragstart', event => {
    if (event.target instanceof Element && event.target.closest('img')) event.preventDefault();
  }, true);

  const contentToggle = document.getElementById('contentMenuToggle');
  const contentPanel = document.getElementById('contentMenuPanel');
  const servicesToggle = document.getElementById('servicesToggle');
  const servicesMenu = document.getElementById('servicesMenu');
  const filtersToggle = document.getElementById('libraryFiltersToggle');
  const filtersMenu = document.getElementById('libraryFiltersMenu');
  const sortToggle = document.getElementById('catalogSortToggle');
  const sortMenu = document.getElementById('catalogSortMenu');
  const sortSelect = document.getElementById('publicCatalogSort');
  const managementButton = document.getElementById('adminPortalOpen');

  const mediaSelected = document.getElementById('mediaSelected');

  // The proposal preview strip already scrolls horizontally. This range
  // control mirrors that real scroll position instead of introducing a second
  // carousel, so every selected photo/video remains reachable by mouse,
  // touchpad, touch and keyboard.
  function setupMediaPreviewSlider() {
    if (!mediaSelected || mediaSelected.dataset.previewSliderBound === 'true') return;
    mediaSelected.dataset.previewSliderBound = 'true';

    const slider = document.createElement('div');
    slider.className = 'figma-media-preview-slider';
    slider.hidden = true;
    slider.innerHTML = `
      <div class="figma-media-preview-slider-meta">
        <span>Предпросмотр файлов</span>
        <span class="figma-media-preview-slider-position" data-media-preview-position>0 / 0</span>
      </div>
      <input aria-label="Прокрутка предпросмотра файлов" max="1000" min="0" step="1" type="range" value="0">
    `;
    mediaSelected.insertAdjacentElement('afterend', slider);

    const range = slider.querySelector('input[type="range"]');
    const position = slider.querySelector('[data-media-preview-position]');
    let syncFrame = 0;

    const items = () => [...mediaSelected.querySelectorAll('.media-selected-item')];
    const maxScroll = () => Math.max(0, mediaSelected.scrollWidth - mediaSelected.clientWidth);

    function syncSlider() {
      syncFrame = 0;
      const list = items();
      const maximum = maxScroll();
      const desktop = window.matchMedia('(min-width: 901px)').matches;
      const usable = desktop && list.length > 1 && maximum > 1;

      slider.hidden = !usable;
      mediaSelected.classList.toggle('has-preview-slider', usable);

      if (!list.length) {
        range.value = '0';
        range.style.setProperty('--preview-progress', '0%');
        position.textContent = '0 / 0';
        range.setAttribute('aria-valuetext', 'Файлы не выбраны');
        return;
      }

      if (!usable) {
        range.value = '0';
        range.style.setProperty('--preview-progress', '0%');
        position.textContent = `${list.length} ${list.length === 1 ? 'файл' : list.length < 5 ? 'файла' : 'файлов'}`;
        range.setAttribute('aria-valuetext', `${list.length} ${list.length === 1 ? 'файл' : list.length < 5 ? 'файла' : 'файлов'}`);
        return;
      }

      const value = Math.max(0, Math.min(1000, Math.round(mediaSelected.scrollLeft / maximum * 1000)));
      range.value = String(value);
      range.style.setProperty('--preview-progress', `${value / 10}%`);
      position.textContent = `${list.length} ${list.length === 1 ? 'файл' : list.length < 5 ? 'файла' : 'файлов'}`;
      range.setAttribute('aria-valuetext', `Прокрутка ${Math.round(value / 10)}%, ${list.length} файлов`);
    }

    function scheduleSync() {
      if (!syncFrame) syncFrame = requestAnimationFrame(syncSlider);
    }

    range.addEventListener('input', () => {
      const maximum = maxScroll();
      mediaSelected.scrollLeft = maximum * (Number(range.value) / 1000);
      scheduleSync();
    });

    mediaSelected.addEventListener('scroll', scheduleSync, { passive: true });

    const mutationObserver = new MutationObserver(scheduleSync);
    mutationObserver.observe(mediaSelected, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden']
    });

    if ('ResizeObserver' in window) {
      const resizeObserver = new ResizeObserver(scheduleSync);
      resizeObserver.observe(mediaSelected);
    } else {
      window.addEventListener('resize', scheduleSync, { passive: true });
    }

    scheduleSync();
  }

  setupMediaPreviewSlider();

  // Library filters reuse the exact Sort dropdown component. Removing the
  // generic filter-btn/catalog-filter-menu hooks also prevents late catalog
  // styles from turning these rows into the large rounded pills.
  function normalizeCatalogFilterMenu() {
    if (!filtersMenu) return;

    filtersMenu.classList.remove('catalog-filter-menu');
    filtersMenu.classList.add('catalog-sort-menu');

    filtersMenu.querySelectorAll('[data-library-filter]').forEach(button => {
      button.classList.remove('filter-btn');
      button.querySelector('i')?.remove();
      button.setAttribute('aria-pressed', String(button.classList.contains('active')));
    });

    // A second click on an active filter already clears that filter, so the
    // separate reset action is redundant. Removing it also leaves the exact
    // same 8rem bottom/side padding as the Sort dropdown.
    filtersMenu.querySelector('[data-library-filter-actions-title]')?.remove();
    document.getElementById('libraryFiltersReset')?.remove();
  }

  normalizeCatalogFilterMenu();
  // Run one more idempotent pass after the current task so no later synchronous
  // initialization can leave the legacy reset row behind.
  queueMicrotask(normalizeCatalogFilterMenu);

  function fontAvailable(name) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return false;
    const sample = 'Предложка141WMWM';
    context.font = '72px monospace';
    const fallbackWidth = context.measureText(sample).width;
    context.font = `72px "${name}", monospace`;
    return Math.abs(context.measureText(sample).width - fallbackWidth) > .5;
  }

  function detectDisplayFont() {
    document.body.classList.remove('has-druk-cyr');
  }

  detectDisplayFont();
  document.fonts?.ready?.then(detectDisplayFont);

  function setPopup(toggle, menu, open) {
    if (!toggle || !menu) return;
    toggle.setAttribute('aria-expanded', String(open));
    menu.hidden = !open;
  }

  function closeCatalogMenus(except = null) {
    if (except !== filtersMenu) setPopup(filtersToggle, filtersMenu, false);
    if (except !== sortMenu) setPopup(sortToggle, sortMenu, false);
  }

  function togglePopup(toggle, menu, peerCloser) {
    if (!toggle || !menu) return;
    toggle.addEventListener('click', event => {
      event.stopPropagation();
      const open = menu.hidden;
      peerCloser?.();
      setPopup(toggle, menu, open);
    });
    menu.addEventListener('click', event => event.stopPropagation());
  }

  // Services are temporarily unavailable: keep the control visible but inactive.
  if (servicesToggle) {
    servicesToggle.setAttribute('aria-expanded', 'false');
    servicesToggle.setAttribute('aria-disabled', 'true');
    servicesToggle.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }
  if (servicesMenu) servicesMenu.hidden = true;
  togglePopup(filtersToggle, filtersMenu, () => {
    setPopup(sortToggle, sortMenu, false);
    setPopup(servicesToggle, servicesMenu, false);
  });
  togglePopup(sortToggle, sortMenu, () => {
    setPopup(filtersToggle, filtersMenu, false);
    setPopup(servicesToggle, servicesMenu, false);
  });

  if (contentToggle && contentPanel) {
    contentToggle.addEventListener('click', event => {
      event.preventDefault();
      const panelRect = contentPanel.getBoundingClientRect();
      const panelTop = window.scrollY + panelRect.top;
      const centeredTop = panelTop - Math.max(0,(window.innerHeight - panelRect.height) / 2);
      const maxScroll = Math.max(0,document.documentElement.scrollHeight - window.innerHeight);
      const target = Math.min(maxScroll,Math.max(0,centeredTop));
      if (window.CR7_LENIS?.scrollTo) window.CR7_LENIS.scrollTo(target,{ duration: 1.1 });
      else window.scrollTo({ top: target, behavior: 'smooth' });
    });
  }



  // Proposal cards: white arrow by default; red arrow + fire on hover/focus/touch.
  const proposalMenuCards = [...document.querySelectorAll('.content-menu-card')];
  const proposalArrowWhite = './assets/images/figma/arrow-circle-white.svg';
  const proposalArrowRed = './assets/images/figma/arrow-circle-red.svg';

  function setProposalCardInteractive(card, active) {
    if (!card) return;
    card.classList.toggle('is-menu-interactive', active);
    const arrow = card.querySelector(':scope > img');
    if (arrow) arrow.src = active ? proposalArrowRed : proposalArrowWhite;
  }

  proposalMenuCards.forEach(card => {
    const arrow = card.querySelector(':scope > img');
    if (arrow) arrow.src = proposalArrowWhite;

    card.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'touch') setProposalCardInteractive(card, true);
    });
    card.addEventListener('pointerleave', event => {
      if (event.pointerType !== 'touch') setProposalCardInteractive(card, false);
    });
    card.addEventListener('focus', () => setProposalCardInteractive(card, true));
    card.addEventListener('blur', () => setProposalCardInteractive(card, false));
    card.addEventListener('pointerdown', event => {
      if (event.pointerType === 'touch' || event.pointerType === 'pen') {
        proposalMenuCards.forEach(item => setProposalCardInteractive(item, item === card));
      }
    });
    card.addEventListener('pointerup', event => {
      if (event.pointerType === 'touch' || event.pointerType === 'pen') {
        window.setTimeout(() => setProposalCardInteractive(card, false), 280);
      }
    });
    card.addEventListener('pointercancel', () => setProposalCardInteractive(card, false));
  });


  document.querySelectorAll('.release-filters [data-filter]').forEach(button => {
    button.addEventListener('click', () => setPopup(filtersToggle, filtersMenu, false));
  });

  sortMenu?.querySelectorAll('[data-sort-value]').forEach(button => {
    button.addEventListener('click', () => {
      if (!sortSelect) return;
      sortSelect.value = button.dataset.sortValue;
      sortSelect.dispatchEvent(new Event('change', { bubbles: true }));
      sortMenu.querySelectorAll('[data-sort-value]').forEach(item => item.classList.toggle('active', item === button));
      setPopup(sortToggle, sortMenu, false);
    });
  });

  servicesMenu?.addEventListener('click', event => {
    if (event.target.closest('button')) setPopup(servicesToggle, servicesMenu, false);
  });

  document.addEventListener('click', event => {
    if (!event.target.closest('.nav-menu-wrap')) setPopup(servicesToggle, servicesMenu, false);
    if (!event.target.closest('.catalog-menu-wrap')) closeCatalogMenus();
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    setPopup(servicesToggle, servicesMenu, false);
    closeCatalogMenus();
  });

  async function refreshAdminState() {
    let isAdmin = false;
    try {
      const client = typeof getConfiguredClient === 'function' ? getConfiguredClient() : window.CR7_SUPABASE_CLIENT;
      if (client) {
        const { data: sessionData } = await client.auth.getSession();
        if (sessionData?.session?.user && !sessionData.session.user.is_anonymous) {
          const { data, error } = await client.rpc('is_site_admin');
          isAdmin = !error && data === true;
        }
      }
    } catch (error) {
      console.warn('Не удалось обновить состояние управления:', error?.message || error);
    }
    document.body.classList.toggle('is-site-admin', isAdmin);
    if (managementButton) {
      managementButton.classList.toggle('is-admin', isAdmin);
      managementButton.setAttribute('aria-label', isAdmin ? 'Открыть управление сайтом' : 'Войти в управление сайтом');
      managementButton.title = isAdmin ? 'Управление сайтом' : 'Вход администратора';
    }
  }

  function bindAdminRefresh() {
    refreshAdminState();
    const client = typeof getConfiguredClient === 'function' ? getConfiguredClient() : window.CR7_SUPABASE_CLIENT;
    client?.auth?.onAuthStateChange?.(() => window.setTimeout(refreshAdminState, 0));
  }

  if (window.CR7_SUPABASE_CLIENT || window.supabase?.createClient) bindAdminRefresh();
  else window.addEventListener('cr7:supabase-ready', bindAdminRefresh, { once: true });
})();
