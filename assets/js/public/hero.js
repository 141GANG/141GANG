function setConnection(status, text) {
      elements.statusDot.className = `status-dot ${status}`.trim();
      elements.statusText.textContent = text;
    }

    function setQuickGame(button, game, kicker, metaText, emptyTitle, emptyMeta) {
      if (!button) return;
      if (!game) {
        button.disabled = true;
        button.removeAttribute('data-game-id');
        button.innerHTML = `
          <span class="quick-cover"><img src="./assets/images/figma/game-placeholder.svg" alt="" aria-hidden="true"></span>
          <span class="quick-copy">
            <span class="quick-kicker">${escapeHtml(kicker)}</span>
            <span class="quick-title">${escapeHtml(emptyTitle)}</span>
            <span class="quick-meta">${escapeHtml(emptyMeta)}</span>
          </span>
          <span class="quick-arrow" aria-hidden="true">—</span>`;
        return;
      }

      const coverUrl = safeExternalUrl(game.cover_url);
      const cover = coverUrl
        ? `<span class="quick-cover"><img src="${escapeHtml(coverUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='./assets/images/figma/game-placeholder.svg'"></span>`
        : '<span class="quick-cover"><img src="./assets/images/figma/game-placeholder.svg" alt="" aria-hidden="true"></span>';

      button.disabled = false;
      button.dataset.gameId = String(game.id);
      button.setAttribute('aria-label', `Открыть игру ${game.title}`);
      button.innerHTML = `
        ${cover}
        <span class="quick-copy">
          <span class="quick-kicker">${escapeHtml(kicker)}</span>
          <span class="quick-title">${escapeHtml(game.title)}</span>
          <span class="quick-meta">${escapeHtml(metaText)}</span>
        </span>
        <span class="quick-arrow" aria-hidden="true">→</span>`;
    }

    function renderQuickGames(latestReleased, nearest) {
      const latestMeta = latestReleased ? getReleaseMeta(latestReleased) : null;
      setQuickGame(
        elements.quickLatest,
        latestReleased,
        'ПОСЛЕДНИЙ РЕЛИЗ',
        latestMeta ? `Вышла ${latestMeta.line}` : '',
        'Вышедших игр пока нет',
        'Здесь появится последний состоявшийся релиз'
      );

      const nearestMeta = nearest ? getReleaseMeta(nearest) : null;
      setQuickGame(
        elements.quickNearest,
        nearest,
        'БЛИЖАЙШИЙ РЕЛИЗ',
        nearestMeta ? `${nearestMeta.countdown} · ${nearestMeta.line}` : '',
        'Будущих релизов нет',
        'Новая дата появится после синхронизации Steam'
      );

    }

    function renderHero(sortedGames) {
      const upcoming = sortedGames.filter(game => {
        const meta = getReleaseMeta(game);
        const days = daysUntil(game.release_date);
        return meta.group === 'upcoming' && days !== null && days >= 0;
      }).sort((a,b) => getReleaseMeta(a).timestamp - getReleaseMeta(b).timestamp);
      const nearest = upcoming[0] || null;
      const newest = [...state.games].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0] || null;
      const latestReleased = [...state.games]
        .filter(game => getReleaseMeta(game).group === 'released' && game.release_date)
        .sort((a, b) => new Date(b.release_date) - new Date(a.release_date))[0] || null;
      const featured = nearest || newest;

      renderQuickGames(latestReleased, nearest);
      elements.totalCount.textContent = String(state.games.length);
      elements.upcomingCount.textContent = String(upcoming.length);
      elements.nearestDate.textContent = nearest ? formatDate(nearest.release_date, { short: true }) : '—';

      if (!featured) {
        elements.nextRelease.style.removeProperty('--next-cover');
        elements.nextRelease.removeAttribute('data-game-id');
        elements.nextRelease.setAttribute('aria-disabled', 'true');
        elements.nextRelease.tabIndex = -1;
        elements.nextLabel.textContent = 'КАТАЛОГ';
        elements.nextTitle.textContent = 'Каталог пока пуст';
        elements.nextDateText.textContent = 'Добавь первую игру через админ-панель.';
        elements.nextCountdown.textContent = 'Нет игр';
        elements.nextCoop.hidden = true;
        return;
      }

      const cover = safeExternalUrl(featured.cover_url);
      if (cover) elements.nextRelease.style.setProperty('--next-cover', `url("${cover.replace(/"/g, '%22')}")`);
      else elements.nextRelease.style.removeProperty('--next-cover');
      elements.nextRelease.dataset.gameId = String(featured.id);
      elements.nextRelease.removeAttribute('aria-disabled');
      elements.nextRelease.tabIndex = 0;

      const meta = getReleaseMeta(featured);
      elements.nextLabel.textContent = nearest ? 'БЛИЖАЙШИЙ РЕЛИЗ' : 'НОВАЯ В ПРЕДЛОЖКЕ';
      elements.nextTitle.textContent = featured.title;
      elements.nextDateText.textContent = nearest
        ? `Запланированная дата: ${meta.line}`
        : meta.group === 'released'
          ? `Уже доступна · ${meta.line}`
          : meta.line;
      elements.nextCountdown.textContent = nearest ? meta.countdown : (meta.group === 'released' ? 'Можно играть' : 'Дата уточняется');
      const nextCoopLabel = coopLabel(featured);
      elements.nextCoop.hidden = !nextCoopLabel;
      elements.nextCoop.textContent = nextCoopLabel ? `👥 ${nextCoopLabel}` : '';
    }

    const groupInfo = {
      upcoming: {
        kicker: 'В ПЕРВОЙ ЛИНИИ',
        title: 'Ближайшие релизы',
        description: 'Игры, которые ещё готовятся к выходу. Чем ближе дата, тем выше карточка.'
      },
      released: {
        kicker: 'УЖЕ ДОСТУПНЫ',
        title: 'Уже можно играть',
        description: 'Релизы, которые уже появились в Steam и готовы для будущего стрима.'
      },
      unknown: {
        kicker: 'ЖДЁМ АНОНС',
        title: 'Дата пока неизвестна',
        description: 'Steam ещё не указал точный день выхода или дата находится на уточнении.'
      }
    };
