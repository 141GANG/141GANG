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

(function setupFigmaAdminCardIcons() {
  const ICONS = {
    player: '<img class="moderation-fact-icon" src="./assets/images/figma/cheloveck.png" alt="" aria-hidden="true">',
    calendar: '<img class="moderation-fact-icon" src="./assets/images/figma/calendar.png" alt="" aria-hidden="true">',
    like: '<img class="moderation-reaction-icon" src="./assets/images/figma/like.png" alt="" aria-hidden="true">',
    dislike: '<img class="moderation-reaction-icon" src="./assets/images/figma/dislike.png" alt="" aria-hidden="true">'
  };

  const style = document.createElement('style');
  style.id = 'figma-admin-card-icons-real-assets';
  style.textContent = `
    .admin-portal .moderation-card-facts {
      display: grid !important;
      gap: 4px !important;
      margin-top: 6px !important;
      color: rgba(240,240,240,.55) !important;
      font-size: 12px !important;
      line-height: 1 !important;
    }

    .admin-portal .moderation-card-facts > span {
      display: flex !important;
      align-items: center !important;
      gap: 10px !important;
    }

    .admin-portal .moderation-card-facts span::before {
      content: none !important;
      display: none !important;
    }

    .admin-portal .moderation-fact-icon {
      width: 18px !important;
      height: auto !important;
      flex: 0 0 18px !important;
      display: block !important;
      object-fit: contain !important;
    }

    .admin-portal .moderation-reactions-figma {
      display: flex !important;
      align-items: center !important;
      gap: 20px !important;
      margin-top: 2px !important;
    }

    .admin-portal .moderation-reactions-figma > span {
      display: inline-flex !important;
      align-items: center !important;
      gap: 8px !important;
      color: rgba(240,240,240,.42) !important;
    }

    .admin-portal .moderation-reaction-icon {
      width: 28px !important;
      height: 28px !important;
      flex: 0 0 28px !important;
      display: block !important;
      object-fit: contain !important;
    }

    .admin-portal .moderation-reactions-figma b {
      color: rgba(240,240,240,.42) !important;
      font-size: 16px !important;
      font-weight: 500 !important;
      line-height: 1 !important;
    }

    .admin-portal .moderation-card-meta {
      display: none !important;
    }
  `;
  document.head.appendChild(style);

  function icon(name, className) {
    return ICONS[name].replace('class="moderation-reaction-icon"', `class="${className}"`);
  }

  function countFromMeta(meta, symbol) {
    const node = [...(meta?.querySelectorAll('span') || [])]
      .find(item => item.textContent.includes(symbol));
    return node?.textContent.match(/\d+/)?.[0] || '0';
  }

  function decorateCard(card) {
    if (!card || card.dataset.figmaRealIcons === '1') return;

    const facts = card.querySelector('.moderation-card-facts');
    if (!facts) return;

    const playerNode = facts.querySelector('.moderation-players');
    const releaseNode = facts.querySelector('.moderation-release');
    const playerText = playerNode?.textContent.trim() || '1 игрок';
    const releaseText = releaseNode?.textContent.trim() || 'Без даты';
    const meta = card.querySelector('.moderation-card-meta');
    const likes = countFromMeta(meta, '👍');
    const dislikes = countFromMeta(meta, '👎');

    card.querySelectorAll('.moderation-reactions-figma').forEach(node => node.remove());

    facts.innerHTML = `
      <span class="moderation-players">
        ${icon('player', 'moderation-fact-icon')}
        <span>${playerText}</span>
      </span>
      <span class="moderation-release">
        ${icon('calendar', 'moderation-fact-icon')}
        <span>${releaseText}</span>
      </span>
      ${likes || dislikes ? `<div class="moderation-reactions-figma">
        ${likes ? `<span><b>${likes}</b></span>` : ''}
        ${dislikes ? `<span><b>${dislikes}</b></span>` : ''}
      </div>` : ''}`;

    card.dataset.figmaRealIcons = '1';
  }

  function decorateAll() {
    document.querySelectorAll('.moderation-card').forEach(decorateCard);
  }

  decorateAll();
  new MutationObserver(decorateAll).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();

(function loadExactMediaProposalWindow() {
  const stylesheetId = 'proposalMediaFigmaExactStylesDirect';
  if (!document.getElementById(stylesheetId)) {
    const stylesheet = document.createElement('link');
    stylesheet.id = stylesheetId;
    stylesheet.rel = 'stylesheet';
    stylesheet.href = './assets/css/public/proposal-media-figma-exact.css?v=20260830-media-static-slot-1';
    document.head.appendChild(stylesheet);
  }

  function markMediaPanel() {
    const mediaPanel = document.getElementById('mediaPanel');
    if (mediaPanel) mediaPanel.classList.add('is-figma-proposal');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', markMediaPanel, { once: true });
  } else {
    markMediaPanel();
  }

  new MutationObserver(markMediaPanel).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
