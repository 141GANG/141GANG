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
  const twitchPrompt = document.getElementById('siteAuthTwitchPrompt');
  const twitchConnectButton = document.getElementById('siteAuthTwitchConnect');
  const twitchLaterButton = document.getElementById('siteAuthTwitchLater');
  const toast = document.getElementById('siteAuthToast');
  if (
    !panel || !openButton || !closeButton || !providers || !account
    || !avatar || !name || !email || !logoutButton || !notice
  ) return;

  let client = null;
  let lastFocusedElement = null;
  let authSubscription = null;
  let initialized = false;
  let currentUser = null;
  let dismissedTwitchPromptUser = '';
  let twitchPromptUser = '';
  let twitchPromptSyncToken = 0;
  let toastTimer = 0;
  let toastHideTimer = 0;

  const config = window.CR7_CONFIG || {};
  const providerLabels = Object.freeze({
    google: 'Google',
    'custom:yandex': 'Яндекс ID',
    twitch: 'Twitch'
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

  function identityProviders(user) {
    const identities = Array.isArray(user?.identities) ? user.identities : [];
    const providers = identities
      .map(identity => String(identity?.provider || '').trim().toLowerCase())
      .filter(Boolean);
    const appProvider = String(user?.app_metadata?.provider || '').trim().toLowerCase();
    if (appProvider) providers.push(appProvider);
    return new Set(providers);
  }

  function needsTwitchLink(user) {
    const providers = identityProviders(user);
    const hasGoogleOrYandex = [...providers].some(provider => (
      provider === 'google' || provider.includes('yandex')
    ));
    return hasGoogleOrYandex && !providers.has('twitch');
  }

  function hasGoogleOrYandexIdentity(user) {
    const providers = identityProviders(user);
    return [...providers].some(provider => (
      provider === 'google' || provider.includes('yandex')
    ));
  }

  function twitchPromptDismissed(userKey) {
    if (!userKey) return false;
    try {
      return window.sessionStorage.getItem(`cr7:twitch-link-dismissed:${userKey}`) === '1';
    } catch {
      return false;
    }
  }

  function rememberTwitchPromptDismissal(userKey) {
    if (!userKey) return;
    try {
      window.sessionStorage.setItem(`cr7:twitch-link-dismissed:${userKey}`,'1');
    } catch {
      // A restricted storage context should not prevent the prompt from closing.
    }
  }

  async function resolveSessionUser(session) {
    const initialUser = session?.user;
    if (!initialUser || initialUser.is_anonymous || !client?.auth?.getUser) return initialUser;
    try {
      const { data, error } = await client.auth.getUser();
      if (!error && data?.user) return data.user;
    } catch {
      // The session user is still enough to render the account if refresh fails.
    }
    return initialUser;
  }

  async function syncTwitchPrompt(session,autoOpen = false) {
    if (!twitchPrompt) return;
    const syncToken = ++twitchPromptSyncToken;
    const user = await resolveSessionUser(session);
    if (syncToken !== twitchPromptSyncToken) return;
    const userKey = String(user?.id || '');
    const visible = Boolean(
      user
      && !user.is_anonymous
      && needsTwitchLink(user)
      && dismissedTwitchPromptUser !== userKey
      && !twitchPromptDismissed(userKey)
    );
    twitchPromptUser = visible ? userKey : '';
    twitchPrompt.hidden = !visible;
    if (visible && autoOpen && panel.hidden) openPanel();
  }

  function setNotice(message,type = '') {
    if (!message) {
      hideToast();
      if (!toast) {
        notice.textContent = '';
        notice.dataset.type = '';
      }
      return;
    }
    showToast(message,type);
  }

  function hideToast() {
    if (!toast) return;
    window.clearTimeout(toastHideTimer);
    toast.classList.remove('is-visible');
    toastHideTimer = window.setTimeout(() => {
      if (!toast.classList.contains('is-visible')) toast.hidden = true;
    },260);
  }

  function showToast(message,type = 'error') {
    if (!toast) {
      notice.textContent = message || '';
      notice.dataset.type = type;
      return;
    }
    window.clearTimeout(toastTimer);
    window.clearTimeout(toastHideTimer);
    toast.replaceChildren();
    if (type === 'loading') {
      const spinner = document.createElement('span');
      spinner.className = 'site-auth-toast-spinner';
      spinner.setAttribute('aria-hidden','true');
      toast.append(spinner);
    }
    toast.append(document.createTextNode(message || ''));
    toast.dataset.type = type;
    toast.hidden = false;
    window.requestAnimationFrame(() => toast.classList.add('is-visible'));
    toastTimer = window.setTimeout(hideToast,5000);
  }

  function setBusy(busy,label = '') {
    providers.querySelectorAll('button').forEach(button => {
      button.disabled = busy;
      button.setAttribute('aria-busy',busy ? 'true' : 'false');
    });
    logoutButton.disabled = busy;
    [twitchConnectButton,twitchLaterButton].forEach(button => {
      if (button) button.disabled = busy;
    });
    if (busy && label) setNotice(`Открываем ${label}…`,'loading');
  }

  function renderSession(session) {
    const user = session?.user;
    const signedIn = Boolean(user && !user.is_anonymous);
    currentUser = signedIn ? user : null;
    providers.hidden = signedIn;
    account.hidden = !signedIn;
    openButton.classList.toggle('is-signed-in',signedIn);

    if (!signedIn) {
      dismissedTwitchPromptUser = '';
      twitchPromptUser = '';
      if (twitchPrompt) twitchPrompt.hidden = true;
      openButton.textContent = 'Войти';
      openButton.setAttribute('aria-label','Войти через Яндекс ID, Google или Twitch');
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
    if (provider === 'twitch' && !hasGoogleOrYandexIdentity(currentUser)) {
      showToast('Сначала нужно войти через Google или Яндекс ID, затем можно привязать Twitch.');
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

  async function linkTwitch() {
    if (!client) {
      setNotice('Авторизация временно недоступна: Supabase не подключён.','error');
      return;
    }
    const user = await resolveSessionUser({ user: currentUser });
    if (!hasGoogleOrYandexIdentity(user)) {
      showToast('Сначала нужно войти через Google или Яндекс ID, затем можно привязать Twitch.');
      return;
    }
    setBusy(true,'Twitch');
    try {
      const { error } = await client.auth.linkIdentity({
        provider: 'twitch',
        options: { redirectTo: redirectUrl() }
      });
      if (error) throw error;
    } catch (error) {
      console.error('Привязка Twitch:',error);
      setNotice('Не удалось привязать Twitch. Проверь настройку провайдера в Supabase.','error');
      setBusy(false);
    }
  }

  async function signOut() {
    if (!client) return;
    setBusy(true);
    setNotice('Завершаем сеанс…','loading');
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
    await syncTwitchPrompt(sessionResult.data?.session || null,true);

    const { data } = client.auth.onAuthStateChange((event,session) => {
      window.setTimeout(async () => {
        window.CR7_AUTH?.cacheSession?.(session);
        renderSession(session);
        await syncTwitchPrompt(session,event === 'SIGNED_IN');
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
  twitchConnectButton?.addEventListener('click',linkTwitch);
  twitchLaterButton?.addEventListener('click',() => {
    dismissedTwitchPromptUser = twitchPromptUser;
    rememberTwitchPromptDismissal(twitchPromptUser);
    twitchPromptUser = '';
    if (twitchPrompt) twitchPrompt.hidden = true;
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
