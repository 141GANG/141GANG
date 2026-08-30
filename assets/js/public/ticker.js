function setupInfiniteTicker() {
      const ticker = document.getElementById('infiniteTicker');
      const wrap = ticker?.closest('.ticker-wrap');
      const sourceGroup = ticker?.querySelector('[data-ticker-group]');
      const cloneGroup = ticker?.querySelector('[data-ticker-clone]');
      if (!ticker || !wrap || !sourceGroup || !cloneGroup) return;

      const baseMarkup = sourceGroup.innerHTML;
      let resizeTimer = 0;

      const rebuild = () => {
        ticker.classList.remove('is-running');
        ticker.style.removeProperty('--ticker-shift');
        ticker.style.removeProperty('--ticker-duration');
        sourceGroup.innerHTML = baseMarkup;
        cloneGroup.innerHTML = '';

        const targetWidth = Math.max(wrap.clientWidth * 1.25, wrap.clientWidth + 320);
        const template = sourceGroup.firstElementChild;
        if (!template) return;

        let safety = 0;
        while (sourceGroup.scrollWidth < targetWidth && safety < 20) {
          sourceGroup.appendChild(template.cloneNode(true));
          safety += 1;
        }

        cloneGroup.innerHTML = sourceGroup.innerHTML;
        const distance = sourceGroup.getBoundingClientRect().width;
        const pixelsPerSecond = 76;
        const duration = Math.max(18, distance / pixelsPerSecond);

        ticker.style.setProperty('--ticker-shift', `${-distance}px`);
        ticker.style.setProperty('--ticker-duration', `${duration.toFixed(2)}s`);
        void ticker.offsetWidth;
        ticker.classList.add('is-running');
      };

      const scheduleRebuild = () => {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(rebuild, 120);
      };

      if ('ResizeObserver' in window) {
        const observer = new ResizeObserver(scheduleRebuild);
        observer.observe(wrap);
      } else {
        window.addEventListener('resize', scheduleRebuild, { passive: true });
      }

      if (document.fonts?.ready) document.fonts.ready.then(rebuild).catch(rebuild);
      else rebuild();
    }
