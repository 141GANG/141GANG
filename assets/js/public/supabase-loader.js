(() => {
  'use strict';

  if (window.supabase?.createClient) {
    window.CR7_SUPABASE_SDK_STATUS = 'ready';
    window.dispatchEvent(new Event('cr7:supabase-ready'));
    return;
  }

  const sources = ['./assets/vendor/supabase.min.js'];
  window.CR7_SUPABASE_SDK_STATUS = 'loading';

  function loadSource(index) {
    if (index >= sources.length) {
      window.CR7_SUPABASE_SDK_STATUS = 'error';
      window.dispatchEvent(new Event('cr7:supabase-error'));
      return;
    }

    const script = document.createElement('script');
    let settled = false;
    const finish = success => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      if (success && window.supabase?.createClient) {
        window.CR7_SUPABASE_SDK_STATUS = 'ready';
        window.dispatchEvent(new Event('cr7:supabase-ready'));
        return;
      }
      script.remove();
      loadSource(index + 1);
    };
    const timer = window.setTimeout(() => finish(false),6000);
    script.async = true;
    script.src = sources[index];
    script.onload = () => finish(true);
    script.onerror = () => finish(false);
    document.head.append(script);
  }

  loadSource(0);
})();
