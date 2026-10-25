// Raw vs effective games per team, shared as window.__fxGames ({ [teamId]: { played, left, leftEff } }).
// A lineup has only so many active slots: with 12 players on court on one day, only the slots' worth of them score.
//   played  = player-games of the whole roster (active + bench) so far this week; Fantrax's own count is what scored
//   left    = player-games still to come for the whole roster
//   leftEff = the most of those that fit the active slots by position (maximum bipartite matching)
// Today, players whose game already started keep their slot; only the other slots can still be filled by players
// whose game has not started yet. Future days assume the lineup gets set optimally.
// Rosters (slots, eligibility, who has a game) come from getTeamRosterInfo for each remaining day.
(() => {
  if (window.__fxEffGames) return;
  window.__fxEffGames = true;
  window.__fxGames = {};

  const REFRESH_MS = 60000;
  const DAY_MS = 86400000;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const cache = new Map(); // matchupId -> { at, games: { [teamId]: { played, left, leftEff } } }
  const pending = new Set();
  let base = null; // UTC midnight of roster day 1

  const leagueId = () => location.pathname.match(/league\/(\w+)/)?.[1];
  const matchupId = () => new URLSearchParams(location.search).get('matchupId');
  const isoDay = (t) => new Date(t).toISOString().slice(0, 10);

  const call = async (msgs) => {
    const res = await fetch(`/fxpa/req?leagueId=${leagueId()}`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ msgs, uiv: 3, refUrl: location.href }),
    });
    return (await res.json()).responses?.map((r) => r?.data) ?? [];
  };

  const roster = (teamId, extra) => ({ method: 'getTeamRosterInfo', data: { leagueId: leagueId(), scoringCategoryType: '1', teamId, ...extra } });

  const stats = (id, extra) => ({
    method: 'getLiveScoringStats',
    data: { mobileMatchupView: true, matchupId: id, teamId: 'ALL', layout: 'DETAILED', mainView: 'MATCHUP', mobileView: 'MATCHUPS', newView: true, ...extra },
  });

  const periodBounds = (text) => {
    const m = text?.match(/(\w{3})\s+(\d{1,2}),\s*(\d{4})\s*-\s*(\w{3})\s+(\d{1,2}),\s*(\d{4})/);
    return m ? [Date.UTC(+m[3], MONTHS.indexOf(m[1]), +m[2]), Date.UTC(+m[6], MONTHS.indexOf(m[4]), +m[5])] : null;
  };

  // Largest number of players that can be placed in distinct slots they are eligible for
  const matching = (players, slots) => {
    const owner = new Array(slots.length).fill(-1);
    const place = (p, seen) => {
      for (let s = 0; s < slots.length; s++) {
        if (seen[s] || !players[p].has(slots[s])) continue;
        seen[s] = true;
        if (owner[s] < 0 || place(owner[s], seen)) {
          owner[s] = p;
          return true;
        }
      }
      return false;
    };
    let n = 0;
    for (let p = 0; p < players.length; p++) if (place(p, new Array(slots.length).fill(false))) n++;
    return n;
  };

  // started: Set of scorer ids whose game is live or over (today only); null on other days
  const effective = (data, started) => {
    const rows = data?.tables?.[0]?.rows ?? [];
    const header = data?.tables?.[0]?.header?.cells ?? [];
    const slots = [];
    const players = [];
    for (const row of rows) {
      if (row.statusId === '1') {
        const id = row.scorer?.scorerId;
        if (!started || !id || !started.has(id)) slots.push(row.posId);
      }
      const id = row.scorer?.scorerId;
      if (!id || (row.statusId !== '1' && row.statusId !== '2') || (started && started.has(id))) continue;
      const offset = header.length - row.cells.length;
      if (String(row.cells[-offset]?.content ?? '').trim() === '') continue;
      players.push(new Set(row.eligiblePosIds ?? []));
    }
    return { eff: matching(players, slots), raw: players.length };
  };

  // Roster players (not IR) who played on a day: GP > 0 in that day's stats
  const playedCount = (data) => {
    const header = data?.tables?.[0]?.header?.cells ?? [];
    const gp = header.findIndex((c) => c.shortName === 'GP');
    return (data?.tables?.[0]?.rows ?? []).filter(
      (r) => r.scorer?.scorerId && (r.statusId === '1' || r.statusId === '2') && Number(r.cells[gp - (header.length - r.cells.length)]?.content) > 0,
    ).length;
  };

  const compute = async (id) => {
    const teamIds = id.split('_');
    const [period] = await call([stats(id, { sppId: '-1', viewType: '2' })]);
    const bounds = periodBounds(period?.displayPeriod);
    if (!bounds) return null;
    if (base == null) {
      const [first] = await call([roster(teamIds[0], { period: '1' })]);
      const start = first?.displayedSelections?.displayedStartDate;
      if (!start) return null;
      const d = new Date(start);
      base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }
    const [current] = await call([roster(teamIds[0], {})]);
    const today = Number(current?.displayedSelections?.displayedPeriod);
    const dayOf = (t) => Math.round((t - base) / DAY_MS) + 1;
    const days = [];
    for (let n = Math.max(today, dayOf(bounds[0])); n <= dayOf(bounds[1]); n++) days.push(n);

    const games = {};
    teamIds.forEach((t) => (games[t] = { played: 0, left: 0, leftEff: 0 }));
    const past = [];
    for (let n = dayOf(bounds[0]); n <= Math.min(today, dayOf(bounds[1])); n++) past.push(n);
    const msgs = [];
    if (days.length) msgs.push(stats(id, { sppId: '0', viewType: '1', date: isoDay(base + (days[0] - 1) * DAY_MS) }));
    for (const n of days) for (const t of teamIds) msgs.push(roster(t, { period: String(n) }));
    for (const n of past) for (const t of teamIds) msgs.push(roster(t, { period: String(n), timeframeTypeCode: 'BY_PERIOD' }));
    if (!msgs.length) return { at: Date.now(), games };
    const res = await call(msgs);
    const live = days.length ? res.shift() : null;
    const upcoming = res.splice(0, days.length * teamIds.length);
    days.forEach((n, i) => {
      teamIds.forEach((t, j) => {
        let started = null;
        if (n === days[0] && n === today) {
          started = new Set();
          const map = live?.statsPerTeam?.allTeamsStats?.[t]?.ACTIVE?.gameStatusMap ?? {};
          for (const [pid, status] of Object.entries(map)) if (status.split('|')[2] !== '1') started.add(pid);
        }
        const { eff, raw } = effective(upcoming[i * teamIds.length + j], started);
        games[t].leftEff += eff;
        games[t].left += raw;
      });
    });
    past.forEach((n, i) => teamIds.forEach((t, j) => (games[t].played += playedCount(res[i * teamIds.length + j]))));
    return { at: Date.now(), games };
  };

  const refresh = async (id) => {
    const hit = cache.get(id);
    if (pending.has(id) || (hit && Date.now() - hit.at < REFRESH_MS)) return;
    pending.add(id);
    try {
      const result = await compute(id);
      cache.set(id, result ?? { at: Date.now(), games: hit?.games ?? {} });
    } catch {
      cache.set(id, { at: Date.now(), games: hit?.games ?? {} });
    } finally {
      pending.delete(id);
      const entry = cache.get(id);
      if (entry) window.__fxGames = { ...window.__fxGames, ...entry.games };
      window.__fxEffSettled = id;
    }
  };

  const tick = () => {
    const id = matchupId();
    if (id && document.querySelector('app-league-livescoring') && !document.hidden) refresh(id);
  };
  setInterval(tick, 2000);
  tick();
})();
