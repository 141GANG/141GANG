function catalogReleaseLabel(game, meta) {
      if (meta.group === 'released') return 'Вышла';
      if (meta.group === 'upcoming' && game.release_date && hasExactReleaseDay(game)) {
        const date = parseDate(game.release_date);
        if (date) {
          return new Intl.DateTimeFormat('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
          }).format(date);
        }
      }
      return 'Неизвестно';
    }

    function libraryStamp(status) {
      const labels = {
        completed: 'Пройдено',
        dropped: 'Дропнуто',
        ignored: 'Неинтересно'
      };
      return labels[status] || '';
    }

    function updateCatalogCounts() {
      const catalogGames = state.games;
      const counts = {
        all: catalogGames.length,
        upcoming: catalogGames.filter(game => getReleaseMeta(game).group === 'upcoming').length,
        released: catalogGames.filter(game => getReleaseMeta(game).group === 'released').length,
        unknown: catalogGames.filter(game => getReleaseMeta(game).group === 'unknown').length
      };
      document.querySelectorAll('[data-filter-count]').forEach(element => {
        element.textContent = String(counts[element.dataset.filterCount] || 0);
      });
    }

    function buildCard(game, index) {
      const coverUrl = safeExternalUrl(game.cover_url);
      const cover = coverUrl
        ? `<img src="${escapeHtml(coverUrl)}" alt="Обложка ${escapeHtml(game.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='./assets/images/figma/game-placeholder.svg'">`
        : `<div class="cover-fallback"><img src="${TWITCH_LOGO_DATA}" alt="" aria-hidden="true"></div>`;
      const meta = getReleaseMeta(game);
      const favorite = Boolean(game.is_favorite);
      const libraryStatus = String(game.library_status || '');
      const reputation = Number(state.reputationScores?.[String(game.id)] || 0);
      const stamp = libraryStamp(libraryStatus);
      const players = Number(game.coop_max_players) || (game.is_coop ? 2 : 1);
      const playersLabel = game.is_coop
        ? `${Number(game.coop_min_players) || 2}–${players} ${playerWord(players)}`
        : '1 игрок';

      return `
        <article class="game-card${favorite ? ' is-favorite' : ''}${libraryStatus ? ` is-${escapeHtml(libraryStatus)}` : ''}" data-game-id="${escapeHtml(game.id)}" tabindex="0" role="button" aria-label="Открыть подробности игры ${escapeHtml(game.title)}" style="--delay:${Math.min(index * 45, 260)}ms">
          <div class="card-visual">${cover}</div>
          <div class="card-shade" aria-hidden="true"></div>
          <span class="card-index" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
          <span class="game-reputation visually-hidden" aria-label="Голосов за игру: ${reputation}">${reputation}</span>
          <div class="card-top">
            <span class="coop-badge"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3"></circle><path d="M6 20c0-4 2.4-7 6-7s6 3 6 7"></path></svg>${escapeHtml(playersLabel)}</span>
            <span class="release-badge ${meta.badgeClass}"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="14" rx="2"></rect><path d="M8 3v6M16 3v6M4 10h16"></path></svg>${escapeHtml(catalogReleaseLabel(game, meta))}</span>
          </div>
          <div class="card-bottom">
            <h3 class="card-title">${escapeHtml(game.title)}</h3>
            <span class="card-open-hint">Подробнее</span>
          </div>
          ${favorite ? '<span class="card-favorite" aria-label="Избранная игра">★</span>' : ''}
          ${stamp ? `<span class="library-stamp ${escapeHtml(libraryStatus)}">${escapeHtml(stamp)}</span>` : ''}
        </article>`;
    }

    function render() {
      const sorted = sortGames(state.games);
      renderHero(sorted);
      updateCatalogCounts();

      const query = state.query.trim().toLocaleLowerCase('ru');
      const games = sorted.filter(game => {
        const meta = getReleaseMeta(game);
        const libraryStatus = String(game.library_status || '');
        const releaseMatches = state.filter === 'all' || meta.group === state.filter;
        if (!releaseMatches) return false;
        const selected = state.libraryFilters || new Set();
        const progressFilters = ['completed', 'dropped', 'ignored'].filter(value => selected.has(value));
        if (selected.has('favorite') && !game.is_favorite) return false;
        if (progressFilters.length && !progressFilters.includes(libraryStatus)) return false;
        if (!query) return true;
        return [game.title, game.description, game.author_comment, game.release_date_text, coopLabel(game)]
          .some(value => String(value || '').toLocaleLowerCase('ru').includes(query));
      });

      elements.subtitle.textContent = state.games.length
        ? query || state.filter !== 'all' || state.libraryFilters?.size
          ? `${games.length} найдено из ${state.games.length}`
          : `${games.length} ${games.length === 1 ? 'игра' : games.length < 5 ? 'игры' : 'игр'} в основном каталоге${state.games.length > games.length ? ` · ${state.games.length - games.length} в библиотеке` : ''}`
        : 'Каталог пока пуст';

      if (!games.length) {
        elements.grid.innerHTML = query || state.filter !== 'all' || state.libraryFilters?.size
          ? '<div class="message"><strong>Ничего не найдено</strong>Измени запрос или выбери другой фильтр.</div>'
          : '<div class="message"><strong>Пока нет опубликованных игр</strong>Первая карточка появится после публикации из админ-панели.</div>';
        return;
      }

      elements.grid.innerHTML = `<div class="section-grid">${games.map((game, index) => buildCard(game, index)).join('')}</div>`;
      activateDynamicEffects();
    }
