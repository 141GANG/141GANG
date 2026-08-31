function modalInteractionError(error) {
  const message = String(error?.message || error || 'Не удалось выполнить действие.');
  if (/auth|jwt|session|авторизац/i.test(message)) return 'Войдите в аккаунт, чтобы оценивать игры и писать комментарии.';
  if (/get_game_interactions|set_game_reaction|add_game_comment|update_game_comment|delete_game_comment|PGRST202|42883|schema cache/i.test(message)) {
    return 'Новая система оценок ещё не подключена к базе. Выполните supabase/game_interactions.sql.';
  }
  return message;
}

function currentModalGame() {
  return state.games.find(item => String(item.id) === String(state.activeGameId));
}

function fitGameModalToViewport() {
  if (!elements.modal) return;
  if (window.matchMedia('(max-width: 720px)').matches) {
    elements.modal.style.removeProperty('--game-modal-scale');
    elements.modal.style.removeProperty('--game-modal-top');
    elements.modal.style.removeProperty('--game-modal-scroll-height');
    return;
  }

  const rootSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 1;
  const frameWidth = 850 * rootSize;
  const frameHeight = 1338 * rootSize;
  const visibleFrameHeight = 970 * rootSize;
  const edgeGap = 40 * rootSize;
  const scale = Math.min(
    1,
    Math.max(0.1, (window.innerWidth - edgeGap) / frameWidth),
    Math.max(0.1, (window.innerHeight - edgeGap) / visibleFrameHeight)
  );
  const top = Math.max(20 * rootSize, Math.min(40 * rootSize, window.innerHeight * 0.05));
  const bottomGap = 20 * rootSize;
  const availableHeight = Math.max(320 * rootSize, window.innerHeight - top - bottomGap);
  const scrollHeight = Math.min(frameHeight, availableHeight / scale);

  elements.modal.style.setProperty('--game-modal-scale', scale.toFixed(5));
  elements.modal.style.setProperty('--game-modal-top', `${top.toFixed(2)}px`);
  elements.modal.style.setProperty('--game-modal-scroll-height', `${scrollHeight.toFixed(2)}px`);
}

let gameModalFitFrame = 0;
window.addEventListener('resize', () => {
  window.cancelAnimationFrame(gameModalFitFrame);
  gameModalFitFrame = window.requestAnimationFrame(fitGameModalToViewport);
});

function renderModalReactionState(gameId) {
  const stats = state.reputationStats?.[String(gameId)] || {};
  const currentVote = Number(state.currentVotes?.[String(gameId)] || 0);
  if (elements.modalLikeCount) elements.modalLikeCount.textContent = String(Number(stats.likes) || 0);
  if (elements.modalDislikeCount) elements.modalDislikeCount.textContent = String(Number(stats.dislikes) || 0);
  elements.modalVoteActions.forEach(button => {
    const active = Number(button.dataset.vote) === currentVote;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function renderModalComments(comments = []) {
  if (!elements.modalCommentsList) return;
  elements.modalCommentsList.innerHTML = comments.length ? comments.map(comment => {
    const username = String(comment.username || 'Пользователь').trim();
    const initial = username.charAt(0).toLocaleUpperCase('ru-RU') || 'U';
    const createdAt = Date.parse(comment.created_at || '');
    const updatedAt = Date.parse(comment.updated_at || '');
    const edited = Number.isFinite(createdAt) && Number.isFinite(updatedAt) && updatedAt > createdAt + 1000;
    const actions = comment.is_mine
      ? `<div class="modal-comment-actions" aria-label="Управление комментарием">
          <button type="button" class="modal-comment-action" data-comment-action="edit">Изменить</button>
          <button type="button" class="modal-comment-action is-danger" data-comment-action="delete">Удалить</button>
        </div>`
      : '';
    return `<article class="modal-comment-item${comment.is_mine ? ' is-own' : ''}" data-comment-id="${escapeHtml(String(comment.id))}">
      <span class="modal-comment-avatar" aria-hidden="true">${escapeHtml(initial)}</span>
      <div class="modal-comment-body">
        <div class="modal-comment-head"><strong>${escapeHtml(username)}</strong>${actions}</div>
        <p data-comment-text>${escapeHtml(comment.body)}</p>
        <div class="modal-comment-meta">
          <time datetime="${escapeHtml(String(comment.created_at || ''))}">${escapeHtml(formatDate(comment.created_at, { short: true }))}</time>
          ${edited ? '<span class="modal-comment-edited">изменено</span>' : ''}
        </div>
      </div>
    </article>`;
  }).join('') : '<p class="modal-comments-empty">Пока нет комментариев. Начните обсуждение.</p>';
}

function cancelModalCommentEdit(article) {
  if (!article) return;
  article.classList.remove('is-editing');
  article.querySelector('[data-comment-text]')?.removeAttribute('hidden');
  article.querySelector('.modal-comment-edit')?.remove();
}

function beginModalCommentEdit(article) {
  if (!article) return;
  const text = article.querySelector('[data-comment-text]');
  if (!text) return;

  elements.modalCommentsList?.querySelectorAll('.modal-comment-item.is-editing').forEach(item => {
    if (item !== article) cancelModalCommentEdit(item);
  });

  const existing = article.querySelector('.modal-comment-edit textarea');
  if (existing) {
    existing.focus();
    return;
  }

  const editor = document.createElement('div');
  editor.className = 'modal-comment-edit';
  editor.innerHTML = `
    <label class="visually-hidden">Изменить комментарий</label>
    <textarea maxlength="500" aria-label="Изменить комментарий"></textarea>
    <div class="modal-comment-edit-actions">
      <button type="button" data-comment-action="save">Сохранить</button>
      <button type="button" data-comment-action="cancel">Отмена</button>
    </div>
  `;

  const textarea = editor.querySelector('textarea');
  textarea.value = text.textContent || '';
  text.hidden = true;
  text.after(editor);
  article.classList.add('is-editing');
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

async function getSignedInUser(client) {
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  const user = data?.session?.user;
  if (!user || user.is_anonymous) throw new Error('Требуется авторизация.');
  return user;
}

async function loadGameInteractions(gameId) {
  const client = getConfiguredClient();
  if (!client) return;
  try {
    const { data: sessionData } = await client.auth.getSession();
    const signedUser = sessionData?.session?.user;
    const signedIn = Boolean(signedUser && !signedUser.is_anonymous);
    if (signedIn && elements.modalCommentComposerAvatar) {
      const metadata = signedUser.user_metadata || {};
      const username = String(metadata.preferred_username || metadata.full_name || metadata.name || signedUser.email || 'Пользователь').trim();
      elements.modalCommentComposerAvatar.textContent = username.charAt(0).toLocaleUpperCase('ru-RU') || 'П';
    }
    elements.modalAuthHint.hidden = signedIn;
    elements.modalCommentForm.hidden = !signedIn;
    elements.modalVoteActions.forEach(button => { button.disabled = !signedIn; });
    const { data, error } = await client.rpc('get_game_interactions', { p_game_id: Number(gameId) });
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const summary = rows[0] || {};
    state.reputationStats[String(gameId)] = {
      likes: Number(summary.like_count) || 0,
      dislikes: Number(summary.dislike_count) || 0,
      total: (Number(summary.like_count) || 0) + (Number(summary.dislike_count) || 0)
    };
    state.reputationScores[String(gameId)] = Number(summary.score) || 0;
    state.currentVotes[String(gameId)] = Number(summary.my_reaction) || 0;
    renderModalReactionState(gameId);
    renderModalComments(rows.filter(row => row.comment_id).map(row => ({
      id: row.comment_id,
      username: row.username,
      body: row.comment_body,
      created_at: row.comment_created_at,
      updated_at: row.comment_updated_at,
      is_mine: row.comment_is_mine === true
    })));
    elements.modalReputationNotice.textContent = '';
  } catch (error) {
    console.warn('Взаимодействия игры:', error?.message || error);
    renderModalReactionState(gameId);
    renderModalComments([]);
    elements.modalReputationNotice.textContent = modalInteractionError(error);
  }
}

function openGameModal(gameId) {
  const game = state.games.find(item => String(item.id) === String(gameId));
  if (!game) return;
  const meta = getReleaseMeta(game);
  const coverUrl = safeExternalUrl(game.cover_url);
  const steamUrl = safeExternalUrl(game.steam_url, ['steampowered.com', 'steamcommunity.com']);
  const playerRange = catalogPlayerRange(game);
  const playersLabel = playerRange.min === playerRange.max
    ? `${playerRange.max} ${playerWord(playerRange.max)}`
    : `${playerRange.min}–${playerRange.max} ${playerWord(playerRange.max)}`;

  state.activeGameId = String(game.id);
  lastFocusedElement = document.activeElement;
  elements.modalMedia.innerHTML = coverUrl
    ? `<img src="${escapeHtml(coverUrl)}" alt="Обложка ${escapeHtml(game.title)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='./assets/images/figma/game-placeholder.svg'">`
    : `<div class="cover-fallback"><img src="${TWITCH_LOGO_DATA}" alt="" aria-hidden="true"></div>`;
  elements.modalBadges.innerHTML = `<span class="coop-badge"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3"></circle><path d="M6 20c0-4 2.4-7 6-7s6 3 6 7"></path></svg>${escapeHtml(playersLabel)}</span><span class="release-badge ${meta.badgeClass}"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="14" rx="2"></rect><path d="M8 3v6M16 3v6M4 10h16"></path></svg>${escapeHtml(catalogReleaseLabel(game, meta))}</span>`;
  elements.modalTitle.textContent = game.title || 'Без названия';
  elements.modalRelease.textContent = `Добавлено: ${formatDate(game.created_at)}`;
  elements.modalDescription.textContent = game.description || 'Описание не указано.';
  elements.modalAdded.textContent = `Добавлено: ${formatDate(game.created_at)}`;
  elements.modalSteam.hidden = !steamUrl;
  if (steamUrl) elements.modalSteam.href = steamUrl;
  elements.modalCommentsList.innerHTML = '<p class="modal-comments-empty">Загружаем комментарии…</p>';
  elements.modalCommentInput.value = '';
  renderModalReactionState(game.id);
  fitGameModalToViewport();
  elements.modal.hidden = false;
  elements.modal.scrollTop = 0;
  const modalPanel = elements.modal.querySelector('.modal-panel');
  if (modalPanel) modalPanel.scrollTop = 0;
  elements.modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => {
    elements.modal.classList.add('is-open');
    elements.modal.querySelector('.modal-panel')?.focus({ preventScroll: true });
  });
  loadGameInteractions(game.id);
}

async function voteForGame(direction) {
  const game = currentModalGame();
  if (!game) return;
  elements.modalVoteActions.forEach(button => { button.disabled = true; });
  try {
    const client = getConfiguredClient();
    if (!client) throw new Error('Supabase не настроен.');
    await getSignedInUser(client);
    const { data, error } = await client.rpc('set_game_reaction', { p_game_id: Number(game.id), p_reaction: Number(direction) });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    state.reputationStats[String(game.id)] = { likes: Number(result.like_count) || 0, dislikes: Number(result.dislike_count) || 0, total: Number(result.like_count || 0) + Number(result.dislike_count || 0) };
    state.reputationScores[String(game.id)] = Number(result.score) || 0;
    state.currentVotes[String(game.id)] = Number(result.current_reaction) || 0;
    renderModalReactionState(game.id);
    render();
    elements.modalReputationNotice.textContent = '';
  } catch (error) {
    elements.modalReputationNotice.textContent = modalInteractionError(error);
  } finally {
    const client = getConfiguredClient();
    const { data } = client ? await client.auth.getSession() : { data: null };
    const enabled = Boolean(data?.session?.user && !data.session.user.is_anonymous);
    elements.modalVoteActions.forEach(button => { button.disabled = !enabled; });
  }
}

elements.modalVoteActions.forEach(button => button.addEventListener('click', () => voteForGame(Number(button.dataset.vote))));

elements.modalCommentForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const game = currentModalGame();
  const body = elements.modalCommentInput.value.trim();
  if (!game || !body) return;
  const button = elements.modalCommentForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const client = getConfiguredClient();
    await getSignedInUser(client);
    const { error } = await client.rpc('add_game_comment', { p_game_id: Number(game.id), p_body: body });
    if (error) throw error;
    elements.modalCommentInput.value = '';
    await loadGameInteractions(game.id);
  } catch (error) {
    elements.modalReputationNotice.textContent = modalInteractionError(error);
  } finally {
    button.disabled = false;
  }
});

elements.modalCommentsList?.addEventListener('click', async event => {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest('[data-comment-action]');
  if (!button) return;

  const article = button.closest('.modal-comment-item[data-comment-id]');
  const action = button.dataset.commentAction;
  if (!article || !action) return;

  if (action === 'edit') {
    beginModalCommentEdit(article);
    return;
  }

  if (action === 'cancel') {
    cancelModalCommentEdit(article);
    return;
  }

  const commentId = article.dataset.commentId;
  const game = currentModalGame();
  if (!commentId || !game) return;

  let nextBody = '';
  if (action === 'save') {
    nextBody = article.querySelector('.modal-comment-edit textarea')?.value.trim() || '';
    if (!nextBody || nextBody.length > 500) {
      elements.modalReputationNotice.textContent = 'Комментарий должен содержать от 1 до 500 символов.';
      return;
    }
  }

  if (action === 'delete' && !window.confirm('Удалить этот комментарий?')) return;

  article.classList.add('is-busy');
  article.querySelectorAll('button').forEach(item => { item.disabled = true; });
  try {
    const client = getConfiguredClient();
    if (!client) throw new Error('Supabase не настроен.');
    await getSignedInUser(client);

    const request = action === 'delete'
      ? client.rpc('delete_game_comment', { p_comment_id: commentId })
      : client.rpc('update_game_comment', { p_comment_id: commentId, p_body: nextBody });
    const { error } = await request;
    if (error) throw error;

    elements.modalReputationNotice.textContent = '';
    await loadGameInteractions(game.id);
  } catch (error) {
    elements.modalReputationNotice.textContent = modalInteractionError(error);
    article.classList.remove('is-busy');
    article.querySelectorAll('button').forEach(item => { item.disabled = false; });
  }
});

function closeGameModal() {
  if (elements.modal.hidden) return;
  elements.modal.classList.remove('is-open');
  elements.modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  state.activeGameId = null;
  window.setTimeout(() => {
    elements.modal.hidden = true;
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') lastFocusedElement.focus();
  }, 300);
}

let revealObserver = null;

function activateDynamicEffects() {
  if (revealObserver) revealObserver.disconnect();
  revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const target = entry.target;
      const delay = target.classList.contains('game-card') ? Math.max(0, Number.parseInt(target.style.getPropertyValue('--delay'), 10) || 0) : 0;
      revealObserver.unobserve(target);
      window.setTimeout(() => target.classList.add('is-visible', 'tilt-ready'), delay);
    });
  }, { threshold: .12, rootMargin: '0px 0px -40px' });
  document.querySelectorAll('.game-card, .reveal').forEach(item => revealObserver.observe(item));
  document.querySelectorAll('.game-card').forEach(card => {
    card.addEventListener('click', event => {
      if (!event.target.closest('[data-card-action], a, button')) openGameModal(card.dataset.gameId);
    });
    card.addEventListener('keydown', event => {
      if (!['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      openGameModal(card.dataset.gameId);
    });
  });
}

function showFatal(title, details) {
  setConnection('error', 'Ошибка подключения');
  elements.subtitle.textContent = 'Каталог недоступен';
  elements.grid.innerHTML = `<div class="message error"><strong>${escapeHtml(title)}</strong>${escapeHtml(details)}</div>`;
}
