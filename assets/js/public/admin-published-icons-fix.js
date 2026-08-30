(() => {
  const list = document.getElementById('suggestionModerationList');
  if (!list) return;

  const ICONS = {
    player: '<img class="admin-catalog-fact-icon admin-catalog-player-icon" src="./assets/images/figma/cheloveck.png" alt="" aria-hidden="true">',
    day: '<img class="admin-catalog-fact-icon admin-catalog-day-icon" src="./assets/images/figma/calendar.png" alt="" aria-hidden="true">',
    like: '<img class="admin-catalog-reaction-icon" src="./assets/images/figma/like.png" alt="" aria-hidden="true">',
    dislike: '<img class="admin-catalog-reaction-icon" src="./assets/images/figma/dislike.png" alt="" aria-hidden="true">'
  };

  function decorateCard(card) {
    const facts = card.querySelector('.admin-catalog-facts');
    if (!facts || card.dataset.publishedIconsReady === '2') return;

    const playersNode = facts.querySelector('.admin-catalog-players');
    const releaseNode = facts.querySelector('.admin-catalog-release');
    const reactionsNode = facts.querySelector('.admin-catalog-reactions');

    const players = playersNode?.textContent.trim() || '1 игрок';
    const release = releaseNode?.textContent.trim() || 'Без даты';
    const counts = reactionsNode?.textContent.match(/\d+/g) || ['0', '0'];
    const likes = counts[0] || '0';
    const dislikes = counts[1] || '0';

    facts.innerHTML = `
      <span class="admin-catalog-players">
        ${ICONS.player}
        <span>${players}</span>
      </span>
      <span class="admin-catalog-release">
        ${ICONS.day}
        <span>${release}</span>
      </span>
      <span class="admin-catalog-reactions">
        <span>${ICONS.like}<b>${likes}</b></span>
        <span>${ICONS.dislike}<b>${dislikes}</b></span>
      </span>`;

    card.dataset.publishedIconsReady = '2';
  }

  function decorateAll() {
    list.querySelectorAll('.admin-catalog-card').forEach(decorateCard);
  }

  decorateAll();
  new MutationObserver(decorateAll).observe(list, { childList: true, subtree: true });
})();
