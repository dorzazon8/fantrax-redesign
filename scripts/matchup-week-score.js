// The matchup scores (W - L - T) in the header and the matchup chips always show the whole matchup period.
// In Fantrax's Day view (used by the team tabs) they only count the selected day, so the period score
// comes from a second getLiveScoringStats call (viewType 2 = Period) for the same date and replaces it.
// The same call gives each team's games of the week (played / live / remaining), shared as window.__fxWeekGames
// ({ [teamId]: [played, live, remaining] }) for the games row under the score (see matchup-espn.js).
(() => {
  if (window.__fxWeekScore) return;
  window.__fxWeekScore = true;

  const REFRESH_MS = 30000;
  const HEADERS = 'app-league-livescoring league-livescoring-table-header';
  const CHIPS = 'app-league-livescoring .livescoring-swipe-matchups__item';

  const cache = new Map(); // `${matchupId}|${date}` -> { at, scores: { [teamId]: [w, l, t] }, matchups: ["teamA_teamB", ...] }
  const pending = new Set();

  const leagueId = () => location.pathname.match(/league\/(\w+)/)?.[1];
  const matchupId = () => new URLSearchParams(location.search).get('matchupId');
  const dateParam = () => location.pathname.match(/;date=([\d-]+)/)?.[1] ?? '';
  const teamIdOf = (header) => header.querySelector('a[href*="teamId="]')?.getAttribute('href').match(/teamId=(\w+)/)?.[1];
  const isDayView = () =>
    document.querySelector('app-league-livescoring pill-group[aria-label="Timeframes"] button')?.classList.contains('mat-sport') ?? false;

  const fetchScores = async (id, date) => {
    const data = {
      sppId: '-1',
      mobileMatchupView: true,
      matchupId: id,
      teamId: 'ALL',
      layout: 'DETAILED',
      mainView: 'MATCHUP',
      mobileView: 'MATCHUPS',
      viewType: '2',
      newView: true,
      ...(date && { date }),
    };
    const res = await fetch(`/fxpa/req?leagueId=${leagueId()}`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ msgs: [{ method: 'getLiveScoringStats', data }], uiv: 3, refUrl: location.href }),
    });
    const page = (await res.json()).responses?.[0]?.data;
    const matchups = page?.matchups ?? [];
    const scores = {};
    const games = {};
    for (const matchup of matchups) {
      const key = page.matchupMap?.[matchup];
      for (const teamId of matchup.split('_')) {
        const wlt = page.statsPerTeam?.allTeamsStats?.[teamId]?.ACTIVE?.wltPerMchup?.[key];
        if (wlt) scores[teamId] = wlt;
        const info = page.statsPerTeam?.allTeamsStats?.[teamId]?.ACTIVE?.playerGameInfo;
        if (info) games[teamId] = info.slice(0, 3);
      }
    }
    return { scores, matchups, games };
  };

  const refresh = async (id, date) => {
    const key = `${id}|${date}`;
    const hit = cache.get(key);
    if (pending.has(key) || (hit && Date.now() - hit.at < REFRESH_MS)) return;
    pending.add(key);
    try {
      const result = await fetchScores(id, date);
      cache.set(key, { at: Date.now(), ...result });
      window.__fxWeekGames = { ...window.__fxWeekGames, ...result.games };
      schedule();
    } catch {
      cache.set(key, { at: Date.now(), scores: hit?.scores ?? {}, matchups: hit?.matchups ?? [] });
    } finally {
      pending.delete(key);
    }
  };

  // "<h3> W <span>-</span> L <span>-</span> T </h3>" and the header's h2 both keep W, L, T in three text nodes
  const setScore = (el, wlt) => {
    if (!el || !wlt) return;
    const digits = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE && /\d/.test(n.data));
    if (digits.length !== 3) return;
    digits.forEach((node, i) => {
      const text = ` ${wlt[i]} `;
      if (node.data !== text) node.data = text;
    });
  };

  const sync = () => {
    const id = matchupId();
    if (!id) return;
    const date = dateParam();
    refresh(id, date);
    const hit = cache.get(`${id}|${date}`);
    if (!hit || !isDayView()) return;

    for (const header of document.querySelectorAll(HEADERS)) {
      setScore(header.querySelector('.scoring-header__score-primary h2'), hit.scores[teamIdOf(header)]);
    }

    // Chips follow the order of the response's matchup list ("All" has no score)
    const chips = [...document.querySelectorAll(CHIPS)].filter((chip) => chip.querySelector('h3'));
    chips.forEach((chip, i) => {
      const teams = hit.matchups[i]?.split('_');
      const titles = chip.querySelectorAll('h3');
      if (teams?.length === 2 && titles.length === 2) teams.forEach((teamId, side) => setScore(titles[side], hit.scores[teamId]));
    });
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
