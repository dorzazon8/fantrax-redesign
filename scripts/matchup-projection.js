// Summary tab with the Projected toggle on: Fantrax's own projection ignores what already happened, so it is replaced by
//   projected = stats so far + each remaining game x the player's per-game average.
// Remaining games come from the day view (who plays on each remaining day, and whether that game is upcoming, live or final);
// the per-game averages come from the roster API's year-to-date stats, which include FGM/FGA/FTM/FTA, so FG% and
// FT% are aggregated from made / attempted. A player's average is last season's until he has played MIN_GAMES games this
// season. The stats so far, with made / attempted, come from shooting-splits.js.
// A live game counts half (the clock is not in the data).
(() => {
  if (window.__fxProjection) return;
  window.__fxProjection = true;

  const REFRESH_MS = 30000;
  const LIVE_LEFT = 0.5;
  const MIN_GAMES = 10;
  const AVERAGES_REFRESH_MS = 600000;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAY_MS = 86400000;
  const LOWER_WINS = new Set(['TO']);
  const COUNTING = ['3PTM', 'REB', 'AST', 'ST', 'BLK', 'TO', 'PTS'];
  const SPLITS = { 'FG%': ['FGM', 'FGA'], 'FT%': ['FTM', 'FTA'] };

  const cache = new Map(); // `${matchupId}|${date}` -> { at, byTeam: { [teamId]: { actual: { [name]: n }, rem: { [name]: n } } } }
  const pending = new Set();

  const leagueId = () => location.pathname.match(/league\/(\w+)/)?.[1];
  const dateParam = () => location.pathname.match(/;date=([\d-]+)/)?.[1] ?? '';
  const isoDay = (t) => new Date(t).toISOString().slice(0, 10);

  const call = async (msgs) => {
    const res = await fetch(`/fxpa/req?leagueId=${leagueId()}`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ msgs, uiv: 3, refUrl: location.href }),
    });
    return (await res.json()).responses?.map((r) => r?.data) ?? [];
  };

  const stats = (matchupId, extra) => ({
    method: 'getLiveScoringStats',
    data: { mobileMatchupView: true, matchupId, teamId: 'ALL', layout: 'DETAILED', mainView: 'MATCHUP', mobileView: 'MATCHUPS', newView: true, ...extra },
  });

  // "(Oct 20, 2026 - Oct 25, 2026)" -> UTC midnights of the first and last day
  const periodBounds = (text) => {
    const m = text?.match(/(\w{3})\s+(\d{1,2}),\s*(\d{4})\s*-\s*(\w{3})\s+(\d{1,2}),\s*(\d{4})/);
    if (!m) return null;
    return [Date.UTC(+m[3], MONTHS.indexOf(m[1]), +m[2]), Date.UTC(+m[6], MONTHS.indexOf(m[4]), +m[5])];
  };

  const factorOf = (status) => (status === '3' ? 0 : status === '2' ? LIVE_LEFT : 1);

  // Per-game line of every player of a team: { [scorerId]: { GP, FGM, FGA, ..., PTS } }
  const rosterLines = (data) => {
    const table = data?.tables?.[0];
    const out = {};
    if (!table) return out;
    const header = table.header.cells;
    for (const row of table.rows) {
      if (!row.scorer?.scorerId) continue;
      const offset = header.length - row.cells.length;
      const line = {};
      header.forEach((c, i) => {
        const v = parseFloat(String(row.cells[i - offset]?.content ?? '').replace(/,/g, ''));
        line[c.shortName] = Number.isFinite(v) ? v : 0;
      });
      out[row.scorer.scorerId] = line;
    }
    return out;
  };

  // A player's projection line: this season once he has MIN_GAMES games, otherwise last season (this season if he has none)
  const averagesCache = new Map(); // teamId -> { at, lines }
  const seasonAverages = async (teamId) => {
    const hit = averagesCache.get(teamId);
    if (hit && Date.now() - hit.at < AVERAGES_REFRESH_MS) return hit.lines;
    const lines = await loadAverages(teamId);
    averagesCache.set(teamId, { at: Date.now(), lines });
    return lines;
  };
  const loadAverages = async (teamId) => {
    const roster = (extra) => call([{ method: 'getTeamRosterInfo', data: { leagueId: leagueId(), scoringCategoryType: '1', teamId, ...extra } }]);
    const [current] = await roster({});
    const lists = current?.displayedLists?.seasonOrProjections ?? current?.seasonOrProjections ?? [];
    const previous = lists.filter((s) => s.timeframeTypeCode === 'YEAR_TO_DATE' && /Reg Season/.test(s.name))[1];
    const now = rosterLines(current);
    if (!previous) return now;
    const [last] = await roster({ timeframeTypeCode: previous.timeframeTypeCode, seasonOrProjection: previous.code });
    const before = rosterLines(last);
    const out = {};
    for (const [pid, line] of Object.entries(now)) out[pid] = line.GP >= MIN_GAMES || !(before[pid]?.GP > 0) ? line : before[pid];
    return out;
  };

  const compute = async (matchupId, date) => {
    const teamIds = matchupId.split('_');
    const [actual] = await call([stats(matchupId, { sppId: '-1', viewType: '2', ...(date && { date }) })]);
    const bounds = periodBounds(actual?.displayPeriod);
    if (!actual || !bounds) return null;
    const names = {}; // category id -> shortName
    for (const c of actual.scoringCategoriesPerGroup?.['3010'] ?? []) names[c.id.split('#')[1]] = c.shortName;

    // The previous day is included too: its games are final, so they add nothing
    const first = Math.max(bounds[0], Date.now() - DAY_MS * 1.5);
    const days = [];
    for (let t = Math.floor(first / DAY_MS) * DAY_MS; t <= bounds[1]; t += DAY_MS) if (t >= bounds[0]) days.push(isoDay(t));
    const [dayData, averages] = await Promise.all([
      days.length ? call(days.map((d) => stats(matchupId, { sppId: '0', viewType: '1', date: d }))) : [],
      Promise.all(teamIds.map(seasonAverages)),
    ]);

    const byTeam = {};
    teamIds.forEach((teamId, i) => {
      const act = {};
      for (const c of actual.statsPerTeam?.allTeamsStats?.[teamId]?.ACTIVE?.statsMap?._3010?.object2 ?? []) act[names[c.scipId.split('#')[1]]] = c.av ?? 0;
      const rem = {};
      for (const day of dayData) {
        const active = day?.statsPerTeam?.allTeamsStats?.[teamId]?.ACTIVE;
        for (const pid of Object.keys(active?.statsMap ?? {})) {
          if (pid.startsWith('_')) continue;
          const f = factorOf(active.gameStatusMap?.[pid]?.split('|')[2]);
          const line = averages[i][pid];
          if (!f || !line) continue;
          for (const k of [...COUNTING, 'FGM', 'FGA', 'FTM', 'FTA']) rem[k] = (rem[k] ?? 0) + (line[k] ?? 0) * f;
        }
      }
      byTeam[teamId] = { actual: act, rem };
    });
    return { at: Date.now(), byTeam };
  };

  const refresh = async (matchupId, date) => {
    const key = `${matchupId}|${date}`;
    const hit = cache.get(key);
    if (pending.has(key) || (hit && Date.now() - hit.at < REFRESH_MS)) return;
    pending.add(key);
    try {
      cache.set(key, (await compute(matchupId, date)) ?? { at: Date.now(), byTeam: hit?.byTeam ?? {} });
      schedule();
    } catch {
      cache.set(key, { at: Date.now(), byTeam: hit?.byTeam ?? {} });
    } finally {
      pending.delete(key);
    }
  };

  window.__fxProjectionWarm = (matchupId) => refresh(matchupId, '');

  // The projected value of a category, plus its made / attempted for the shooting percentages (null until known)
  const projected = (team, teamId, name) => {
    const split = SPLITS[name];
    if (!split) return { value: (team.actual[name] ?? 0) + (team.rem[name] ?? 0) };
    const now = window.__fxSplits?.(teamId);
    if (!now) return null;
    const made = now[split[0]] + (team.rem[split[0]] ?? 0);
    const att = now[split[1]] + (team.rem[split[1]] ?? 0);
    return { value: att > 0 ? made / att : 0, made, att };
  };

  const format = (name, v) => (name.endsWith('%') ? v.toFixed(3).replace(/^0/, '') : String(Math.round(v)));

  const setText = (cell, text) => {
    const node = [...cell.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
    if (node) {
      if (node.data !== text) node.data = text;
    } else if (cell.textContent !== text) {
      cell.prepend(text);
    }
  };

  // data-fx-proj keeps shooting-splits.js from replacing the made / attempted of a projected cell
  const setSplit = (cell, p) => {
    cell.setAttribute('data-fx-proj', '');
    if (p.att === undefined) return;
    const text = `${Math.round(p.made)}/${Math.round(p.att)}`;
    if (cell.getAttribute('data-fx-ma') !== text) cell.setAttribute('data-fx-ma', text);
  };

  const projectedOn = () =>
    document.querySelector('app-league-livescoring pill-group[aria-label="Projected"] button')?.getAttribute('aria-checked') === 'true';

  const sync = () => {
    const table = document.querySelector('app-league-livescoring league-livescoring-summary-table');
    const matchupId = new URLSearchParams(location.search).get('matchupId');
    if (!table || !matchupId) return;
    // Fetched ahead, so switching Projected on shows the numbers at once
    refresh(matchupId, dateParam());
    if (!projectedOn()) {
      for (const cell of table.querySelectorAll('[data-fx-proj]')) cell.removeAttribute('data-fx-proj');
      return;
    }
    const [leftId, rightId] = matchupId.split('_');
    const data = cache.get(`${matchupId}|${dateParam()}`)?.byTeam;
    if (!data?.[leftId] || !data[rightId]) return;
    for (const row of table.querySelectorAll('.league-livescoring-summary__row')) {
      const name = row.children[1]?.textContent.trim();
      if (name !== 'FG%' && name !== 'FT%' && !COUNTING.includes(name)) continue;
      const a = projected(data[leftId], leftId, name);
      const b = projected(data[rightId], rightId, name);
      if (!a || !b) continue;
      const [left, , right] = row.children;
      const shown = [format(name, a.value), format(name, b.value)];
      setText(left, shown[0]);
      setText(right, shown[1]);
      left.setAttribute('data-fx-proj', '');
      right.setAttribute('data-fx-proj', '');
      if (SPLITS[name]) {
        setSplit(left, a);
        setSplit(right, b);
      }
      const tie = shown[0] === shown[1];
      const aWins = LOWER_WINS.has(name) ? a.value < b.value : a.value > b.value;
      for (const [cell, wins] of [[left, aWins], [right, !aWins]]) {
        cell.classList.toggle('color--green', !tie && wins);
        cell.classList.toggle('color--red', !tie && !wins);
      }
    }
  };

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      sync();
    });
  };

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
  setInterval(schedule, 1000);
  sync();
})();
