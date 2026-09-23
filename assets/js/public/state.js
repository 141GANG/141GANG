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
      heroRecentGame: document.getElementById('heroRecentGame'),
      heroRecentLabel: document.getElementById('heroRecentLabel'),
      heroRecentCover: document.getElementById('heroRecentCover'),
      heroRecentTitle: document.getElementById('heroRecentTitle'),
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
      modalCommentsToggle: document.getElementById('modalCommentsToggle'),
      modalCommentsColumn: document.getElementById('modalCommentsColumn'),
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

    const state = { games: [], query: '', filter: 'all', libraryFilters: new Set(), sort: 'release-newest', channel: null, activeGameId: null, modalGameOverride: null, librarySchemaReady: true, tierSchemaReady: true, reputationSchemaReady: true, reputationScores: {}, reputationStats: {}, currentVotes: {} };
    const TWITCH_LOGO_DATA = './assets/images/figma/game-placeholder.svg';
    const EMPTY_AUTHOR_COMMENT = '\u2063';
    let lastFocusedElement = null;

    // PostgREST/Supabase projects commonly cap a single response at 1,000 rows.
    // Read in deterministic pages so the catalog can grow without a UI limit.
    const SUPABASE_ROWS_PAGE_SIZE = 500;
    async function fetchAllSupabaseRows(fetchPage, pageSize = SUPABASE_ROWS_PAGE_SIZE) {
      const rows = [];
      for (let from = 0; ; from += pageSize) {
        const result = await fetchPage(from, from + pageSize - 1);
        if (result?.error) return { data: null, error: result.error };
        const page = Array.isArray(result?.data) ? result.data : [];
        rows.push(...page);
        if (page.length < pageSize) return { data: rows, error: null };
      }
    }
