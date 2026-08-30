'use strict';

    const elements = {
      grid: document.getElementById('gameGrid'),
      search: document.getElementById('searchInput'),
      sort: document.getElementById('publicCatalogSort'),
      subtitle: document.getElementById('catalogSubtitle'),
      statusDot: document.getElementById('statusDot'),
      statusText: document.getElementById('statusText'),
      totalCount: document.getElementById('totalCount'),
      upcomingCount: document.getElementById('upcomingCount'),
      nearestDate: document.getElementById('nearestDate'),
      nextRelease: document.getElementById('nextRelease'),
      nextLabel: document.getElementById('nextLabel'),
      nextTitle: document.getElementById('nextTitle'),
      nextDateText: document.getElementById('nextDateText'),
      nextCountdown: document.getElementById('nextCountdown'),
      nextCoop: document.getElementById('nextCoop'),
      heroHighlights: document.getElementById('heroHighlights'),
      quickLatest: document.getElementById('quickLatest'),
      quickNearest: document.getElementById('quickNearest'),
      modal: document.getElementById('gameModal'),
      modalClose: document.getElementById('modalClose'),
      modalMedia: document.getElementById('modalMedia'),
      modalBadges: document.getElementById('modalBadges'),
      modalTitle: document.getElementById('modalTitle'),
      modalRelease: document.getElementById('modalRelease'),
      modalLibraryNotice: document.getElementById('modalLibraryNotice'),
      modalLibraryActions: [...document.querySelectorAll('[data-library-action]')],
      modalReputationScore: document.getElementById('modalReputationScore'),
      modalReputationNotice: document.getElementById('modalReputationNotice'),
      modalVoteActions: [...document.querySelectorAll('[data-vote]')],
      modalLikeCount: document.getElementById('modalLikeCount'),
      modalDislikeCount: document.getElementById('modalDislikeCount'),
      modalCommentsList: document.getElementById('modalCommentsList'),
      modalCommentForm: document.getElementById('modalCommentForm'),
      modalCommentInput: document.getElementById('modalCommentInput'),
      modalCommentComposerAvatar: document.getElementById('modalCommentComposerAvatar'),
      modalAuthHint: document.getElementById('modalAuthHint'),
      modalDescription: document.getElementById('modalDescription'),
      modalCommentSection: document.getElementById('modalCommentSection'),
      modalComment: document.getElementById('modalComment'),
      modalAdded: document.getElementById('modalAdded'),
      modalSteam: document.getElementById('modalSteam'),
      filters: [...document.querySelectorAll('.release-filters [data-filter]')],
      libraryFilters: [...document.querySelectorAll('[data-library-filter]')],
      libraryFiltersReset: document.getElementById('libraryFiltersReset')
    };

    const state = { games: [], query: '', filter: 'all', libraryFilters: new Set(), sort: 'release-newest', channel: null, activeGameId: null, librarySchemaReady: true, tierSchemaReady: true, reputationSchemaReady: true, reputationScores: {}, reputationStats: {}, currentVotes: {} };
    const TWITCH_LOGO_DATA = './assets/images/figma/game-placeholder.svg';
    const EMPTY_AUTHOR_COMMENT = '\u2063';
    let lastFocusedElement = null;
