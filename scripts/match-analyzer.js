// Match analyzer: an "Analyzer" button in the bottom nav opens a full-screen page for this week's matchup.
//  1. A day strip: player-games per day for my team and my opponent (raw = players with a game, eff = the most of
//     them that fit the active slots), plus how many of my slots stay open that day.
//  2. Tap a day to list the best free agents playing that day who fit one of my open slots (top K, by Fantrax rank).
// Rosters come from getTeamRosterInfo for each day of the week (current lineups, assumed set optimally), the free
// agents from getPlayerStats filtered by the "date playing" filter of the Players page.
(() => {
  if (window.__fxAnalyzer) return;
  window.__fxAnalyzer = true;

  const OPEN = 'fx-analyzer-open';
  const STEP = 10;
  const SPANS = [4, 7]; // days ahead the "Next games" column can cover; "3 in 4" is judged over any 4 days
  const TTL_MS = 60000;
  const DAY_MS = 86400000;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const POS = { 300: 'PG', 301: 'SG', 302: 'G', 303: 'SF', 304: 'PF', 305: 'C', 306: 'F', 307: 'Util' };
  const CATS = ['FG%', 'FT%', '3PTM', 'PTS', 'REB', 'AST', 'ST', 'BLK', 'TO'];
  const UTIL = '307';

  let state = { loading: false, error: null, data: null, sel: new Set(), span: SPANS[0], k: STEP, at: 0 };
  const faCache = new Map(); // day -> { at, rows, header } | { loading: true }
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

  // One team on one day; kind is 'past', 'today' or 'future'
  //   raw   = players (active + bench) with a game, eff = games that count: locked ones + the best fit of the rest
  //   slots = active slots still open to changes, players = those with a game that can still be placed
  const analyse = (data, kind) => {
    const table = data?.tables?.[0];
    const header = table?.header?.cells ?? [];
    const slots = [];
    const players = [];
    let raw = 0;
    let locked = 0;
    for (const row of table?.rows ?? []) {
      const id = row.scorer?.scorerId;
      const active = row.statusId === '1';
      const bench = row.statusId === '2';
      const cell = row.cells?.[row.cells.length - header.length];
      const hasGame = Boolean(id) && (active || bench) && plain(cell?.content) !== '';
      if (hasGame) raw++;
      if (kind === 'past') {
        if (hasGame && active) locked++;
        continue;
      }
      const started = kind === 'today' && hasGame && gameStarted(cell.content);
      if (active) {
        if (started && hasGame) locked++;
        else slots.push(row.posId);
      }
      if (hasGame && !started) players.push(new Set(row.eligiblePosIds ?? []));
    }
    // Specific positions first so that the slots left open are the flexible (Util) ones
    slots.sort((a, b) => (a === UTIL) - (b === UTIL));
    const owner = assign(players, slots);
    const open = slots.filter((_, s) => owner[s] < 0);
    return { raw, eff: locked + owner.filter((o) => o >= 0).length, slots, players, open };
  };

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
    const msgs = [];
    for (const n of periods) {
      for (const t of teams) msgs.push(roster(t, n < today ? { period: String(n), timeframeTypeCode: 'BY_PERIOD' } : { period: String(n) }));
    }
    const extra = Array.from({ length: Math.max(...SPANS) - 1 }, (_, k) => last + 1 + k);
    for (const n of extra) msgs.push(roster(me, { period: String(n) }));
    const res = await call(msgs);
    const dayInfo = (n, kind) => {
      const t = base + (n - 1) * DAY_MS;
      return { n, kind, date: isoDay(t), weekday: WEEKDAYS[new Date(t).getUTCDay()], dom: new Date(t).getUTCDate(), mon: MONTHS[new Date(t).getUTCMonth()] };
    };
    const after = extra.flatMap((n, k) => {
      const data = res[periods.length * teams.length + k];
      return data?.tables ? [{ ...dayInfo(n, 'future'), me: analyse(data, 'future'), opp: null }] : [];
    });
    const days = periods.map((n, i) => {
      const kind = n < today ? 'past' : n === today ? 'today' : 'future';
      return {
        ...dayInfo(n, kind),
        me: analyse(res[i * teams.length], kind),
        opp: opp ? analyse(res[i * teams.length + 1], kind) : null,
      };
    });
    return { me, opp, names, today, days, after, base };
  };

  // ---- Free agents ----

  const fetchPool = async (date) => {
    const hit = faCache.get(date);
    if (hit && (hit.loading || Date.now() - hit.at < TTL_MS)) return;
    faCache.set(date, { loading: true, at: hit?.at ?? 0, rows: hit?.rows, header: hit?.header });
    try {
      const [res] = await call([{ method: 'getPlayerStats', data: { datePlaying: date, maxResultsPerPage: '500', scoringCategoryType: '1' } }]);
      const rows = res?.statsTable ?? [];
      faCache.set(date, { at: Date.now(), rows, header: res?.tableHeader?.cells ?? [], byId: new Map(rows.filter((r) => r.scorer && !r.scorer.team).map((r) => [r.scorer.scorerId, r])) });
    } catch {
      faCache.set(date, { at: Date.now(), rows: [], header: [], byId: new Map(), failed: true });
    }
    render();
  };

  // Slot types a free agent could take on a day without displacing anyone: directly (an open slot) or by moving a
  // rostered player to another slot. Empty when he does not fit that day's lineup.
  const fitTypes = (day, scorer, game) => {
    if (day.kind === 'today' && gameStarted(game)) return [];
    const me = day.me;
    me.plan ??= { base: matched(me.players, me.slots), types: [...new Set(me.slots)] };
    const elig = new Set(scorer.posIds ?? []);
    return me.plan.types.filter((p) => elig.has(p) && matched([...me.players, new Set([p])], me.slots) > me.plan.base);
  };

  const oppColumn = (pool) => pool.header.findIndex((c) => c.shortName === 'Opp');

  // Free agents playing on every chosen day who fit one of my slots on each of those days (a day without open slots
  // asks nothing of them)
  const candidates = (days, pools) => {
    if (!days.some((d) => d.me.open.length)) return [];
    const maps = pools.map((pool) => pool.byId);
    const out = [];
    for (const [id, row] of maps[0]) {
      const games = [];
      let ok = true;
      for (let i = 0; i < days.length && ok; i++) {
        const r = maps[i].get(id);
        const game = r?.cells?.[oppColumn(pools[i])]?.content;
        if (!r || !plain(game)) ok = false;
        else if (days[i].me.open.length && !fitTypes(days[i], r.scorer, game).length) ok = false;
        else if (days[i].kind === 'today' && gameStarted(game)) ok = false;
        else games.push(plain(game));
      }
      if (ok) out.push({ row, games });
    }
    return out.sort((a, b) => (a.row.scorer.rank ?? 1e9) - (b.row.scorer.rank ?? 1e9));
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

  // Open slots with their count: "C · Util ×2"
  const openLabel = (ids) => {
    const counts = new Map();
    for (const p of ids) counts.set(p, (counts.get(p) ?? 0) + 1);
    return [...counts].map(([p, n]) => `${POS[p] ?? p}${n > 1 ? ` ×${n}` : ''}`).join(' · ');
  };

  const stripView = (data) => {
    const { days, names } = data;
    const total = (team, key) => days.reduce((s, d) => s + (d[team]?.[key] ?? 0), 0);
    const th = (d) =>
      h(
        'th',
        { class: `fx-an__day${state.sel.has(d.n) ? ' is-sel' : ''}${d.kind === 'past' ? ' is-past' : ''}${d.kind === 'today' ? ' is-today' : ''}` },
        h('button', { type: 'button', disabled: d.kind === 'past', onclick: () => selectDay(d.n) }, h('span', null, d.weekday), h('b', null, String(d.dom))),
      );
    const cell = (d, team) => {
      const t = d[team];
      return h('td', { class: `fx-an__cell${state.sel.has(d.n) ? ' is-sel' : ''}${d.kind === 'past' ? ' is-past' : ''}` }, h('b', null, String(t.raw)), h('small', null, String(t.eff)));
    };
    const rows = [
      h('tr', { class: 'fx-an__me' }, h('th', { scope: 'row' }, h('b', null, names[data.me] ?? 'Me'), h('small', null, 'games / in slots')), days.map((d) => cell(d, 'me')), h('td', { class: 'fx-an__total' }, h('b', null, String(total('me', 'raw'))), h('small', null, String(total('me', 'eff'))))),
    ];
    if (data.opp) {
      rows.push(h('tr', { class: 'fx-an__opp' }, h('th', { scope: 'row' }, h('b', null, names[data.opp] ?? 'Opp'), h('small', null, 'games / in slots')), days.map((d) => cell(d, 'opp')), h('td', { class: 'fx-an__total' }, h('b', null, String(total('opp', 'raw'))), h('small', null, String(total('opp', 'eff'))))));
    }
    rows.push(
      h(
        'tr',
        { class: 'fx-an__free' },
        h('th', { scope: 'row' }, h('b', null, 'Open slots'), h('small', null, 'I can still fill')),
        days.map((d) =>
          h('td', { class: `fx-an__cell${state.sel.has(d.n) ? ' is-sel' : ''}${d.kind === 'past' ? ' is-past' : ''}` }, d.kind === 'past' ? h('b', null, '–') : h('b', { class: d.me.open.length ? 'has-open' : '' }, String(d.me.open.length))),
        ),
        h('td', { class: 'fx-an__total' }, h('b', null, String(days.reduce((s, d) => s + (d.kind === 'past' ? 0 : d.me.open.length), 0)))),
      ),
    );
    return h('div', { class: 'fx-an__strip' }, h('table', null, h('thead', null, h('tr', null, h('th'), days.map(th), h('th', { class: 'fx-an__totalh' }, 'Total'))), h('tbody', null, rows)));
  };

  const gameOpp = (text) => text.replace(/\s+(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\w*\s+\d{1,2}:\d{2}\s*[AP]M.*$/i, '');

  const scheduleCell = (scorer, win) => {
    const sch = gamesOver(scorer, win);
    if (!sch) return h('td', { class: 'fx-an__sched' }, '…');
    const tags = [sch.b2b && 'B2B', sch.dense && '3 in 4'].filter(Boolean);
    const label = state.span > 4 || !tags.length ? [`${sch.games} ${sch.games === 1 ? 'game' : 'games'}`, ...tags] : tags;
    return h(
      'td',
      { class: 'fx-an__sched', title: `${sch.games} games in the next ${state.span} days: blue = fits my lineup, red = plays but no slot for him` },
      h('div', { class: 'fx-an__pips' }, win.map((w, i) => h('span', { class: sch.days[i].fits ? 'on' : sch.days[i].plays ? 'full' : '' }, w.label))),
      h('small', null, label.join(' · ')),
    );
  };

  const poolView = (data) => {
    const days = data.days.filter((d) => state.sel.has(d.n));
    if (!days.length) return h('p', { class: 'fx-an__hint' }, 'Tap days to see the free agents who fit your open slots. Pick several to see who plays on all of them.');
    const single = days.length === 1;
    const open = days.map((d) => d.me.open.length);
    const info = single ? (open[0] ? `${open[0]} open: ${openLabel(days[0].me.open)}` : 'lineup full') : `Open: ${days.map((d, i) => `${d.weekday} ${open[i]}`).join(' · ')}`;
    const title = h('h3', null, days.map((d) => (single ? `${d.weekday} ${d.mon} ${d.dom}` : `${d.weekday} ${d.dom}`)).join(' + '), h('span', null, info));
    const section = (...kids) => h('section', { class: 'fx-an__pool' }, title, ...kids);
    if (!open.some((n) => n)) return section(h('p', { class: 'fx-an__hint' }, single ? 'Every active slot is already filled by a player with a game.' : 'No open slots on these days.'));
    const pools = days.map((d) => faCache.get(d.date));
    if (pools.some((pool) => !pool?.rows)) return section(h('p', { class: 'fx-an__hint' }, 'Loading free agents…'));
    const list = candidates(days, pools);
    const shown = list.slice(0, state.k);
    if (!list.length) return section(h('p', { class: 'fx-an__hint' }, single ? 'No free agent playing that day fits an open slot.' : 'No free agent plays on all these days and fits an open slot.'));
    const pool = pools[0];
    const win = windowDays();

    const col = (name) => pool.header.findIndex((c) => c.shortName === name);
    const cats = CATS.filter((c) => col(c) >= 0);
    const head = h('tr', null, h('th', null, 'Player'), h('th', null, 'Opp'), h('th', null, 'Next games'), cats.map((c) => h('th', null, c)));
    const body = shown.map(({ row, games }) => {
      const sc = row.scorer;
      const sta = plain(row.cells[col('Sta')]?.content);
      return h(
        'tr',
        { 'data-st': /^FA/i.test(sta) ? 'FA' : 'W' },
        h(
          'td',
          { class: 'fx-an__player', onclick: () => openPlayer(sc, 'card') },
          h(
            'button',
            {
              type: 'button',
              class: 'fx-an__add',
              title: sta,
              'aria-label': 'Add player',
              onclick: (e) => {
                e.stopPropagation();
                openPlayer(sc, 'add');
              },
            },
            h('mat-icon', { class: 'material-icons' }, 'add'),
          ),
          h('img', { src: sc.headshotUrl ?? '', alt: '', loading: 'lazy' }),
          h('div', null, h('b', null, sc.shortName ?? sc.name), h('small', null, `${sc.posShortNames ?? ''} - ${sc.teamShortName ?? ''}`)),
        ),
        h('td', { class: 'fx-an__game' }, single ? gameOpp(games[0]) : games.map((g, i) => h('div', null, `${days[i].weekday.slice(0, 2)} ${gameOpp(g)}`))),
        scheduleCell(sc, win),
        cats.map((c) => h('td', null, plain(row.cells[col(c)]?.content))),
      );
    });
    return section(
      h(
        'p',
        { class: 'fx-an__legend' },
        h('i', { class: 'on' }),
        ' fits my lineup',
        h('i', { class: 'full' }),
        ' plays, no slot for him',
        h(
          'span',
          { class: 'fx-an__span', role: 'group', 'aria-label': 'Next games span' },
          SPANS.map((n) =>
            h(
              'button',
              {
                type: 'button',
                'aria-pressed': String(state.span === n),
                onclick: () => {
                  state.span = n;
                  fetchSelected();
                  render();
                },
              },
              `${n}d`,
            ),
          ),
        ),
      ),
      h('div', { class: 'fx-an__scroll' }, h('table', null, h('thead', null, head), h('tbody', null, body))),
      list.length > shown.length && h('button', { type: 'button', class: 'fx-an__more', onclick: () => ((state.k += STEP), render()) }, `Show ${Math.min(STEP, list.length - shown.length)} more`),
    );
  };

  const render = () => {
    if (!root || !document.body.classList.contains(OPEN)) return;
    const { data, loading, error } = state;
    const range = data ? `${data.days[0].mon} ${data.days[0].dom} - ${data.days[data.days.length - 1].mon} ${data.days[data.days.length - 1].dom}` : '';
    const body = [
      h('header', { class: 'fx-an__head' }, h('h2', null, 'Analyzer'), h('span', null, range), h('button', { type: 'button', 'aria-label': 'Refresh', onclick: () => refresh(true) }, h('mat-icon', { class: 'material-icons' }, 'refresh'))),
    ];
    if (data) body.push(stripView(data), poolView(data));
    if (loading && !data) body.push(h('p', { class: 'fx-an__hint' }, 'Loading the week…'));
    if (error && !data) body.push(h('p', { class: 'fx-an__hint' }, 'Could not load the matchup. Tap refresh to try again.'));
    const scroll = root.scrollTop;
    const strip = root.querySelector('.fx-an__scroll');
    const left = strip ? strip.scrollLeft : 0;
    root.replaceChildren(...body);
    root.scrollTop = scroll;
    const next = root.querySelector('.fx-an__scroll');
    if (next) next.scrollLeft = left;
  };

  const selectDay = (n) => {
    if (!state.sel.delete(n)) state.sel.add(n);
    state.k = STEP;
    fetchSelected();
    render();
  };

  // The days of the chosen span, always counted from today whatever days are selected: [{ date, label, day }]
  const windowDays = () => {
    const { data } = state;
    if (!data) return [];
    return Array.from({ length: state.span }, (_, k) => {
      const t = data.base + (data.today - 1 + k) * DAY_MS;
      const date = isoDay(t);
      return { date, label: WEEKDAYS[new Date(t).getUTCDay()].slice(0, 2), day: [...data.days, ...data.after].find((d) => d.date === date) };
    });
  };

  const fetchSelected = () => {
    for (const d of state.data?.days ?? []) if (state.sel.has(d.n)) fetchPool(d.date);
    for (const w of windowDays()) fetchPool(w.date);
  };

  // One player over the window: per day whether he plays and whether he fits my lineup that day, back-to-back,
  // and the number of games
  const gamesOver = (scorer, win) => {
    const pools = win.map((w) => faCache.get(w.date));
    if (pools.some((pool) => !pool?.byId)) return null;
    const days = pools.map((pool, i) => {
      const row = pool.byId.get(scorer.scorerId);
      const game = row?.cells?.[oppColumn(pool)]?.content;
      const plays = Boolean(row) && plain(game) !== '';
      // a day outside the loaded rosters counts as a fit
      const fits = plays && (!win[i].day || fitTypes(win[i].day, scorer, game).length > 0);
      return { plays, fits };
    });
    const games = days.filter((d) => d.plays).length;
    const dense = days.some((_, i) => days.slice(i, i + 4).filter((d) => d.plays).length >= 3);
    return { days, games, dense, b2b: days.some((d, i) => d.plays && days[i + 1]?.plays) };
  };

  const refresh = async (force) => {
    if (state.loading || (!force && state.data && Date.now() - state.at < TTL_MS)) return;
    state.loading = true;
    state.error = null;
    render();
    try {
      state.data = await load();
      state.at = Date.now();
      const valid = state.data.days.filter((d) => d.kind !== 'past').map((d) => d.n);
      state.sel = new Set([...state.sel].filter((n) => valid.includes(n)));
      if (!state.sel.size && valid.length) state.sel.add(valid[0]);
      faCache.clear();
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
