// Match analyzer: an "Analyzer" button in the bottom nav opens a full-screen page for this week's matchup.
//  1. A day strip (days stay pinned while scrolling): games per day for my team and my opponent
//     and how many of my slots stay open that day. The claims left this week stay pinned with the days.
//  2. A category outlook for the week (stats so far + the remaining games' per-game averages, as in the Matchups tab).
//     The categories I am losing or that are close are the targets that free agents are rated on.
//  3. Tap days to list the free agents who fit one of my open slots on them (when none is open: who plays). Each one
//     shows how many games he adds from that day to the end of the week (one claim = that many games), his schedule,
//     injury, ownership, stats and impact on the target categories (rated against my own roster). Sort, filter and a
//     stat window (season / last 14 / last 7 days) narrow the list.
//  4. "Test" on a free agent simulates adding him with no drop, or swapping him for one of my players (best first):
//     the day strip and the outlook then show that roster until reset. Nothing is sent to Fantrax.
//  5. Drop candidates: my players with the fewest games left and the least to give.
// An injured player (mine, the opponent's or a free agent) is assumed out until the return date in his injury tooltip;
// out with no date, or "for season", means out for the whole week.
// Rosters come from getTeamRosterInfo for each day of the week (current lineups, assumed set optimally), the free
// agents from getPlayerStats filtered by the "date playing" filter of the Players page.
(() => {
  if (window.__fxAnalyzer) return;
  window.__fxAnalyzer = true;

  const OPEN = 'fx-analyzer-open';
  const STEP = 10;
  const MIN_MINUTES = 20;
  const PLANNED = 30; // free agents whose add / drop is simulated up front to rank by net games
  const AHEAD = 3; // days of the following week shown after the matchup week
  const TTL_MS = 60000;
  const DAY_MS = 86400000;
  const MIN_GAMES = 10; // a projected player's line is last season's until he has this many games (as the Matchups tab)
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const POS = { 300: 'PG', 301: 'SG', 302: 'G', 303: 'SF', 304: 'PF', 305: 'C', 306: 'F', 307: 'Util' };
  const POSITIONS = ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C'];
  const CATS = ['FG%', 'FT%', '3PTM', 'REB', 'AST', 'ST', 'BLK', 'TO', 'PTS'];
  const SPLIT = { 'FG%': ['FGM', 'FGA'], 'FT%': ['FTM', 'FTA'] };
  const STAT_KEYS = ['GP', 'MIN', 'FGM', 'FGA', 'FTM', 'FTA', '3PTM', 'REB', 'AST', 'ST', 'BLK', 'TO', 'PTS'];
  const SUM_KEYS = STAT_KEYS.filter((k) => k !== 'GP' && k !== 'MIN');
  const WINDOWS = [['YTD', 'Season'], ['14', '14d'], ['7', '7d']];
  const SORTS = [['net', 'Net games'], ['games', 'Games'], ['impact', 'Impact'], ['rank', 'Rank'], ...CATS.map((c) => [c, c])];
  const TOPS = [0, 100, 200, 300];
  const UTIL = '307';

  let state = {
    loading: false,
    error: null,
    data: null,
    at: 0,
    sel: new Set(),
    mode: 'any', // several days chosen: a free agent plays on any of them / on all of them
    win: 'YTD', // stat window of the free agents
    next: false, // also show the first days of next week
    sort: 'net',
    pos: '',
    noInj: false,
    faOnly: false,
    top: 0,
    minMin: MIN_MINUTES, // free agents who play fewer minutes a game than this are left out (0: show everyone)
    q: '',
    filters: false,
    targets: new Set(),
    manual: false, // the user has picked the target categories
    k: STEP,
    raw: null, // what was fetched; data / the simulated view are built from it
    sim: null, // { id, scorer, drop, dropName }: a free agent added (and a rostered player dropped) on paper only
    simFor: null, // the free agent whose card is open (stats, add / drop tests)
    editDrop: false, // choosing who I would drop
    viewMemo: null,
  };
  const faCache = new Map(); // `${window}|${day}` -> { at, rows, header, byId, col } | { loading: true }
  const fitMemo = new Map();
  const netMemo = new Map(); // `${free agent}|${drop}|${day}` -> { net games, change in expected categories }
  const lineMemo = new WeakMap();
  let root = null;

  const leagueId = () => location.pathname.match(/league\/(\w+)/)?.[1];
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

  const periodBounds = (text) => {
    const m = text?.match(/(\w{3})\s+(\d{1,2}),\s*(\d{4})\s*-\s*(\w{3})\s+(\d{1,2}),\s*(\d{4})/);
    return m ? [Date.UTC(+m[3], MONTHS.indexOf(m[1]), +m[2]), Date.UTC(+m[6], MONTHS.indexOf(m[4]), +m[5])] : null;
  };

  // "Wed 2:00AM" (in the viewer's time zone) -> timestamp of the nearest such moment, null when there is no such time
  const startOf = (text) => {
    const m = text.match(/(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\w*\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) return null;
    const now = new Date();
    for (let off = -3; off <= 3; off++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + off);
      if (WEEKDAYS[d.getDay()].toLowerCase() !== m[1].toLowerCase()) continue;
      d.setHours((+m[2] % 12) + (/pm/i.test(m[4]) ? 12 : 0), +m[3], 0, 0);
      return d.getTime();
    }
    return null;
  };

  const plain = (content) => String(content ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').trim();

  // Today a game that is on or over cannot be changed any more (a game with no readable start time counts as started)
  const gameStarted = (content) => {
    const t = startOf(plain(content));
    return t === null || t <= Date.now();
  };

  // owner[s] = index of the player placed in slot s, -1 when the slot stays open
  const assign = (players, slots) => {
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
    for (let p = 0; p < players.length; p++) place(p, new Array(slots.length).fill(false));
    return owner;
  };

  const matched = (players, slots) => assign(players, slots).filter((o) => o >= 0).length;

  // ---- Stat lines ----

  // The numbers of a table row by column name: { FGM: 3.2, FGA: 7, ... } (made / attempted are what the percentages are built from)
  const lineOf = (row, header) => {
    const off = header.length - (row.cells?.length ?? 0);
    const line = {};
    header.forEach((c, i) => {
      if (!STAT_KEYS.includes(c.shortName)) return;
      const v = parseFloat(String(row.cells?.[i - off]?.content ?? '').replace(/,/g, ''));
      if (Number.isFinite(v)) line[c.shortName] = v;
    });
    return line;
  };

  const linesById = (data) => {
    const table = data?.tables?.[0];
    const header = table?.header?.cells ?? [];
    return Object.fromEntries((table?.rows ?? []).filter((r) => r.scorer?.scorerId).map((r) => [r.scorer.scorerId, lineOf(r, header)]));
  };

  const addLine = (into, line) => {
    for (const k of SUM_KEYS) into[k] = (into[k] ?? 0) + (line[k] ?? 0);
  };

  const catValue = (c, s) => (SPLIT[c] ? ((s[SPLIT[c][1]] ?? 0) > 0 ? (s[SPLIT[c][0]] ?? 0) / s[SPLIT[c][1]] : 0) : s[c] ?? 0);

  // One team on one day; kind is 'past', 'today' or 'future'
  //   raw   = players (active + bench) with a game, eff = games that count: locked ones + the best fit of the rest
  //   slots = active slots still open to changes, players = those with a game that can still be placed
  //   placed = who fills a slot (with his per-game line), open = the slots nobody can fill, actives = who is set to play now
  //   actual = (past days) the stats of the games that counted, entries = (today and later) my players with their lines
  const analyse = (data, kind, date) => {
    const table = data?.tables?.[0];
    const header = table?.header?.cells ?? [];
    const slots = [];
    const players = [];
    const who = [];
    const actives = [];
    const entries = [];
    const everyone = [];
    const actual = {};
    let raw = 0;
    let locked = 0;
    for (const row of table?.rows ?? []) {
      const id = row.scorer?.scorerId;
      const active = row.statusId === '1';
      const bench = row.statusId === '2';
      const cell = row.cells?.[row.cells.length - header.length];
      // An injured player is not expected to play before his return date (today and later days only)
      const hurt = kind !== 'past' && Boolean(id) && outOn(row.scorer, date);
      const hasGame = Boolean(id) && (active || bench) && plain(cell?.content) !== '' && !hurt;
      if (hasGame) raw++;
      if (kind === 'past') {
        if (hasGame && active) {
          locked++;
          addLine(actual, lineOf(row, header));
        }
        continue;
      }
      if (id) everyone.push({ id, line: lineOf(row, header) });
      const started = kind === 'today' && hasGame && gameStarted(cell.content);
      if (active) {
        if (started && hasGame) locked++;
        else slots.push(row.posId);
      }
      const line = id && (active || bench) ? lineOf(row, header) : null;
      if (hasGame && !started) {
        players.push(new Set(row.eligiblePosIds ?? []));
        who.push({ id, line });
        if (active) actives.push({ id, line });
      }
      if (line) entries.push({ id, scorer: row.scorer, line, playing: hasGame && !started, active });
    }
    // Specific positions first so that the slots left open are the flexible (Util) ones
    slots.sort((a, b) => (a === UTIL) - (b === UTIL));
    const owner = assign(players, slots);
    const open = slots.filter((_, s) => owner[s] < 0);
    const placed = owner.filter((o) => o >= 0).map((o) => who[o]);
    return { raw, eff: locked + placed.length, fill: placed.length, slots, players, open, placed, actives, entries, everyone, actual };
  };

  // ---- Loading the week ----

  // Fetches everything the week needs; build() turns it into the figures (and again for a simulated roster move)
  const load = async () => {
    const [cur] = await call([{ method: 'getTeamRosterInfo', data: {} }]);
    const me = cur?.displayedSelections?.displayedFantasyTeamId;
    const opp = cur?.periodOppnentTeamIds?.[0];
    const today = Number(cur?.displayedSelections?.displayedPeriod);
    const start = cur?.displayedSelections?.displayedStartDate;
    if (!me || !start || !today) throw new Error('no roster');
    const d = new Date(start);
    const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const dayOf = (t) => Math.round((t - base) / DAY_MS) + 1;
    const names = Object.fromEntries((cur.fantasyTeams ?? []).map((t) => [t.id, t.shortName || t.name]));
    const left = cur?.miscData?.transactionInfo?.info?.find((i) => /^claims remaining/i.test(i.name))?.value;
    const claims = Number.isFinite(left) ? { left, limit: Number(localStorage.getItem(`fxClaimLimit:${leagueId()}`)) || 0 } : null;
    const totals = cur?.miscData?.statusTotals ?? [];
    const sum = (key) => totals.reduce((s, t) => s + (t[key] ?? 0), 0);
    const ir = totals.find((t) => t.id === '3');
    const spots = totals.length ? { free: sum('max') - sum('total'), irFree: ir ? ir.max - ir.total : 0 } : null;
    const seasons = cur?.displayedLists?.seasonOrProjections ?? cur?.seasonOrProjections ?? [];
    const previous = seasons.filter((s) => s.timeframeTypeCode === 'YEAR_TO_DATE' && /Reg Season/.test(s.name))[1];
    const season = cur?.displayedSelections?.displayedSeasonOrProjection?.code;

    let first = today;
    let last = today + 6;
    if (opp) {
      const [period] = await call([
        {
          method: 'getLiveScoringStats',
          data: { mobileMatchupView: true, matchupId: `${me}_${opp}`, teamId: 'ALL', layout: 'DETAILED', mainView: 'MATCHUP', mobileView: 'MATCHUPS', newView: true, sppId: '-1', viewType: '2' },
        },
      ]);
      const bounds = periodBounds(period?.displayPeriod);
      if (bounds) [first, last] = [dayOf(bounds[0]), dayOf(bounds[1])];
    }

    const periods = [];
    for (let n = first; n <= last; n++) periods.push(n);
    const teams = opp ? [me, opp] : [me];
    const byPeriod = (n) => ({ period: String(n), timeframeTypeCode: 'BY_PERIOD' });
    const msgs = [];
    for (const n of periods) {
      for (const t of teams) msgs.push(roster(t, n < today ? byPeriod(n) : { period: String(n) }));
    }
    const extra = Array.from({ length: AHEAD }, (_, k) => last + 1 + k);
    for (const n of extra) msgs.push(roster(me, { period: String(n) }));
    // The day's own stats (live games included) are only in the period view, so today is asked for again that way
    const todayAt = msgs.length;
    for (const t of teams) msgs.push(roster(t, byPeriod(today)));
    const lastAt = msgs.length;
    if (previous) for (const t of teams) msgs.push(roster(t, { timeframeTypeCode: previous.timeframeTypeCode, seasonOrProjection: previous.code }));
    const res = await call(msgs);

    return { me, opp, names, today, base, periods, teams, extra, res, todayAt, lastAt, previous: Boolean(previous), claims, spots, byDate: season ? season.replace('YEAR_TO_DATE', 'BY_DATE') : null, norm: null };
  };

  // Expected categories won: each category counts by how clear the lead is (a lead of the "close" margin is ~85%)
  const expectedCats = (outlook) => outlook.reduce((s, o) => s + 1 / (1 + Math.exp((-1.7 * o.lead) / o.tol)), 0);

  // sim = { add: { id, scorer }, drop: id | null, from: day number }: my roster with that player added (as a bench
  // player) and that one dropped from day `from` on; nothing is sent to Fantrax
  const build = (raw, sim) => {
    const { me, opp, names, today, base, periods, teams, extra, res, todayAt, lastAt, previous } = raw;
    const sides = ['me', 'opp'];
    const dayInfo = (n, kind) => {
      const t = base + (n - 1) * DAY_MS;
      return { n, kind, date: isoDay(t), weekday: WEEKDAYS[new Date(t).getUTCDay()], dom: new Date(t).getUTCDate(), mon: MONTHS[new Date(t).getUTCMonth()] };
    };
    const tweak = (data, n, date) => {
      const table = data?.tables?.[0];
      if (!sim || n < sim.from || !table) return data;
      const header = table.header.cells;
      let rows = sim.drop ? table.rows.filter((r) => r.scorer?.scorerId !== sim.drop) : table.rows;
      if (sim.add) {
        const pool = faCache.get(poolKey('YTD', date));
        const src = pool?.byId?.get(sim.add.id);
        const cells = header.map((c) => ({ content: src?.cells?.[pool.col[c.shortName]]?.content ?? '' }));
        rows = [...rows, { scorer: sim.add.scorer, statusId: '2', posId: '0', eligiblePosIds: sim.add.scorer.posIds ?? [], cells }];
      }
      return { ...data, tables: [{ ...table, rows }] };
    };
    const after = extra.flatMap((n, k) => (res[periods.length * teams.length + k]?.tables ? [dayInfo(n, 'future')] : []));
    const days = periods.map((n, i) => {
      const kind = n < today ? 'past' : n === today ? 'today' : 'future';
      const info = dayInfo(n, kind);
      return {
        ...info,
        me: analyse(tweak(res[i * teams.length], n, info.date), kind, info.date),
        opp: opp ? analyse(res[i * teams.length + 1], kind, info.date) : null,
      };
    });

    // Last season's line stands in for a player's this-season line until he has played MIN_GAMES games
    const prev = teams.map((_, i) => (previous ? linesById(res[lastAt + i]) : {}));
    const lineFor = (i, id, line) => ((line.GP ?? 0) >= MIN_GAMES || !(prev[i][id]?.GP > 0) ? line : prev[i][id]);

    // The week so far (the games that counted) plus the games still to come at each player's average. My lineup is
    // assumed set optimally; my opponent's is taken as it stands, like the Matchups tab does
    const totals = teams.map((_, i) => {
      const side = sides[i];
      const act = {};
      const rem = {};
      for (const day of days) {
        if (day.kind === 'past') addLine(act, day[side].actual);
        else for (const p of side === 'me' ? day.me.placed : day.opp.actives) addLine(rem, lineFor(i, p.id, p.line));
      }
      addLine(act, analyse(res[todayAt + i], 'past').actual);
      const total = {};
      for (const k of SUM_KEYS) total[k] = (act[k] ?? 0) + (rem[k] ?? 0);
      return { act, total };
    });
    const outlook = opp
      ? CATS.map((c) => {
          const [a, b] = [catValue(c, totals[0].total), catValue(c, totals[1].total)];
          const lead = c === 'TO' ? b - a : a - b;
          // the margin that counts as close is one standard deviation of the gap: counting stats vary like sqrt(total)
          const tol = SPLIT[c] ? 0.02 : Math.max(Math.sqrt(Math.abs(a) + Math.abs(b)), 1);
          return { c, me: a, opp: b, lead, tol, state: Math.abs(lead) <= tol ? 'close' : lead > 0 ? 'win' : 'lose' };
        })
      : [];

    // Stats are rated against my own roster (all of it, injured reserve included)
    const firstLive = days.find((day) => day.kind !== 'past');
    if (!raw.norm) raw.norm = makeNorm((firstLive?.me.everyone ?? []).map((e) => lineFor(0, e.id, e.line)));

    return {
      me,
      opp,
      names,
      today,
      days,
      after,
      base,
      outlook,
      norm: raw.norm,
      cats: expectedCats(outlook),
      claims: raw.claims && sim?.add ? { ...raw.claims, left: Math.max(0, raw.claims.left - 1) } : raw.claims,
      spots: raw.spots,
      lineFor: (id, line) => lineFor(0, id, line),
      todayT: base + (today - 1) * DAY_MS,
      byDate: raw.byDate,
      raw,
    };
  };

  // ---- Free agents ----

  const poolKey = (win, date) => `${win}|${date}`;

  const poolParams = (win, date) => ({
    datePlaying: date,
    maxResultsPerPage: '500',
    scoringCategoryType: '1',
    ...(win !== 'YTD' && { timeframeTypeCode: 'BY_DATE', seasonOrProjection: state.data.byDate, startDate: isoDay(state.data.todayT - (Number(win) - 1) * DAY_MS), endDate: isoDay(state.data.todayT) }),
  });

  // All the pools that are missing or stale go out in one request
  const fetchPools = async (wants) => {
    const need = wants.filter(([win, date]) => {
      const hit = faCache.get(poolKey(win, date));
      return !(hit && (hit.loading || Date.now() - hit.at < TTL_MS));
    });
    if (!need.length) return;
    for (const [win, date] of need) faCache.set(poolKey(win, date), { ...faCache.get(poolKey(win, date)), loading: true, at: faCache.get(poolKey(win, date))?.at ?? 0 });
    try {
      const res = await call(need.map(([win, date]) => ({ method: 'getPlayerStats', data: poolParams(win, date) })));
      need.forEach(([win, date], i) => {
        const rows = res[i]?.statsTable ?? [];
        const header = res[i]?.tableHeader?.cells ?? [];
        faCache.set(poolKey(win, date), {
          at: Date.now(),
          rows,
          header,
          col: Object.fromEntries(header.map((c, k) => [c.shortName, k])),
          byId: new Map(rows.filter((r) => r.scorer && !r.scorer.team).map((r) => [r.scorer.scorerId, r])),
        });
      });
    } catch {
      for (const [win, date] of need) faCache.set(poolKey(win, date), { at: Date.now(), rows: [], header: [], col: {}, byId: new Map(), failed: true });
    }
    render();
  };

  const dayOfN = (n) => state.data?.days.find((d) => d.n === n);

  // The days a free agent is looked at over: from the first chosen day to the end of the matchup week, then (when asked) the first days of the next
  const windowInfo = () => {
    const { data } = state;
    const sel = [...state.sel].sort((a, b) => a - b);
    const from = sel[0] ?? data.today;
    return { sel, week: data.days.filter((d) => d.n >= from).slice(0, 10), after: state.next ? data.after.slice(0, AHEAD) : [] };
  };

  const fetchSelected = () => {
    if (!state.data) return;
    const { sel, week, after } = windowInfo();
    const dates = new Set([...sel.map((n) => dayOfN(n)?.date), ...week.map((d) => d.date), ...after.map((d) => d.date)].filter(Boolean));
    const wants = [...dates].map((date) => ['YTD', date]);
    if (state.win !== 'YTD' && state.data.byDate) for (const n of sel) wants.push([state.win, dayOfN(n).date]);
    fetchPools(wants);
  };

  // Slot types a free agent could take on a day without displacing anyone: directly (an open slot) or by moving a
  // rostered player to another slot. Empty when he does not fit that day's lineup.
  const fitTypes = (day, scorer, game) => {
    if (day.kind === 'today' && gameStarted(game)) return [];
    const key = `${day.n}|${(scorer.posIds ?? []).join()}`;
    let types = fitMemo.get(key);
    if (!types) {
      const me = day.me;
      me.plan ??= { base: matched(me.players, me.slots), types: [...new Set(me.slots)] };
      const elig = new Set(scorer.posIds ?? []);
      types = me.plan.types.filter((p) => elig.has(p) && matched([...me.players, new Set([p])], me.slots) > me.plan.base);
      fitMemo.set(key, types);
    }
    return types;
  };

  const gameOf = (pool, row) => (row ? plain(row.cells?.[pool.col.Opp]?.content) : '');

  const poolLine = (pool, row) => {
    let line = lineMemo.get(row);
    if (!line) lineMemo.set(row, (line = lineOf(row, pool.header)));
    return line;
  };

  // ---- Rating the stats ----

  // How much a player's per-game line is worth in each category, in standard deviations over a set of lines (my roster)
  // (the shooting percentages count by what he adds above the rate of that set, so volume matters)
  const makeNorm = (lines) => {
    const regulars = lines.filter((l) => (l.MIN ?? 99) >= 12);
    const all = regulars.length >= 5 ? regulars : lines;
    const rate = {};
    for (const [c, [made, att]] of Object.entries(SPLIT)) rate[c] = all.reduce((s, l) => s + (l[made] ?? 0), 0) / Math.max(1, all.reduce((s, l) => s + (l[att] ?? 0), 0));
    const raw = (c, l) => (SPLIT[c] ? (l[SPLIT[c][0]] ?? 0) - rate[c] * (l[SPLIT[c][1]] ?? 0) : l[c] ?? 0);
    const stats = {};
    for (const c of CATS) {
      const v = all.map((l) => raw(c, l));
      const mean = v.reduce((s, x) => s + x, 0) / (v.length || 1);
      stats[c] = { mean, sd: Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (v.length || 1)) || 1 };
    }
    return { z: (c, l) => ((raw(c, l) - stats[c].mean) / stats[c].sd) * (c === 'TO' ? -1 : 1) };
  };

  const targetCats = () => (state.targets.size ? CATS.filter((c) => state.targets.has(c)) : CATS);

  // A line from a few games says little: its ratings are pulled toward the average (a player with no games rates 0)
  const zOf = (norm, line) => {
    const w = line.GP == null ? 1 : line.GP / (line.GP + 3);
    return Object.fromEntries(CATS.map((c) => [c, norm.z(c, line) * w]));
  };

  // ---- Players ----

  const injuryMemo = new WeakMap();

  // "Expected return Nov 6" -> { iso: "2026-11-06", label: "Nov 6" } (the year puts the date within the last two months or ahead)
  const returnDate = (tip) => {
    const m = tip.match(/expected return\s+([A-Za-z]{3})\w*\s+(\d{1,2})/i);
    const month = m ? MONTHS.findIndex((x) => x.toLowerCase() === m[1].toLowerCase()) : -1;
    if (month < 0) return null;
    const now = new Date();
    let t = Date.UTC(now.getFullYear(), month, +m[2]);
    if (t < now.getTime() - 60 * DAY_MS) t = Date.UTC(now.getFullYear() + 1, month, +m[2]);
    return { iso: isoDay(t), label: `${MONTHS[month]} ${+m[2]}` };
  };

  // Q / D / P / O from the injury icon's tooltip, e.g. "Knee - Out Indefinitely - Expected return Nov 6",
  // with the day he is expected back (until, "YYYY-MM-DD") when the tooltip names one. "Out for season" has no return
  // (Fantrax still prints a date for it)
  const injuryOf = (scorer) => {
    if (injuryMemo.has(scorer)) return injuryMemo.get(scorer);
    const icon = (scorer.icons ?? []).find((i) => i.typeId === '1' || i.typeId === '30');
    let inj = null;
    if (icon) {
      const status = icon.tooltip.split(/\s+-\s+/)[1] ?? icon.tooltip;
      const code = /\bout\b|season[-\s]?ending|injured (reserve|list)/i.test(status)
        ? 'O'
        : /doubtful/i.test(status)
          ? 'D'
          : /questionable/i.test(status)
            ? 'Q'
            : /probable/i.test(status)
              ? 'P'
              : icon.typeId === '30'
                ? 'O'
                : 'Q';
      const back = /season/i.test(status) ? null : returnDate(icon.tooltip);
      inj = { code, tip: icon.tooltip, until: back?.iso ?? null, back: back?.label ?? null };
    }
    injuryMemo.set(scorer, inj);
    return inj;
  };

  // Not expected to play on that day (YYYY-MM-DD): before his return date. A player who is out with no return date, or
  // whose date has already passed, is out until further notice
  const outOn = (scorer, date) => {
    const inj = injuryOf(scorer);
    if (!inj) return false;
    const today = new Date().toLocaleDateString('en-CA');
    if (inj.code === 'O' && (!inj.until || inj.until < today)) return true;
    return inj.until ? date < inj.until : false;
  };

  const percent = (text) => {
    const v = parseFloat(String(text ?? '').replace('%', ''));
    return Number.isFinite(v) ? v : null;
  };

  // The game of a pool row on a day, empty when he has none or is injured that day
  const availGame = (pool, row, date) => {
    const game = gameOf(pool, row);
    return game && !outOn(row.scorer, date) ? game : '';
  };

  // Everyone who fits an open slot on the chosen days, rated; the order and filters of the view are applied later.
  // When none of the chosen days has an open slot (swap): everyone who plays on them, to be swapped in for a drop.
  const candidates = () => {
    const { data } = state;
    const { sel, week, after } = windowInfo();
    const chosen = sel.map(dayOfN).filter(Boolean);
    const withOpen = chosen.filter((d) => d.me.open.length);
    const swap = withOpen.length === 0;
    const needed = swap ? chosen : withOpen;
    const pools = new Map([...week, ...after, ...needed].map((d) => [d.date, faCache.get(poolKey('YTD', d.date))]));
    if ([...pools.values()].some((p) => !p?.rows)) return null;
    const ids = new Set();
    for (const d of needed) for (const id of pools.get(d.date).byId.keys()) ids.add(id);
    const norm = data.norm;
    const targets = targetCats();
    const alt = state.win === 'YTD' ? [] : sel.map((n) => faCache.get(poolKey(state.win, dayOfN(n).date))).filter((p) => p?.byId);
    const list = [];
    for (const id of ids) {
      const hit = needed.filter((d) => {
        const pool = pools.get(d.date);
        const row = pool.byId.get(id);
        const game = row && availGame(pool, row, d.date);
        if (!game) return false;
        return swap ? !(d.kind === 'today' && gameStarted(game)) : fitTypes(d, row.scorer, game).length;
      });
      if (!hit.length || (state.mode === 'all' && hit.length < needed.length)) continue;
      const pool = pools.get(needed[0].date);
      const row = needed.map((d) => pools.get(d.date).byId.get(id)).find(Boolean);
      const scorer = row.scorer;
      const pip = (day, next) => {
        const p = pools.get(day.date);
        const r = p.byId.get(id);
        const scheduled = Boolean(gameOf(p, r));
        const game = r ? availGame(p, r, day.date) : '';
        const plays = Boolean(game) && !(day.kind === 'today' && gameStarted(game));
        const fit = !next && plays && (swap || fitTypes(day, scorer, game).length > 0);
        return { day, plays, fit, next, game, out: scheduled && !game };
      };
      const pips = [...week.map((d) => pip(d, false)), ...after.map((d) => pip(d, true))];
      const gained = pips.filter((p) => p.fit).length;
      const sameDay = alt.find((p) => p.byId.has(id));
      const line = sameDay ? poolLine(sameDay, sameDay.byId.get(id)) : poolLine(pool, row);
      const z = zOf(norm, line);
      const week7 = targets.reduce((s, c) => s + z[c], 0);
      const col = pool.col;
      const cell = (name) => row.cells?.[col[name]]?.content;
      const sta = plain(cell('Sta'));
      list.push({
        id,
        scorer,
        pips,
        gained,
        line,
        z,
        impact: gained * week7,
        helps: targets.filter((c) => z[c] > 0.5).sort((a, b) => z[b] - z[a]).slice(0, 3),
        inj: injuryOf(scorer),
        fa: /^FA/i.test(sta),
        sta,
        ros: percent(plain(cell('Ros'))),
        trend: percent(plain(cell('+/-'))),
        games: hit.map((d) => ({ day: d, text: plain(pools.get(d.date).byId.get(id).cells?.[col.Opp]?.content) })),
      });
    }
    return { list, swap };
  };

  const sortAndFilter = (list) => {
    const name = state.q.trim().toLowerCase();
    const ok = (c) =>
      (!state.pos || (c.scorer.posShortNames ?? '').split(',').includes(state.pos)) &&
      !(state.noInj && (c.inj?.code === 'O' || c.inj?.code === 'D')) &&
      !(state.faOnly && !c.fa) &&
      !(state.top && !(c.scorer.rank <= state.top)) &&
      !(state.minMin && (c.line.MIN ?? 0) < state.minMin) &&
      (!name || c.scorer.name.toLowerCase().includes(name));
    const rank = (c) => c.scorer.rank ?? 1e9;
    const by = {
      games: (a, b) => b.gained - a.gained || rank(a) - rank(b),
      impact: (a, b) => b.impact - a.impact || rank(a) - rank(b),
      rank: (a, b) => rank(a) - rank(b),
    };
    const kept = list.filter(ok);
    if (state.sort === 'net') {
      // The simulation behind "net games" is run for the players with the most games; the rest follow
      kept.sort(by.games);
      for (const c of kept.slice(0, PLANNED)) planFor(c);
      const net = (c) => (c.plan ? c.plan.net : -1e6);
      return kept.sort((a, b) => net(b) - net(a) || (b.plan?.cats ?? 0) - (a.plan?.cats ?? 0) || by.games(a, b));
    }
    const order = by[state.sort] ?? ((a, b) => b.z[state.sort] - a.z[state.sort] || rank(a) - rank(b));
    return kept.sort(order);
  };

  // ---- View ----

  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs ?? {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  };

  const signed = (n, digits = 0) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(digits);

  const fmtCat = (c, v) => (SPLIT[c] ? v.toFixed(3).replace(/^0/, '') : String(Math.round(v)));

  const head = (data) => {
    const range = data ? `${data.days[0].mon} ${data.days[0].dom} - ${data.days[data.days.length - 1].mon} ${data.days[data.days.length - 1].dom}` : '';
    const time = state.at ? new Date(state.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return [
      h(
        'header',
        { class: 'fx-an__head' },
        h('h2', null, 'Analyzer'),
        h('button', { type: 'button', 'aria-label': 'Refresh', class: state.loading ? 'is-spin' : '', onclick: () => refresh(true) }, h('mat-icon', { class: 'material-icons' }, 'refresh')),
      ),
      data && h('div', { class: 'fx-an__sub' }, h('span', null, `${range}${time ? ` · updated ${time}` : ''}`)),
    ];
  };

  const skeleton = (n, tall) => h('div', { class: 'fx-an__skels' }, Array.from({ length: n }, () => h('div', { class: `fx-an__skel${tall ? ' is-tall' : ''}` })));

  const dayClass = (d) => `${state.sel.has(d.n) ? ' is-sel' : ''}${d.kind === 'past' ? ' is-past' : ''}${d.kind === 'today' ? ' is-today' : ''}`;
  const cols = (data) => `--n:${data.days.length}`;

  // Stays pinned to the top while the list scrolls (with the simulation banner, when one is on); the number under a
  // day is how many of my slots are open, the corner shows the claims left this week (each add uses one)
  const daysBar = (data) => {
    const claims = data.claims;
    return h(
      'div',
      { class: 'fx-an__days fx-an__grid', style: cols(data) },
      claims
        ? h('div', { class: `fx-an__claims${claims.left === 0 ? ' is-none' : ''}`, title: 'Claims left this week: each add uses one' }, h('b', null, `${claims.left}${claims.limit ? `/${claims.limit}` : ''}`), h('small', null, 'claims left'))
        : h('span'),
      data.days.map((d) =>
        h(
          'button',
          { type: 'button', class: `fx-an__day${dayClass(d)}`, disabled: d.kind === 'past', onclick: () => selectDay(d.n) },
          h('span', null, d.weekday),
          h('b', null, String(d.dom)),
          h('i', { class: d.kind !== 'past' && d.me.open.length ? 'has-open' : '' }, d.kind === 'past' ? '' : String(d.me.open.length)),
        ),
      ),
      h('span', { class: 'fx-an__totalh' }, 'Total'),
    );
  };

  const stickyView = (view) => {
    const sim = state.sim;
    const from = dayOfN(fromDay());
    return h(
      'div',
      { class: 'fx-an__sticky' },
      sim &&
        h(
          'div',
          { class: 'fx-an__sim' },
          h('span', null, 'Simulating ', h('b', null, `+ ${sim.scorer.shortName ?? sim.scorer.name}`), sim.drop && h('b', { class: 'is-drop' }, `− ${sim.dropName}`), from ? ` from ${from.weekday}` : ''),
          h('button', { type: 'button', onclick: () => setSim(null) }, 'Reset'),
        ),
      daysBar(view),
    );
  };

  const stripView = (data) => {
    const { days, names } = data;
    const total = (team, key) => days.reduce((s, d) => s + (d[team]?.[key] ?? 0), 0);
    const cell = (d, cls, ...kids) => h('div', { class: `fx-an__cell${dayClass(d)} ${cls}` }, ...kids);
    const label = (name, sub) => h('div', { class: 'fx-an__label' }, h('b', null, name), h('small', null, sub));
    const teamRow = (side, cls) => {
      const lost = (d) => d[side].raw - d[side].eff;
      return h(
        'div',
        { class: `fx-an__grid fx-an__row ${cls}`, style: cols(data) },
        label(names[data[side]] ?? (side === 'me' ? 'Me' : 'Opp'), 'games'),
        days.map((d) => cell(d, '', h('b', null, String(d[side].raw)), lost(d) > 0 ? h('small', { class: 'is-lost', title: 'Games that do not fit in the lineup' }, `−${lost(d)}`) : null)),
        h('div', { class: 'fx-an__cell fx-an__total' }, h('b', null, String(total(side, 'raw'))), h('small', null, `${total(side, 'fill')} left`)),
      );
    };
    const rows = [teamRow('me', 'fx-an__me')];
    if (data.opp) rows.push(teamRow('opp', 'fx-an__opp'));
    rows.push(
      h(
        'div',
        { class: 'fx-an__grid fx-an__row fx-an__free', style: cols(data) },
        label('Open slots', 'I can still fill'),
        days.map((d) => cell(d, '', d.kind === 'past' ? h('b', null, '–') : h('b', { class: d.me.open.length ? 'has-open' : '' }, String(d.me.open.length)))),
        h('div', { class: 'fx-an__cell fx-an__total' }, h('b', null, String(days.reduce((s, d) => s + (d.kind === 'past' ? 0 : d.me.open.length), 0)))),
      ),
    );
    return h('div', { class: 'fx-an__strip' }, rows);
  };

  // How a simulated roster moves each category's projected total (and whether that helps me)
  const deltasOf = (view) =>
    view.outlook.map((o, i) => {
      const d = o.me - state.data.outlook[i].me;
      return { c: o.c, d, tol: o.tol, good: o.c === 'TO' ? d < 0 : d > 0 };
    });

  // "+12", "−0.5%" (the shooting percentages move in points)
  const fmtDelta = (c, d) => (SPLIT[c] ? `${signed(d * 100, 1)}%` : signed(d, Math.abs(d) >= 1 ? 0 : 1));

  // The categories a move changes, in the usual category order, e.g. "FT% −0.5% · REB +12 · AST +3" (green when it
  // helps, red when it hurts); negligible changes are left out
  const changesLine = (deltas) => {
    const shown = deltas.filter((x) => Math.abs(x.d) / x.tol > 0.03);
    return h('div', { class: 'fx-an__changes' }, shown.length ? shown.map((x) => h('span', { class: x.good ? 'is-up' : 'is-down' }, `${x.c} ${fmtDelta(x.c, x.d)}`)) : 'no change in the categories');
  };

  // Two rows, mine and my opponent's projected totals, a column per category that slides sideways. The better side of a
  // category is green, the other red, both amber when it is close; a navy header marks a target category. With deltas
  // (a simulation) a third row gives the change of my totals
  const catGrid = (outlook, deltas) => {
    const { names, opp } = state.data;
    const tone = (o, mine) => (o.state === 'close' ? 'close' : (o.state === 'win') === mine ? 'win' : 'lose');
    const row = (label, mine) => [
      h('div', { class: 'fx-an__catlabel' }, label),
      ...outlook.map((o) => h('div', { class: `fx-an__catval${mine ? '' : ' is-opp'}${state.targets.has(o.c) ? ' is-target' : ''}`, 'data-s': tone(o, mine) }, fmtCat(o.c, mine ? o.me : o.opp))),
    ];
    return h(
      'div',
      { class: 'fx-an__catscroll' },
      h(
        'div',
        { class: 'fx-an__cattable', style: `--n:${outlook.length}` },
        h('span', { class: 'fx-an__catlabel' }),
        outlook.map((o) => h('button', { type: 'button', class: `fx-an__cathead${state.targets.has(o.c) ? ' is-target' : ''}`, 'aria-pressed': String(state.targets.has(o.c)), onclick: () => toggleTarget(o.c) }, o.c)),
        row('Me', true),
        row(names[opp] ?? 'Opp', false),
        deltas && [h('div', { class: 'fx-an__catlabel' }, 'Change'), ...deltas.map((x) => h('div', { class: `fx-an__catchange${state.targets.has(x.c) ? ' is-target' : ''} ${Math.abs(x.d) / x.tol < 0.03 ? '' : x.good ? 'is-up' : 'is-down'}` }, fmtDelta(x.c, x.d)))],
      ),
    );
  };

  const outlookView = (data) => {
    if (!data.outlook.length) return null;
    return h('section', { class: 'fx-an__cats' }, h('h3', null, state.sim ? 'Simulated week' : 'Projected week', h('span', null, 'tap a category to target it')), catGrid(data.outlook, state.sim ? deltasOf(data) : null));
  };

  const chipRow = (items, active, pick, label, wrap) =>
    h(
      'div',
      { class: `fx-an__chips${wrap ? ' is-wrap' : ''}`, role: 'group', 'aria-label': label },
      items.map(([k, text, off]) => h('button', { type: 'button', 'aria-pressed': String(active === k), disabled: off, onclick: () => pick(k) }, text)),
    );

  const toggle = (text, on, fn) => h('button', { type: 'button', class: 'fx-an__tog', 'aria-pressed': String(on), onclick: fn }, text);

  const filterCount = () => [state.pos, state.noInj, state.faOnly, state.top, state.q.trim()].filter(Boolean).length;

  const controls = (multi) => {
    const kids = [
      h(
        'div',
        { class: 'fx-an__opts' },
        multi && chipRow([['any', 'Any'], ['all', 'All']], state.mode, (v) => ((state.mode = v), (state.k = STEP), render()), 'Free agent plays on any / all chosen days', true),
        chipRow(WINDOWS.map(([k, t]) => [k, t, k !== 'YTD' && !state.data.byDate]), state.win, (v) => ((state.win = v), fetchSelected(), render()), 'Stat window', true),
        toggle('+ Next week', state.next, () => ((state.next = !state.next), fetchSelected(), render())),
      ),
      chipRow(SORTS, state.sort, (v) => ((state.sort = v), (state.k = STEP), render()), 'Sort by'),
      h(
        'div',
        { class: 'fx-an__opts' },
        toggle(`${MIN_MINUTES}+ min`, state.minMin > 0, () => ((state.minMin = state.minMin ? 0 : MIN_MINUTES), (state.k = STEP), render())),
        toggle(`Filters${filterCount() ? ` · ${filterCount()}` : ''}`, state.filters, () => ((state.filters = !state.filters), render())),
      ),
    ];
    if (state.filters) {
      kids.push(
        chipRow([['', 'All'], ...POSITIONS.map((p) => [p, p])], state.pos, (v) => ((state.pos = v), (state.k = STEP), render()), 'Position'),
        h(
          'div',
          { class: 'fx-an__opts' },
          h('input', {
            type: 'search',
            class: 'fx-an__search',
            placeholder: 'Search player',
            value: state.q,
            'data-keep': 'q',
            oninput: (e) => ((state.q = e.target.value), (state.k = STEP), render()),
          }),
          toggle('No injured', state.noInj, () => ((state.noInj = !state.noInj), render())),
          toggle('FAs only', state.faOnly, () => ((state.faOnly = !state.faOnly), render())),
          toggle(state.top ? `Rank ≤ ${state.top}` : 'Any rank', Boolean(state.top), () => ((state.top = TOPS[(TOPS.indexOf(state.top) + 1) % TOPS.length]), render())),
        ),
      );
    }
    return h('div', { class: 'fx-an__ctl' }, kids);
  };

  const pipsView = (c) => {
    const chips = c.pips.map((p) =>
      h('span', { class: `${p.fit ? 'on' : p.plays ? (p.next ? 'next' : 'full') : p.out ? 'out' : ''}${state.sel.has(p.day.n) ? ' sel' : ''}`, title: p.game ? `${p.day.weekday} ${p.day.dom}: ${p.game}` : p.out ? `${p.day.weekday} ${p.day.dom}: injured` : '' }, p.day.weekday.slice(0, 2)),
    );
    const at = c.pips.findIndex((p) => p.next);
    if (at > 0) chips.splice(at, 0, h('em', null));
    return h('div', { class: 'fx-an__pips' }, chips);
  };

  // "@POR Fri 4:00AM" on day Thu -> "Th @POR · Fri 4:00AM"
  const gameText = (g) => {
    const m = g.text.match(/^(.*?)\s+((?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\w*\s+\d{1,2}:\d{2}\s*[AP]M.*)$/i);
    return `${g.day.weekday.slice(0, 2)} ${m ? `${m[1]} · ${m[2].replace(/\s+/g, ' ')}` : g.text}`;
  };

  const statsGrid = (line, targets, z) =>
    h(
      'div',
      { class: 'fx-an__stats' },
      CATS.map((c) => {
        const att = SPLIT[c] ? line[SPLIT[c][1]] : null;
        const v = SPLIT[c] ? (att > 0 ? (line[SPLIT[c][0]] / att).toFixed(3).replace(/^0/, '') : '–') : line[c] == null ? '–' : line[c].toFixed(1);
        return h('div', { class: `${targets.has(c) ? 'is-t' : ''}${z && z[c] >= 1 ? ' is-hi' : ''}${z && z[c] <= -1 ? ' is-lo' : ''}` }, h('small', null, c), h('b', null, v), h('i', null, att != null ? `${att.toFixed(1)} att` : ''));
      }),
    );

  const photo = (scorer, inj) =>
    h('div', { class: 'fx-an__ph' }, h('img', { src: scorer.headshotUrl ?? '', alt: '', loading: 'lazy' }), inj && h('span', { class: 'fx-an__inj', 'data-status': inj.code, title: inj.tip }, inj.code));

  // ---- Simulation: add a free agent (and drop a rostered player) on paper, see the week's outlook ----

  const fromDay = () => [...state.sel].sort((a, b) => a - b)[0] ?? state.data.today;

  // ---- Who I would drop ----

  const dropKey = () => `fxDropPlayer:${leagueId()}`;

  // The player I chose to drop: his id, '' for none, null when I have not chosen
  const storedDrop = () => localStorage.getItem(dropKey());

  // My players, the ones to drop first first: fewest games left (least lost), then least in the target categories
  const ranked = () => {
    const { data } = state;
    const targets = targetCats();
    const mine = new Map();
    for (const d of data.days) {
      if (d.kind === 'past') continue;
      for (const e of d.me.entries) {
        const m = mine.get(e.id) ?? { e, plays: new Set() };
        if (e.playing) m.plays.add(d.n);
        mine.set(e.id, m);
      }
    }
    return [...mine.values()]
      .map((m) => {
        const z = zOf(data.norm, data.lineFor(m.e.id, m.e.line));
        return { ...m, left: m.plays.size, value: m.plays.size * targets.reduce((s, c) => s + z[c], 0) };
      })
      .sort((a, b) => a.left - b.left || a.value - b.value);
  };

  // The player I would drop for a streamer: the one I chose, or until I choose, the one with the fewest games left
  const dropChoice = () => {
    const stored = storedDrop();
    const rows = ranked();
    if (stored === '') return null;
    return rows.find((r) => r.e.id === stored)?.e.id ?? rows[0]?.e.id ?? null;
  };

  const chooseDrop = (id) => {
    localStorage.setItem(dropKey(), dropChoice() === id ? '' : id);
    state.sim = null;
    state.viewMemo = null;
    render();
  };

  const gamesFrom = (view, from) => view.days.filter((d) => d.n >= from).reduce((s, d) => s + d.me.eff, 0);

  // What adding him (and dropping that player) does to my week: net games from the chosen day on, and expected categories won
  const netOf = (c, drop, from) => {
    const key = `${c.id}|${drop}|${from}`;
    if (!netMemo.has(key)) {
      const view = build(state.raw, { add: { id: c.id, scorer: c.scorer }, drop, from });
      netMemo.set(key, { net: gamesFrom(view, from) - gamesFrom(state.data, from), cats: view.cats - state.data.cats, deltas: deltasOf(view) });
    }
    return netMemo.get(key);
  };

  // Adding him: dropping the player I chose, or nobody when a roster spot is free (or I chose none)
  const planFor = (c) => {
    if (c.plan !== undefined) return c.plan;
    const from = fromDay();
    const mine = new Map((state.data.days.find((d) => d.kind !== 'past')?.me.entries ?? []).map((e) => [e.id, e]));
    const free = (state.data.spots?.free ?? 0) > 0;
    const drop = free ? null : dropChoice();
    const gone = drop && mine.get(drop);
    c.plan = { drop: gone ? drop : null, dropName: gone ? (gone.scorer.shortName ?? gone.scorer.name) : null, ...netOf(c, gone ? drop : null, from) };
    return c.plan;
  };

  const setSim = (sim) => {
    state.sim = sim;
    state.viewMemo = null;
    render();
  };

  // The roster as the simulation leaves it (the real one when none is on)
  const getView = () => {
    const { data, sim } = state;
    if (!sim) return data;
    const from = fromDay();
    const key = `${sim.id}|${sim.drop}|${from}`;
    if (state.viewMemo?.key !== key) state.viewMemo = { key, view: build(state.raw, { add: { id: sim.id, scorer: sim.scorer }, drop: sim.drop, from }) };
    return state.viewMemo.view;
  };

  // Two lines: who he is and what adding him nets me (games, expected categories), then his schedule and who goes.
  // Tap for the rest: game times, stats, impact and the add / drop tests.
  const card = (c, swap, claimsLeft) => {
    const sc = c.scorer;
    const plan = planFor(c);
    const meta = [c.line.MIN != null && `${c.line.MIN.toFixed(0)} min`, c.line.GP != null && `${c.line.GP} GP`].filter(Boolean).join(' · ');
    const open = state.simFor === c.id;
    const net = plan?.net ?? c.gained;
    return h(
      'article',
      {
        class: `fx-an__card${open ? ' is-open' : ''}${net <= 0 ? ' is-weak' : ''}`,
        'data-st': c.fa ? 'FA' : 'W',
        onclick: (e) => {
          if (e.target.closest('button, .fx-an__who, .fx-an__panel')) return;
          state.simFor = open ? null : c.id;
          render();
        },
      },
      h(
        'div',
        { class: 'fx-an__top' },
        h(
          'button',
          {
            type: 'button',
            class: `fx-an__add${claimsLeft === 0 ? ' is-off' : ''}`,
            title: claimsLeft === 0 ? 'No claims left this week' : c.sta,
            'aria-label': 'Add player',
            onclick: (e) => {
              e.stopPropagation();
              openPlayer(sc, 'add');
            },
          },
          h('mat-icon', { class: 'material-icons' }, 'add'),
        ),
        photo(sc, c.inj),
        h(
          'div',
          { class: 'fx-an__who', onclick: () => openPlayer(sc, 'card') },
          h('b', null, sc.shortName ?? sc.name),
          h(
            'small',
            null,
            `${sc.posShortNames ?? ''} - ${sc.teamShortName ?? ''}`,
            c.ros != null && h('em', null, `${c.ros}%`, c.trend ? h('u', { class: c.trend > 0 ? 'is-up' : 'is-down' }, `${c.trend > 0 ? '▲' : '▼'}${Math.abs(c.trend)}`) : null),
            c.inj && (c.inj.back || c.inj.code === 'O') && h('em', { class: 'is-hurt' }, c.inj.back ? `back ${c.inj.back}` : 'out'),
          ),
        ),
        h('div', { class: 'fx-an__gain', title: 'Net games: games he adds from the chosen day on, minus the games of the player dropped for him' }, h('b', null, signed(net)), h('small', null, 'net games')),
        plan && state.data.outlook.length > 0 && h('div', { class: 'fx-an__gain fx-an__delta', title: 'Change in expected categories won' }, h('b', { class: plan.cats > 0.05 ? 'is-up' : plan.cats < -0.05 ? 'is-down' : '' }, signed(plan.cats, 1)), h('small', null, 'cats')),
      ),
      h('div', { class: 'fx-an__line2' }, pipsView(c), h('span', null, plan?.drop ? `drop ${plan.dropName}` : 'add only'), h('i', { class: 'fx-an__chev' }, open ? '▴' : '▾')),
      open &&
        h(
          'div',
          { class: 'fx-an__detail' },
          h('div', { class: 'fx-an__when' }, c.games.map((g) => h('span', null, gameText(g)))),
          statsGrid(c.line, state.targets, c.z),
          h(
            'div',
            { class: 'fx-an__foot' },
            h('span', { title: 'Games added × how much he gives in the target categories' }, 'Impact ', h('b', { class: c.impact > 0 ? 'is-up' : c.impact < 0 ? 'is-down' : '' }, signed(c.impact, 1))),
            c.helps.length > 0 && h('span', null, 'helps ', h('b', null, c.helps.join(' · '))),
            meta && h('span', null, meta),
          ),
          state.data.outlook.length > 0 &&
            plan &&
            h(
              'button',
              {
                type: 'button',
                class: 'fx-an__plan',
                'aria-pressed': String(state.sim?.id === c.id),
                title: 'Apply this move on paper: the week above shows the result',
                onclick: () => setSim(state.sim?.id === c.id ? null : { id: c.id, scorer: c.scorer, drop: plan.drop, dropName: plan.dropName }),
              },
              h('b', null, `${plan.drop ? `Drop ${plan.dropName}` : 'Add only'}: net ${signed(plan.net)} ${Math.abs(plan.net) === 1 ? 'game' : 'games'}`),
              changesLine(plan.deltas),
            ),
        ),
    );
  };

  const poolView = (data) => {
    const days = [...state.sel].sort((a, b) => a - b).map(dayOfN).filter(Boolean);
    if (!days.length) return h('p', { class: 'fx-an__hint' }, 'Tap days to see the free agents who fit your open slots. Pick several to see who plays on any or all of them.');
    const single = days.length === 1;
    const title = h('h3', null, days.map((d) => (single ? `${d.weekday} ${d.mon} ${d.dom}` : `${d.weekday} ${d.dom}`)).join(' + '));
    const section = (...kids) => h('section', { class: 'fx-an__pool' }, title, ...kids);
    const found = candidates();
    if (!found) return section(skeleton(4, true));
    const { list: all, swap } = found;
    const list = sortAndFilter(all);
    const shown = list.slice(0, state.k);
    const left = data.claims?.left;
    const note = left === 0 ? h('p', { class: 'fx-an__warn' }, 'No claims left this week.') : null;
    const swapNote = swap ? h('p', { class: 'fx-an__hint is-tight' }, 'No open slot on these days: the numbers assume you drop the player chosen above.') : null;
    const empty = !list.length ? h('p', { class: 'fx-an__hint' }, all.length ? 'No free agent matches these filters.' : 'No free agent plays on these days.') : null;
    return section(
      note,
      swapNote,
      controls(!single),
      h('p', { class: 'fx-an__legend' }, h('i', { class: 'on' }), swap ? ' plays' : ' fits', swap ? null : [h('i', { class: 'full' }), ' no slot'], h('i', { class: 'next' }), ' next wk', h('i', { class: 'out' }), ' injured', h('span', null, `${list.length}`)),
      empty,
      h('div', { class: 'fx-an__cards' }, shown.map((c) => card(c, swap, left))),
      list.length > shown.length && h('button', { type: 'button', class: 'fx-an__more', onclick: () => ((state.k += STEP), render()) }, `Show ${Math.min(STEP, list.length - shown.length)} more`),
    );
  };

  // The player I would drop for a streamer; the "net games" on every card assume he goes. One choice, remembered on
  // this device (Edit lists my whole roster)
  const dropView = () => {
    const rows = ranked();
    if (!rows.length) return null;
    const pick = dropChoice();
    const edit = state.editDrop;
    const shown = edit ? rows : rows.filter((r) => r.e.id === pick);
    const name = (r) => r.e.scorer.shortName ?? r.e.scorer.name;
    const chip = (r) =>
      edit
        ? h('button', { type: 'button', class: 'fx-an__tog', 'aria-pressed': String(r.e.id === pick), onclick: () => chooseDrop(r.e.id) }, name(r), h('i', null, `${r.left}g`))
        : h('span', { class: 'fx-an__tog', 'aria-pressed': 'true' }, name(r), h('i', null, `${r.left}g`));
    return h(
      'section',
      { class: 'fx-an__drops' },
      h('h3', null, 'Drop', h('span', null, storedDrop() ? 'the player I would drop · games left' : 'suggested · tap Edit to choose')),
      h(
        'div',
        { class: 'fx-an__dropchips' },
        shown.map(chip),
        shown.length === 0 && h('span', { class: 'fx-an__none' }, 'No one: adds assume a free roster spot'),
        h('button', { type: 'button', class: 'fx-an__tog fx-an__edit', 'aria-pressed': 'false', onclick: () => ((state.editDrop = !edit), render()) }, edit ? 'Done' : 'Edit'),
      ),
    );
  };

  const render = () => {
    if (!root || !document.body.classList.contains(OPEN)) return;
    const { data, loading, error } = state;
    const body = [...head(data)];
    if (data) {
      const view = getView();
      body.push(stickyView(view), stripView(view), outlookView(view), dropView(), poolView(data));
    }
    if (loading && !data) body.push(skeleton(5));
    if (error && !data) body.push(h('p', { class: 'fx-an__hint' }, 'Could not load the matchup. Tap refresh to try again.'));
    const scroll = root.scrollTop;
    const rows = [...root.querySelectorAll('.fx-an__chips, .fx-an__catscroll')].map((el) => el.scrollLeft);
    const keep = document.activeElement?.getAttribute?.('data-keep');
    const caret = keep ? document.activeElement.selectionStart : 0;
    root.replaceChildren(...body.filter(Boolean));
    root.scrollTop = scroll;
    root.querySelectorAll('.fx-an__chips, .fx-an__catscroll').forEach((el, i) => (el.scrollLeft = rows[i] ?? 0));
    if (keep) {
      const input = root.querySelector(`[data-keep="${keep}"]`);
      input?.focus();
      input?.setSelectionRange?.(caret, caret);
    }
  };

  const selectDay = (n) => {
    if (!state.sel.delete(n)) state.sel.add(n);
    state.k = STEP;
    fetchSelected();
    render();
  };

  const toggleTarget = (c) => {
    state.manual = true;
    if (!state.targets.delete(c)) state.targets.add(c);
    render();
  };

  const refresh = async (force) => {
    if (state.loading || (!force && state.data && Date.now() - state.at < TTL_MS)) return;
    state.loading = true;
    state.error = null;
    render();
    try {
      state.raw = await load();
      state.data = build(state.raw, null);
      state.at = Date.now();
      const valid = state.data.days.filter((d) => d.kind !== 'past').map((d) => d.n);
      state.sel = new Set([...state.sel].filter((n) => valid.includes(n)));
      if (!state.sel.size && valid.length) state.sel.add(valid[0]);
      if (!state.manual) state.targets = new Set(state.data.outlook.filter((o) => o.state !== 'win').map((o) => o.c));
      state.sim = null;
      state.simFor = null;
      state.viewMemo = null;
      faCache.clear();
      fitMemo.clear();
      netMemo.clear();
      fetchSelected();
    } catch {
      state.error = true;
    } finally {
      state.loading = false;
      render();
    }
  };

  // ---- Player card ----
  // The card is a Fantrax dialog that only its own name links can open, so the Players page does it: find the
  // player there (searching by name when the list does not show him), click his name and let the dialog appear above
  // this page. Leaving the analyzer afterwards returns to the page it was opened from.

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms) => {
    for (const end = Date.now() + ms; Date.now() < end; await wait(100)) {
      const v = fn();
      if (v) return v;
    }
    return null;
  };

  const rowIdOf = (row) => row.querySelector('.scorer__image')?.style.backgroundImage.match(/\/hs(\w+?)_/)?.[1];
  const playerRow = (id) => [...document.querySelectorAll('app-league-players .i-table__body .i-table__row')].find((r) => rowIdOf(r) === id);
  const nameLink = (row) => row?.querySelector('.scorer__info__name a');
  const addButton = (row) => [...(row?.querySelectorAll('player-tx button') ?? [])].find((b) => b.querySelector('mat-icon')?.textContent.trim() === 'add');
  const searchBox = () => document.querySelector('app-league-players input.mat-mdc-input-element');
  const onPlayers = () => /\/players(;|\/?$)/.test(location.pathname);
  // matrix parameters (;searchName=...) come and go with the Players page filters, so they are not part of the route
  const route = () => location.pathname.replace(/;.*$/, '') + location.search;

  const search = (input, text) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    for (const type of ['keydown', 'keypress', 'keyup']) input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  };

  // The Players page should not stay filtered on this player, but refreshing its list under the card would close it
  const clearSearchWhenClosed = async () => {
    while (document.querySelector('player-profile-content, player-tx-toast')) await wait(500);
    if (searchBox()?.value) search(searchBox(), '');
  };

  let driving = false;
  let origin = null; // route to go back to when the analyzer closes after the Players page was opened for a card

  // action: 'card' opens the player card, 'add' starts Fantrax's own claim (the Claim toast with Submit / Continue to Drop)
  const openPlayer = async (scorer, action) => {
    if (driving) return;
    driving = true;
    root?.classList.add('is-opening');
    try {
      if (!onPlayers()) {
        origin = route();
        document.querySelector('.nav-mobile-menu__button[href$="/players"]')?.click();
        if (!(await until(() => onPlayers() && searchBox(), 10000))) return;
      }
      const target = () => {
        const row = playerRow(scorer.scorerId);
        return action === 'add' ? addButton(row) : nameLink(row);
      };
      let el = target();
      if (!el) {
        search(searchBox(), scorer.name);
        el = await until(target, 6000);
      }
      if (!el) return;
      el.click();
      const shown = action === 'add' ? 'player-tx-toast' : 'player-profile-content';
      if (await until(() => document.querySelector(shown), 6000)) clearSearchWhenClosed();
    } finally {
      driving = false;
      lastRoute = route();
      root?.classList.remove('is-opening');
    }
  };

  // Back to the page the analyzer was opened from (only if the card opener moved the app away from it)
  const restoreOrigin = () => {
    const back = origin;
    origin = null;
    if (!back || back === route()) return;
    const path = back.split('?')[0].replace(/\/$/, '');
    const link = [...document.querySelectorAll('.nav-mobile-menu__button')].find((a) => !a.classList.contains('fx-analyzer-btn') && path.endsWith(a.getAttribute('href') ?? '\0'));
    driving = true;
    link?.click();
    setTimeout(() => {
      driving = false;
      lastRoute = route();
    }, 500);
  };

  // ---- Page + nav button ----

  const open = () => {
    if (!root) {
      root = h('div', { id: 'fx-analyzer' });
      document.body.append(root);
    }
    document.body.classList.add(OPEN);
    syncNav();
    render();
    refresh(false);
  };

  const close = () => {
    document.body.classList.remove(OPEN);
    syncNav();
  };

  const syncNav = () => {
    const btn = document.querySelector('.fx-analyzer-btn');
    if (btn) btn.classList.toggle('current', document.body.classList.contains(OPEN));
  };

  const ensureButton = () => {
    const bar = document.querySelector('nav-mobile-menu .nav-mobile-menu__bar');
    if (!bar || bar.querySelector('.fx-analyzer-btn')) return;
    const after = bar.querySelector('a[href$="/livescoring"]') ?? bar.querySelector('a.nav-mobile-menu__button');
    if (!after) return;
    const btn = h(
      'a',
      { class: 'mat-ripple nav-mobile-menu__button fx-analyzer-btn', href: '#' },
      h('mat-icon', { class: 'mat-icon notranslate material-icons mat-ligature-font mat-icon-no-color', role: 'img', 'aria-hidden': 'true' }, 'query_stats'),
      h('b', { role: 'presentation' }, 'Analyzer'),
    );
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (document.body.classList.contains(OPEN)) {
        close();
        restoreOrigin();
      } else {
        open();
      }
    });
    after.after(btn);
    syncNav();
  };

  // Any other nav button leaves the analyzer; Fantrax navigates as usual
  document.addEventListener(
    'click',
    (e) => {
      if (driving || !document.body.classList.contains(OPEN) || !(e.target instanceof Element)) return;
      const target = e.target.closest('.nav-mobile-menu__button, .nav-mobile-menu__league');
      if (target && !target.classList.contains('fx-analyzer-btn')) {
        origin = null;
        close();
      }
    },
    true,
  );

  let lastRoute = route();
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      ensureButton();
      if (route() !== lastRoute) {
        lastRoute = route();
        if (!driving && document.body.classList.contains(OPEN)) {
          origin = null;
          close();
        }
      }
    });
  };

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  setInterval(schedule, 1000);
  schedule();
})();
