// Adds a one-letter injury badge right after the player name:
//   O = out (red), P = probable (green), D = doubtful (yellow), Q = questionable (blue).
// The base status comes from the injury icon's tooltip, e.g. "Knee - Out Indefinitely - Expected return Nov 6".
// Fantrax reports Questionable / Doubtful / Probable all as "Game-time decision", so only for those flagged
// players the real status is read from the latest news: first from the news icon's tooltip already on the
// page, then (if that is cut off) from the player card (getPlayerProfile), cached and rate-limited.
(() => {
  if (window.__fxInjuryBadge) return;
  window.__fxInjuryBadge = true;

  const ICONS = '.scorer-icon--INJURED, .scorer-icon--INJURED_OUT, .scorer-icon--INJURY_LIST';
  const STATUSES = [
    [/game[-\s]?time/i, 'GTD'],
    [/questionable/i, 'Q'],
    [/doubtful/i, 'D'],
    [/probable/i, 'P'],
    [/day[-\s]?to[-\s]?day/i, 'DTD'],
    [/\bout\b|season[-\s]?ending/i, 'O'],
    [/injured (reserve|list)|\bIL\b/i, 'O'],
  ];
  const ICON_FALLBACK = [
    ['scorer-icon--INJURED_OUT', 'O'],
    ['scorer-icon--INJURY_LIST', 'O'],
  ];
  // Statuses that still need the news to tell Q / D / P apart; Q is the fallback when the news names none.
  const AMBIGUOUS = new Set(['GTD', 'DTD']);
  const NEWS_STATUSES = [
    [/doubtful/i, 'D'],
    [/questionable/i, 'Q'],
    [/probable/i, 'P'],
  ];
  const CACHE_TTL_MS = 10 * 60 * 1000;
  const ERROR_TTL_MS = 2 * 60 * 1000;
  const MAX_CONCURRENT = 2;

  const tooltipText = (icon) => {
    const id = icon.getAttribute('aria-describedby');
    return (id && document.getElementById(id)?.textContent?.trim()) || '';
  };

  // Tooltip format is "<injury> - <status> - Expected return <date>"; match the status part only.
  const statusFor = (text, icon) => {
    const status = text.split(/\s+-\s+/)[1] ?? text;
    return (
      STATUSES.find(([re]) => re.test(status))?.[1] ??
      ICON_FALLBACK.find(([cls]) => icon.classList.contains(cls))?.[1] ??
      null
    );
  };

  // The earliest status word in the headline wins.
  const statusFromNews = (text) => {
    let best = null;
    for (const [re, letter] of NEWS_STATUSES) {
      const at = text.search(re);
      if (at >= 0 && (!best || at < best.at)) best = { at, letter };
    }
    return best?.letter ?? null;
  };

  const playerIdOf = (scorer) => {
    const fig = scorer.querySelector('figure.scorer__image');
    const bg = fig && (fig.style.backgroundImage || getComputedStyle(fig).backgroundImage);
    return bg?.match(/\/hs(\w+?)_/)?.[1] ?? null;
  };

  const profiles = new Map(); // playerId -> { at, ttl, status, news }
  const inflight = new Set(); // playerIds queued or being fetched
  const queue = [];
  let active = 0;

  const leagueId = () => location.pathname.match(/league\/(\w+)/)?.[1];

  const fetchProfile = async (id) => {
    const res = await fetch(`/fxpa/req?leagueId=${leagueId()}`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ msgs: [{ method: 'getPlayerProfile', data: { playerId: id } }], uiv: 3, refUrl: location.href }),
    });
    const news = (await res.json()).responses?.[0]?.data?.sectionContent?.OVERVIEW?.latestNews;
    return { status: news?.text ? statusFromNews(news.text) : null, news: news?.text ?? '' };
  };

  const pump = () => {
    while (active < MAX_CONCURRENT && queue.length) {
      const id = queue.shift();
      active++;
      fetchProfile(id)
        .then((r) => profiles.set(id, { at: Date.now(), ttl: CACHE_TTL_MS, ...r }))
        .catch(() => profiles.set(id, { at: Date.now(), ttl: ERROR_TTL_MS, status: null, news: '' }))
        .finally(() => {
          active--;
          inflight.delete(id);
          pump();
          schedule();
        });
    }
  };

  // { status, news } for a flagged player, or { pending: true } while the player card is being fetched.
  const refine = (scorer) => {
    const newsIcon = scorer.querySelector('[class*="scorer-icon--PLAYER_NEWS"]');
    const tip = newsIcon ? tooltipText(newsIcon) : '';
    const fromTip = tip && statusFromNews(tip);
    if (fromTip) return { status: fromTip, news: tip };

    const id = playerIdOf(scorer);
    if (!id) return { status: null, news: '' };
    const hit = profiles.get(id);
    if (!hit || Date.now() - hit.at >= hit.ttl) {
      if (!inflight.has(id)) {
        inflight.add(id);
        queue.push(id);
        pump();
      }
    }
    return hit ?? { pending: true };
  };

  const sync = () => {
    const wanted = new Map();
    for (const icon of document.querySelectorAll(ICONS)) {
      const scorer = icon.closest('scorer');
      const nameEl = scorer?.querySelector('.scorer__info__name');
      if (!nameEl) continue;
      let text = tooltipText(icon);
      let letter = statusFor(text, icon);
      if (!letter) continue;
      if (AMBIGUOUS.has(letter)) {
        const refined = refine(scorer);
        if (refined.pending) continue;
        letter = refined.status ?? 'Q';
        if (refined.news) text += `\n${refined.news}`;
      }
      wanted.set(nameEl, { letter, text });
    }

    for (const badge of document.querySelectorAll('.fx-inj')) {
      if (!wanted.has(badge.parentElement)) {
        badge.parentElement.classList.remove('fx-name', 'fx-name--end');
        badge.remove();
      }
    }

    for (const [nameEl, { letter, text }] of wanted) {
      let badge = nameEl.querySelector(':scope > .fx-inj');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'fx-inj';
        nameEl.append(badge);
      }
      if (badge.textContent !== letter) badge.textContent = letter;
      if (badge.title !== text) badge.title = text;
      if (badge.dataset.status !== letter) badge.dataset.status = letter;

      // Right-aligned names (away side) keep the badge right after the text, against the avatar.
      const align = getComputedStyle(nameEl).textAlign;
      nameEl.classList.add('fx-name');
      nameEl.classList.toggle('fx-name--end', align === 'right' || align === 'end');
    }
  };

  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      sync();
    });
  }

  new MutationObserver(schedule).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  sync();
})();
