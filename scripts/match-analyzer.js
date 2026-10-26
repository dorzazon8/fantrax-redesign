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
  const TTL_MS = 60000;
  const DAY_MS = 86400000;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const POS = { 300: 'PG', 301: 'SG', 302: 'G', 303: 'SF', 304: 'PF', 305: 'C', 306: 'F', 307: 'Util' };
  const CATS = ['FG%', 'FT%', '3PTM', 'PTS', 'REB', 'AST', 'ST', 'BLK', 'TO'];
  const UTIL = '307';

  let state = { loading: false, error: null, data: null, day: null, k: STEP, at: 0 };
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
    const res = await call(msgs);
    const days = periods.map((n, i) => {
      const kind = n < today ? 'past' : n === today ? 'today' : 'future';
      const t = base + (n - 1) * DAY_MS;
      return {
        n,
        kind,
        date: isoDay(t),
        weekday: WEEKDAYS[new Date(t).getUTCDay()],
        dom: new Date(t).getUTCDate(),
        mon: MONTHS[new Date(t).getUTCMonth()],
        me: analyse(res[i * teams.length], kind),
        opp: opp ? analyse(res[i * teams.length + 1], kind) : null,
      };
    });
    return { me, opp, names, today, days };
  };

  // ---- Free agents ----

  const fetchPool = async (date) => {
    const hit = faCache.get(date);
    if (hit && (hit.loading || Date.now() - hit.at < TTL_MS)) return;
    faCache.set(date, { loading: true, at: hit?.at ?? 0, rows: hit?.rows, header: hit?.header });
    try {
      const [res] = await call([{ method: 'getPlayerStats', data: { datePlaying: date, maxResultsPerPage: '200', scoringCategoryType: '1' } }]);
      faCache.set(date, { at: Date.now(), rows: res?.statsTable ?? [], header: res?.tableHeader?.cells ?? [] });
    } catch {
      faCache.set(date, { at: Date.now(), rows: [], header: [], failed: true });
    }
    render();
  };

  // Free agents playing on the day who fit one of my open slots: directly (fits lists the open slot types they are
  // eligible for) or by moving a rostered player to another slot (no fits listed)
  const candidates = (day, pool) => {
    const { slots, players, open } = day.me;
    if (!open.length) return [];
    const base = matched(players, slots);
    const types = [...new Set(slots)];
    const openTypes = new Set(open);
    const out = [];
    for (const row of pool.rows) {
      const sc = row.scorer;
      if (!sc || sc.team) continue;
      const opp = pool.header.findIndex((c) => c.shortName === 'Opp');
      const game = row.cells?.[opp]?.content;
      if (!plain(game)) continue;
      if (day.kind === 'today' && gameStarted(game)) continue;
      const elig = new Set(sc.posIds ?? []);
      const fits = types.filter((p) => elig.has(p) && matched([...players, new Set([p])], slots) > base);
      if (fits.length) out.push({ row, fits: fits.filter((p) => openTypes.has(p)) });
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

  const posLabel = (ids) => [...new Set(ids)].map((p) => POS[p] ?? p).join(' · ');

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
        { class: `fx-an__day${d.n === state.day ? ' is-sel' : ''}${d.kind === 'past' ? ' is-past' : ''}${d.kind === 'today' ? ' is-today' : ''}` },
        h('button', { type: 'button', disabled: d.kind === 'past', onclick: () => selectDay(d.n) }, h('span', null, d.weekday), h('b', null, String(d.dom))),
      );
    const cell = (d, team) => {
      const t = d[team];
      return h('td', { class: `fx-an__cell${d.n === state.day ? ' is-sel' : ''}${d.kind === 'past' ? ' is-past' : ''}` }, h('b', null, String(t.raw)), h('small', null, String(t.eff)));
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
          h('td', { class: `fx-an__cell${d.n === state.day ? ' is-sel' : ''}${d.kind === 'past' ? ' is-past' : ''}` }, d.kind === 'past' ? h('b', null, '–') : h('b', { class: d.me.open.length ? 'has-open' : '' }, String(d.me.open.length))),
        ),
        h('td', { class: 'fx-an__total' }, h('b', null, String(days.reduce((s, d) => s + (d.kind === 'past' ? 0 : d.me.open.length), 0)))),
      ),
    );
    return h('div', { class: 'fx-an__strip' }, h('table', null, h('thead', null, h('tr', null, h('th'), days.map(th), h('th', { class: 'fx-an__totalh' }, 'Total'))), h('tbody', null, rows)));
  };

  const poolView = (data) => {
    const day = data.days.find((d) => d.n === state.day);
    if (!day) return h('p', { class: 'fx-an__hint' }, 'Tap a day to see the free agents who fit your open slots.');
    const title = h('h3', null, `${day.weekday} ${day.mon} ${day.dom}`, h('span', null, day.me.open.length ? `${day.me.open.length} open: ${openLabel(day.me.open)}` : 'lineup full'));
    const pool = faCache.get(day.date);
    if (!day.me.open.length) return h('section', { class: 'fx-an__pool' }, title, h('p', { class: 'fx-an__hint' }, 'Every active slot is already filled by a player with a game.'));
    if (!pool?.rows) return h('section', { class: 'fx-an__pool' }, title, h('p', { class: 'fx-an__hint' }, 'Loading free agents…'));
    const list = candidates(day, pool);
    const shown = list.slice(0, state.k);
    if (!list.length) return h('section', { class: 'fx-an__pool' }, title, h('p', { class: 'fx-an__hint' }, 'No free agent playing that day fits an open slot.'));

    const col = (name) => pool.header.findIndex((c) => c.shortName === name);
    const cats = CATS.filter((c) => col(c) >= 0);
    const head = h('tr', null, h('th', null, 'Player'), h('th', null, 'Game'), h('th', null, 'Fits'), h('th', null, 'Rk'), h('th', null, 'Sta'), cats.map((c) => h('th', null, c)));
    const body = shown.map(({ row, fits }) => {
      const sc = row.scorer;
      const sta = plain(row.cells[col('Sta')]?.content);
      return h(
        'tr',
        { 'data-st': /^FA/i.test(sta) ? 'FA' : 'W' },
        h(
          'td',
          { class: 'fx-an__player', onclick: () => openCard(sc) },
          h('img', { src: sc.headshotUrl ?? '', alt: '', loading: 'lazy' }),
          h('div', null, h('b', null, sc.shortName ?? sc.name), h('small', null, `${sc.posShortNames ?? ''} - ${sc.teamShortName ?? ''}`)),
        ),
        h('td', { class: 'fx-an__game' }, plain(row.cells[col('Opp')]?.content)),
        h('td', { class: 'fx-an__fits' }, fits.length ? posLabel(fits) : 'Shuffle'),
        h('td', null, String(sc.rank ?? '')),
        h('td', null, sta),
        cats.map((c) => h('td', null, plain(row.cells[col(c)]?.content))),
      );
    });
    return h(
      'section',
      { class: 'fx-an__pool' },
      title,
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
    state.day = state.day === n ? null : n;
    state.k = STEP;
    const day = state.data?.days.find((d) => d.n === n);
    if (state.day != null && day) fetchPool(day.date);
    render();
  };

  const refresh = async (force) => {
    if (state.loading || (!force && state.data && Date.now() - state.at < TTL_MS)) return;
    state.loading = true;
    state.error = null;
    render();
    try {
      state.data = await load();
      state.at = Date.now();
      const day = state.data.days.find((d) => d.n === state.day);
      if (!day) state.day = state.data.days.find((d) => d.kind !== 'past')?.n ?? null;
      faCache.clear();
      const sel = state.data.days.find((d) => d.n === state.day);
      if (sel) fetchPool(sel.date);
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
  const nameLink = (id) => [...document.querySelectorAll('app-league-players .i-table__body .i-table__row')].find((r) => rowIdOf(r) === id)?.querySelector('.scorer__info__name a');
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
    while (document.querySelector('player-profile-content')) await wait(500);
    if (searchBox()?.value) search(searchBox(), '');
  };

  let driving = false;
  let origin = null; // route to go back to when the analyzer closes after the Players page was opened for a card

  const openCard = async (scorer) => {
    if (driving) return;
    driving = true;
    root?.classList.add('is-opening');
    try {
      if (!onPlayers()) {
        origin = route();
        document.querySelector('.nav-mobile-menu__button[href$="/players"]')?.click();
        if (!(await until(() => onPlayers() && searchBox(), 10000))) return;
      }
      let link = nameLink(scorer.scorerId);
      if (!link) {
        search(searchBox(), scorer.name);
        link = await until(() => nameLink(scorer.scorerId), 6000);
      }
      if (!link) return;
      link.click();
      if (await until(() => document.querySelector('player-profile-content'), 6000)) clearSearchWhenClosed();
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
