window.CR7_CONFIG = Object.freeze({
  supabaseUrl: 'https://ncqqilfkgdvnkgsiheok.supabase.co',
  supabasePublishableKey: 'sb_publishable_F2O5TS614N3ktjdq_oO1ug_7dWLEJAW'
});

(() => {
  if (document.getElementById('authenticatedSubmissionsFixScript')) return;
  const script = document.createElement('script');
  script.id = 'authenticatedSubmissionsFixScript';
  script.src = './assets/js/public/authenticated-submissions-fix.js?v=1.0';
  script.async = false;
  document.head.appendChild(script);
})();
