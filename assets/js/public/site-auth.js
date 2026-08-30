(() => {
  'use strict';

  const panel = document.getElementById('siteAuthPanel');
  const openButton = document.getElementById('siteAuthOpen');
  const closeButton = document.getElementById('siteAuthClose');
  const providers = document.getElementById('siteAuthProviders');
  const account = document.getElementById('siteAuthAccount');
  const avatar = document.getElementById('siteAuthAvatar');
  const name = document.getElementById('siteAuthName');
  const email = document.getElementById('siteAuthEmail');
  const logoutButton = document.getElementById('siteAuthLogout');
  const notice = document.getElementById('siteAuthNotice');
  if (
    !panel || !openButton || !closeButton || !providers || !account
    || !avatar || !name || !email || !logoutButton || !notice
  ) return;

  let client = null;
  let lastFocusedElement = null;
  let authSubscription = null;
  let initialized = false;

  const config = window.CR7_CONFIG || {};
  const providerLabels = Object.freeze({
    google: 'Google',
    'custom:yandex': 'Яндекс ID'
  });

  function getConfiguredClient() {
    if (window.CR7_SUPABASE_CLIENT) return window.CR7_SUPABASE_CLIENT;
    const url = String(config.supabaseUrl || '');
    const key = String(config.supabasePublishableKey || '');
    const configured = url.startsWith('https://')
      && !url.includes('YOUR-PROJECT')
      && key
      && !key.includes('YOUR-PUBLISHABLE');
    if (!configured || !window.supabase?.createClient) return null;
    window.CR7_SUPABASE_CLIENT = window.supabase.createClient(url,key,{
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
    return window.CR7_SUPABASE_CLIENT;
  }

  function redirectUrl() {
    return new URL(window.location.pathname,window.location.origin).href;
  }

  function displayName(user) {
    const metadata = user?.user_metadata || {};
    return String(
      metadata.full_name
      || metadata.name
      || metadata.display_name
      || metadata.preferred_username
      || user?.email?.split('@')[0]
      || 'Профиль'
    ).trim();
  }

  function avatarUrl(user) {
    const metadata = user?.user_metadata || {};
    return String(metadata.avatar_url || metadata.picture || '').trim();
  }

  function setNotice(message,type = '') {
    notice.textContent = message || '';
    notice.dataset.type = type;
  }

  function setBusy(busy,label = '') {
    providers.querySelectorAll('button').forEach(button => {
      button.disabled = busy;
      button.setAttribute('aria-busy',busy ? 'true' : 'false');
    });
    logoutButton.disabled = busy;
    if (busy && label) setNotice(`Открываем ${label}…`);
  }

  function renderSession(session) {
    const user = session?.user;
    const signedIn = Boolean(user && !user.is_anonymous);
    providers.hidden = signedIn;
    account.hidden = !signedIn;
    openButton.classList.toggle('is-signed-in',signedIn);

    if (!signedIn) {
      openButton.textContent = 'Войти';
      openButton.setAttribute('aria-label','Войти через Яндекс ID или Google');
      avatar.hidden = true;
      avatar.removeAttribute('src');
      name.textContent = '';
      email.textContent = '';
      return;
    }

    const userName = displayName(user);
    const userAvatar = avatarUrl(user);
    openButton.textContent = userName;
    openButton.setAttribute('aria-label',`Открыть профиль: ${userName}`);
    name.textContent = userName;
    email.textContent = user.email || 'Авторизация выполнена';
    avatar.hidden = !userAvatar;
    if (userAvatar) avatar.src = userAvatar;
    else avatar.removeAttribute('src');
  }

  function openPanel() {
    lastFocusedElement = document.activeElement;
    panel.hidden = false;
    panel.setAttribute('aria-hidden','false');
    openButton.setAttribute('aria-expanded','true');
    document.body.classList.add('site-auth-open');
    setNotice('');
    window.requestAnimationFrame(() => closeButton.focus());
  }

  function closePanel() {
    panel.hidden = true;
    panel.setAttribute('aria-hidden','true');
    openButton.setAttribute('aria-expanded','false');
    document.body.classList.remove('site-auth-open');
    if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
  }

  async function signIn(provider) {
    if (!client) {
      setNotice('Авторизация временно недоступна: Supabase не подключён.','error');
      return;
    }
    const label = providerLabels[provider] || 'сервис авторизации';
    setBusy(true,label);
    try {
      const { error } = await client.auth.signInWithOAuth({
        provider,
        options: { redirectTo: redirectUrl() }
      });
      if (error) throw error;
    } catch (error) {
      console.error(`Вход через ${label}:`,error);
      setNotice(`Не удалось открыть ${label}. Проверь настройку провайдера в Supabase.`,'error');
      setBusy(false);
    }
  }

  async function signOut() {
    if (!client) return;
    setBusy(true);
    setNotice('Завершаем сеанс…');
    const { error } = await client.auth.signOut({ scope: 'local' });
    setBusy(false);
    if (error) {
      setNotice(`Не удалось выйти: ${error.message}`,'error');
      return;
    }
    setNotice('Вы вышли из профиля.','success');
    renderSession(null);
  }

  async function initialize() {
    if (initialized) return;
    client = getConfiguredClient();
    if (!client) {
      if (window.CR7_SUPABASE_SDK_STATUS === 'loading') return;
      initialized = true;
      setNotice('Авторизация временно недоступна.','error');
      return;
    }
    initialized = true;

    const sessionResult = window.CR7_AUTH?.getUsableSession
      ? await window.CR7_AUTH.getUsableSession(client)
      : await client.auth.getSession();
    if (sessionResult.error) {
      setNotice(`Не удалось проверить сеанс: ${sessionResult.error.message}`,'error');
    }
    window.CR7_AUTH?.cacheSession?.(sessionResult.data?.session || null);
    renderSession(sessionResult.data?.session || null);

    const { data } = client.auth.onAuthStateChange((_event,session) => {
      window.setTimeout(() => {
        window.CR7_AUTH?.cacheSession?.(session);
        renderSession(session);
        setBusy(false);
      },0);
    });
    authSubscription = data?.subscription || null;
  }

  openButton.addEventListener('click',openPanel);
  closeButton.addEventListener('click',closePanel);
  panel.addEventListener('click',event => {
    if (event.target.matches('[data-site-auth-close]')) closePanel();
  });
  providers.addEventListener('click',event => {
    const button = event.target.closest('[data-auth-provider]');
    if (!button || button.disabled) return;
    signIn(button.dataset.authProvider);
  });
  logoutButton.addEventListener('click',signOut);
  document.addEventListener('keydown',event => {
    if (event.key === 'Escape' && !panel.hidden) closePanel();
  });
  window.addEventListener('beforeunload',() => authSubscription?.unsubscribe?.());
  window.addEventListener('cr7:supabase-ready',initialize,{ once: true });
  window.addEventListener('cr7:supabase-error',initialize,{ once: true });
  initialize();
})();
