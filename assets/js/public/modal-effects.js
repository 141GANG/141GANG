function modalInteractionError(error) {
  const message = String(error?.message || error || 'Не удалось выполнить действие.');
  if (/auth|jwt|session|авторизац/i.test(message)) return 'Войдите в аккаунт, чтобы оценивать игры и писать комментарии.';
  if (/get_game_interactions|set_game_reaction|set_game_comment_reaction|add_game_comment|update_game_comment|delete_game_comment|PGRST202|42883|schema cache/i.test(message)) {
    return 'Новая система комментариев ещё не подключена к базе. Выполните supabase/game_comment_reactions.sql.';
  }
  return message;
}

function currentModalGame() {
  return state.games.find(item => String(item.id) === String(state.activeGameId));
}

function fitGameModalToViewport() {
  if (!elements.modal) return;
  elements.modal.style.removeProperty('--game-modal-scale');
  elements.modal.style.removeProperty('--game-modal-top');
  elements.modal.style.removeProperty('--game-modal-scroll-height');
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

let modalCommentsCache = [];
let modalViewerSignedIn = false;
let modalCommentSortMode = 'popular';

function setModalCommentsOpen(open) {
  const nextOpen = Boolean(open);
  elements.modal?.classList.toggle('comments-open', nextOpen);
  elements.modalCommentsToggle?.classList.toggle('is-active', nextOpen);
  elements.modalCommentsToggle?.setAttribute('aria-expanded', String(nextOpen));
  elements.modalCommentsToggle?.setAttribute('aria-label', nextOpen ? 'Скрыть комментарии' : 'Показать комментарии');
  elements.modalCommentsColumn?.setAttribute('aria-hidden', String(!nextOpen));
}

const MODAL_COMMENT_SORT_LABELS = {
  popular: 'По популярности',
  newest: 'Сначала новые',
  oldest: 'Сначала старые'
};

function sortedModalComments(comments) {
  const list = [...comments];
  if (modalCommentSortMode === 'newest') {
    return list.sort((left, right) => new Date(right.created_at || 0) - new Date(left.created_at || 0));
  }
  if (modalCommentSortMode === 'oldest') {
    return list.sort((left, right) => new Date(left.created_at || 0) - new Date(right.created_at || 0));
  }
  return list.sort((left, right) =>
    (Number(right.score) || 0) - (Number(left.score) || 0) ||
    (Number(right.likes) || 0) - (Number(left.likes) || 0) ||
    new Date(right.created_at || 0) - new Date(left.created_at || 0)
  );
}

function renderModalComments(comments = modalCommentsCache) {
  if (!elements.modalCommentsList) return;
  modalCommentsCache = Array.isArray(comments) ? [...comments] : [];
  const sortedComments = sortedModalComments(modalCommentsCache);
  const count = document.getElementById('modalCommentsCount');
  if (count) count.textContent = String(sortedComments.length);
  elements.modalCommentsList.innerHTML = sortedComments.length ? sortedComments.map(comment => {
    const username = String(comment.username || 'Пользователь').trim();
    const initial = username.charAt(0).toLocaleUpperCase('ru-RU') || 'U';
    const actions = comment.is_mine || comment.can_delete
      ? `<div class="modal-comment-actions" aria-label="Управление комментарием">
          ${comment.is_mine ? '<button type="button" class="modal-comment-action" data-comment-action="edit">Изменить</button>' : ''}
          <button type="button" class="modal-comment-action is-danger" data-comment-action="delete">Удалить</button>
        </div>`
      : '';
    const myReaction = Number(comment.my_reaction) || 0;
    const reactionDisabled = modalViewerSignedIn ? '' : ' disabled';
    const edited = comment.updated_at && comment.created_at && new Date(comment.updated_at).getTime() > new Date(comment.created_at).getTime() + 1000
      ? '<span class="modal-comment-edited">изменено</span>'
      : '';
    return `<article class="modal-comment-item${comment.is_mine ? ' is-own' : ''}" data-comment-id="${escapeHtml(String(comment.id))}">
      <span class="modal-comment-avatar" aria-hidden="true">${escapeHtml(initial)}</span>
      <div class="modal-comment-body">
        <div class="modal-comment-head"><strong>${escapeHtml(username)}</strong>${actions}</div>
        <p data-comment-text>${escapeHtml(comment.body)}</p>
        <div class="modal-comment-meta">
          <time datetime="${escapeHtml(String(comment.created_at || ''))}">${escapeHtml(formatDate(comment.created_at, { short: true }))}</time>
          ${edited}
          <div class="modal-comment-reactions" aria-label="Оценка комментария">
            <button aria-label="Нравится" aria-pressed="${myReaction === 1}" class="${myReaction === 1 ? 'is-active' : ''}" data-comment-reaction="1" type="button"${reactionDisabled}><img alt="" aria-hidden="true" src="./assets/images/figma/like.png"><b>${Number(comment.likes) || 0}</b></button>
            <button aria-label="Не нравится" aria-pressed="${myReaction === -1}" class="${myReaction === -1 ? 'is-active' : ''}" data-comment-reaction="-1" type="button"${reactionDisabled}><img alt="" aria-hidden="true" src="./assets/images/figma/dislike.png"><b>${Number(comment.dislikes) || 0}</b></button>
          </div>
        </div>
      </div>
    </article>`;
  }).join('') : '<p class="modal-comments-empty">Пока нет комментариев. Начните обсуждение.</p>';
}

let modalCommentEditId = null;
let modalOwnComment = null;

function resetModalCommentComposer() {
  modalCommentEditId = null;
  if (!elements.modalCommentForm || !elements.modalCommentInput) return;
  elements.modalCommentInput.value = '';
  elements.modalCommentInput.placeholder = 'Написать комментарий';
  elements.modalCommentForm.dataset.commentMode = 'create';
  const submitButton = elements.modalCommentForm.querySelector('button[type="submit"]');
  submitButton?.setAttribute('aria-label', 'Отправить комментарий');
}

function syncModalCommentComposer(signedIn, ownComment = null) {
  modalOwnComment = ownComment || null;
  if (!elements.modalCommentForm) return;

  const editingOwnComment = Boolean(
    signedIn &&
    modalCommentEditId &&
    modalOwnComment &&
    String(modalOwnComment.id) === String(modalCommentEditId)
  );

  elements.modalCommentForm.hidden = !signedIn || Boolean(modalOwnComment && !editingOwnComment);
  if (!editingOwnComment && !modalOwnComment && signedIn) {
    elements.modalCommentForm.dataset.commentMode = 'create';
  }
}

function beginModalCommentEdit(article) {
  if (!article || !elements.modalCommentForm || !elements.modalCommentInput) return;
  const text = article.querySelector('[data-comment-text]');
  const commentId = article.dataset.commentId;
  if (!text || !commentId) return;

  modalCommentEditId = String(commentId);
  elements.modalCommentInput.value = text.textContent || '';
  elements.modalCommentInput.placeholder = 'Изменить комментарий';
  elements.modalCommentForm.dataset.commentMode = 'edit';
  elements.modalCommentForm.hidden = false;

  const submitButton = elements.modalCommentForm.querySelector('button[type="submit"]');
  submitButton?.setAttribute('aria-label', 'Сохранить изменения');

  elements.modalCommentInput.focus();
  elements.modalCommentInput.setSelectionRange(
    elements.modalCommentInput.value.length,
    elements.modalCommentInput.value.length
  );
  elements.modalCommentForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    modalViewerSignedIn = signedIn;
    if (signedIn && elements.modalCommentComposerAvatar) {
      const metadata = signedUser.user_metadata || {};
      const username = String(metadata.preferred_username || metadata.full_name || metadata.name || signedUser.email || 'Пользователь').trim();
      elements.modalCommentComposerAvatar.textContent = username.charAt(0).toLocaleUpperCase('ru-RU') || 'П';
    }
    elements.modalAuthHint.hidden = signedIn;
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
    const comments = rows.filter(row => row.comment_id).map(row => ({
      id: row.comment_id,
      username: row.username,
      body: row.comment_body,
      created_at: row.comment_created_at,
      updated_at: row.comment_updated_at,
      is_mine: row.comment_is_mine === true,
      can_delete: row.comment_can_delete === true,
      likes: Number(row.comment_like_count) || 0,
      dislikes: Number(row.comment_dislike_count) || 0,
      score: Number(row.comment_score) || 0,
      my_reaction: Number(row.comment_my_reaction) || 0
    }));
    const ownComment = comments.find(comment => comment.is_mine) || null;
    renderModalComments(comments);
    syncModalCommentComposer(signedIn, ownComment);
    elements.modalReputationNotice.textContent = '';
  } catch (error) {
    console.warn('Взаимодействия игры:', error?.message || error);
    modalViewerSignedIn = false;
    renderModalReactionState(gameId);
    renderModalComments([]);
    if (elements.modalCommentForm) elements.modalCommentForm.hidden = true;
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
  elements.modalMedia.style.removeProperty('background-image');
  elements.modalBadges.innerHTML = `<span class="coop-badge"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3"></circle><path d="M6 20c0-4 2.4-7 6-7s6 3 6 7"></path></svg>${escapeHtml(playersLabel)}</span><span class="release-badge ${meta.badgeClass}"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="14" rx="2"></rect><path d="M8 3v6M16 3v6M4 10h16"></path></svg>${escapeHtml(catalogReleaseLabel(game, meta))}</span>`;
  elements.modalTitle.textContent = game.title || 'Без названия';
  elements.modalRelease.textContent = `Добавлено: ${formatDate(game.created_at)}`;
  elements.modalDescription.textContent = game.description || 'Описание не указано.';
  elements.modalAdded.textContent = `Добавлено: ${formatDate(game.created_at)}`;
  elements.modalSteam.hidden = !steamUrl;
  if (steamUrl) elements.modalSteam.href = steamUrl;
  modalCommentsCache = [];
  const commentsCount = document.getElementById('modalCommentsCount');
  if (commentsCount) commentsCount.textContent = '0';
  elements.modalCommentsList.innerHTML = '<p class="modal-comments-empty">Загружаем комментарии…</p>';
  resetModalCommentComposer();
  modalOwnComment = null;
  if (elements.modalCommentForm) elements.modalCommentForm.hidden = true;
  setModalCommentsOpen(false);
  renderModalReactionState(game.id);
  fitGameModalToViewport();
  elements.modal.classList.remove('is-closing');
  elements.modal.hidden = false;
  elements.modal.scrollTop = 0;
  const modalPanel = elements.modal.querySelector('.modal-panel');
  if (modalPanel) modalPanel.scrollTop = 0;
  elements.modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  elements.modal.classList.add('is-open');
  requestAnimationFrame(() => {
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

elements.modalCommentsToggle?.addEventListener('click', () => {
  setModalCommentsOpen(!elements.modal.classList.contains('comments-open'));
});

document.getElementById('modalCommentSort')?.addEventListener('click', event => {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest('[data-comment-sort]');
  if (!button) return;
  const nextMode = button.dataset.commentSort;
  if (!MODAL_COMMENT_SORT_LABELS[nextMode]) return;

  modalCommentSortMode = nextMode;
  document.querySelectorAll('[data-comment-sort]').forEach(item => {
    item.classList.toggle('is-active', item === button);
  });
  const label = document.getElementById('modalCommentSortLabel');
  if (label) label.textContent = MODAL_COMMENT_SORT_LABELS[nextMode];
  const details = document.getElementById('modalCommentSort');
  if (details instanceof HTMLDetailsElement) details.open = false;
  renderModalComments();
});

elements.modalCommentForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const game = currentModalGame();
  const body = elements.modalCommentInput.value.trim();
  if (!game || !body) return;

  const editingCommentId = modalCommentEditId;
  const button = elements.modalCommentForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const client = getConfiguredClient();
    if (!client) throw new Error('Supabase не настроен.');
    await getSignedInUser(client);

    const request = editingCommentId
      ? client.rpc('update_game_comment', { p_comment_id: editingCommentId, p_body: body })
      : client.rpc('add_game_comment', { p_game_id: Number(game.id), p_body: body });
    const { error } = await request;
    if (error) throw error;

    resetModalCommentComposer();
    elements.modalReputationNotice.textContent = '';
    await loadGameInteractions(game.id);
  } catch (error) {
    elements.modalReputationNotice.textContent = modalInteractionError(error);
    if (!editingCommentId) await loadGameInteractions(game.id);
  } finally {
    button.disabled = false;
  }
});

elements.modalCommentsList?.addEventListener('click', async event => {
  const target = event.target instanceof Element ? event.target : null;
  const reactionButton = target?.closest('[data-comment-reaction]');
  if (reactionButton) {
    const article = reactionButton.closest('.modal-comment-item[data-comment-id]');
    const game = currentModalGame();
    const commentId = article?.dataset.commentId;
    const direction = Number(reactionButton.dataset.commentReaction);
    if (!article || !game || !commentId || ![-1, 1].includes(direction)) return;

    article.classList.add('is-busy');
    article.querySelectorAll('button').forEach(item => { item.disabled = true; });
    try {
      const client = getConfiguredClient();
      if (!client) throw new Error('Supabase не настроен.');
      await getSignedInUser(client);
      const { error } = await client.rpc('set_game_comment_reaction', {
        p_comment_id: Number(commentId),
        p_reaction: direction
      });
      if (error) throw error;
      elements.modalReputationNotice.textContent = '';
      await loadGameInteractions(game.id);
    } catch (error) {
      elements.modalReputationNotice.textContent = modalInteractionError(error);
      article.classList.remove('is-busy');
      article.querySelectorAll('button').forEach(item => { item.disabled = !modalViewerSignedIn; });
    }
    return;
  }

  const button = target?.closest('[data-comment-action]');
  if (!button) return;

  const article = button.closest('.modal-comment-item[data-comment-id]');
  const action = button.dataset.commentAction;
  if (!article || !action) return;

  if (action === 'edit') {
    beginModalCommentEdit(article);
    return;
  }

  if (action !== 'delete' || !window.confirm('Удалить этот комментарий?')) return;

  const commentId = article.dataset.commentId;
  const game = currentModalGame();
  if (!commentId || !game) return;

  article.classList.add('is-busy');
  article.querySelectorAll('button').forEach(item => { item.disabled = true; });
  try {
    const client = getConfiguredClient();
    if (!client) throw new Error('Supabase не настроен.');
    await getSignedInUser(client);

    const { error } = await client.rpc('delete_game_comment', { p_comment_id: commentId });
    if (error) throw error;

    if (String(modalCommentEditId || '') === String(commentId)) resetModalCommentComposer();
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
  elements.modal.classList.add('is-closing');
  elements.modal.classList.remove('is-open');
  elements.modal.setAttribute('aria-hidden', 'true');
  resetModalCommentComposer();
  modalOwnComment = null;
  modalCommentsCache = [];
  modalViewerSignedIn = false;
  setModalCommentsOpen(false);
  state.activeGameId = null;
  window.setTimeout(() => {
    elements.modal.hidden = true;
    elements.modal.classList.remove('is-closing');
    document.body.classList.remove('modal-open');
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') lastFocusedElement.focus();
  }, 150);
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
