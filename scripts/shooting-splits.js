// Made/attempted shooting splits, which Fantrax's live-scoring data omits (it only has FG% / FT%).
//  - Summary tab: "(M/A)" after FG% and FT% (see CSS ::after on [data-fx-ma]).
//  - Team tables: extra "FGM/FGA" and "FTM/FTA" columns right before FG% and FT%.
//  - Team tables, week range: a "GP/WG" column (games played / games on the schedule this week) in place of
//    Fantrax's GP column, which is always empty there; the Day range has no GP column at all.
// FGM/FGA/FTM/FTA come from getTeamRosterInfo ("Standard" stats) with timeframe BY_PERIOD, where "period" is a
// single day (1 = first day of the season): that day's own stat line, not the year-to-date average the default
// timeframe returns. Day view = one such day, Week view = the sum of the matchup period's days.
// Summary/total values are shown only if their ratio matches the displayed %.
//  - Summary tab: "Matchup Claims: used/limit" under each team's column (see syncClaims).
(() => {
  if (window.__fxShootingSplits) return;
  window.__fxShootingSplits = true;

  const REFRESH_MS = 30000;
  const SETTLED_REFRESH_MS = 600000;
  const ATTR = 'data-fx-ma';
  const COL = 'fx-col';
  const DAY_MS = 86400000;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const SPLITS = {
    'FG%': { made: 'FGM', att: 'FGA', title: 'FGM/FGA' },
    'FT%': { made: 'FTM', att: 'FTA', title: 'FTM/FTA' },
  };

  const cache = new Map(); // `${teamId}|${frameKey}` -> { at, rows, active, bench } (see entryOf / weekEntry)
  const pending = new Set();
  let baseDay = null; // UTC midnight of day period 1

  const leagueId = () => location.pathname.match(/league\/(\w+)/)?.[1];
  const teamIdOf = (header) => header.querySelector('a[href*="teamId="]')?.getAttribute('href').match(/teamId=(\w+)/)?.[1];

  const request = async (method, data) => {
    const res = await fetch(`/fxpa/req?leagueId=${leagueId()}`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ msgs: [{ method, data }], uiv: 3, refUrl: location.href }),
    });
    return (await res.json()).responses?.[0]?.data;
  };

  const call = (data) => request('getTeamRosterInfo', { leagueId: leagueId(), scoringCategoryType: '1', ...data });

  const ensureBase = async (teamId) => {
    if (baseDay != null || pending.has('base')) return;
    pending.add('base');
    try {
      const start = (await call({ teamId, period: '1' }))?.displayedSelections?.displayedStartDate;
      if (start) {
        const d = new Date(start);
        baseDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
        schedule();
      }
    } catch {
      // retried on the next sync
    } finally {
      pending.delete('base');
    }
  };

  const isDayView = () =>
    document.querySelector('.livescoring-mobile-filters pill-group[aria-label="Timeframes"] button')?.classList.contains('mat-sport') ?? false;

  // Roster-API day number (1 = first day of the season) of a calendar day
  const dayIndex = (month, day) => {
    const baseYear = new Date(baseDay).getUTCFullYear();
    for (const year of [baseYear, baseYear + 1]) {
      const t = Date.UTC(year, month, day);
      if (t >= baseDay) return Math.round((t - baseDay) / DAY_MS) + 1;
    }
    return null;
  };

  const dayParams = (n) => ({ period: String(n), timeframeTypeCode: 'BY_PERIOD' });

  // What the page currently shows, as roster-API params: "1 (Oct 20 - Oct 25)" = matchup period, "Tue Oct 20" = one day
  const frame = () => {
    const text = document.querySelector('.livescoring-mobile-filters .mat-mdc-select-value-text')?.textContent.trim() ?? '';
    if (!isDayView()) {
      const period = text.match(/^(\d+)\s*\(/)?.[1];
      if (!period) return null;
      const fr = { key: `w${period}` };
      const range = text.match(/\((\w{3})\s+(\d{1,2})\s*-\s*(\w{3})\s+(\d{1,2})\)/);
      if (!range || baseDay == null) return null;
      const first = dayIndex(MONTHS.indexOf(range[1]), +range[2]);
      const last = dayIndex(MONTHS.indexOf(range[3]), +range[4]);
      if (!first || !last || last < first) return null;
      fr.days = Array.from({ length: last - first + 1 }, (_, i) => first + i);
      return fr;
    }
    const m = text.match(/^(\w{3})\s+(\w{3})\s+(\d{1,2})$/);
    if (!m || baseDay == null) return null;
    const month = MONTHS.indexOf(m[2]);
    const weekday = WEEKDAYS.indexOf(m[1]);
    const baseYear = new Date(baseDay).getUTCFullYear();
    for (const year of [baseYear, baseYear + 1]) {
      const t = Date.UTC(year, month, +m[3]);
      if (t >= baseDay && new Date(t).getUTCDay() === weekday) {
        const n = Math.round((t - baseDay) / DAY_MS) + 1;
        return { key: `d${n}`, params: dayParams(n) };
      }
    }
    return null;
  };

  const fetchRoster = async (teamId, fr) => {
    const table = (await call({ teamId, ...fr.params }))?.tables?.[0];
    if (!table) return [];
    const header = table.header.cells;
    // The table's own totals row has a scorer without an id
    return table.rows
      .filter((r) => r.scorer?.scorerId)
      .map((r) => {
        const offset = header.length - r.cells.length;
        const stats = {};
        header.forEach((c, i) => {
          const v = parseFloat(String(r.cells[i - offset]?.content ?? '').replace(/,/g, ''));
          stats[c.shortName] = Number.isFinite(v) ? v : 0;
        });
        // The Opp cell holds the game of that day (opponent, or the result once it is over); it is empty without a game
        const game = String(r.cells[-offset]?.content ?? '').trim() !== '';
        return { id: r.scorer.scorerId, active: r.statusId === '1', game, stats };
      });
  };

  const entryOf = (rows) => ({ at: Date.now(), rows, active: rows.filter((r) => r.active), bench: rows.filter((r) => !r.active) });

  const refresh = async (teamId, fr) => {
    if (fr.days) return refreshWeek(teamId, fr);
    const key = `${teamId}|${fr.key}`;
    const hit = cache.get(key);
    if (pending.has(key) || (hit && Date.now() - hit.at < REFRESH_MS)) return;
    pending.add(key);
    try {
      cache.set(key, entryOf(await fetchRoster(teamId, fr)));
      schedule();
    } catch {
      cache.set(key, hit ?? entryOf([]));
    } finally {
      pending.delete(key);
    }
  };

  // The roster API has no whole-period totals, so a week is the sum of its days.
  // A player's week line is the sum of all his days, whatever his lineup status was: that is what the Period view
  // shows per player. Fantrax's active / bench totals only add the days spent in that part of the lineup.
  const weekEntry = (days) => {
    const players = new Map();
    for (const row of days.flat()) {
      const sum = players.get(row.id) ?? { id: row.id, active: false, games: 0, stats: {} };
      if (row.game) sum.games++;
      for (const [k, v] of Object.entries(row.stats)) sum.stats[k] = (sum.stats[k] ?? 0) + v;
      players.set(row.id, sum);
    }
    const flat = days.flat();
    return {
      at: Date.now(),
      week: true,
      rows: [...players.values()],
      active: flat.filter((r) => r.active),
      bench: flat.filter((r) => !r.active),
    };
  };

  const refreshWeek = async (teamId, fr) => {
    const key = `${teamId}|${fr.key}`;
    const hit = cache.get(key);
    if (pending.has(key) || (hit && Date.now() - hit.at < REFRESH_MS)) return;
    pending.add(key);
    try {
      const played = (rows) => rows.some((r) => r.active && r.stats.GP > 0);
      const lastPlayed = Math.max(0, ...fr.days.filter((n) => played(cache.get(`${teamId}|d${n}`)?.rows ?? [])));
      const days = await Promise.all(
        fr.days.map(async (n) => {
          const dayKey = `${teamId}|d${n}`;
          const day = cache.get(dayKey);
          const settled = n < lastPlayed - 1;
          if (day && Date.now() - day.at < (settled ? SETTLED_REFRESH_MS : REFRESH_MS)) return day.rows;
          const rows = await fetchRoster(teamId, { params: dayParams(n) });
          cache.set(dayKey, entryOf(rows));
          return rows;
        }),
      );
      cache.set(key, weekEntry(days));
      schedule();
    } catch {
      if (hit) cache.set(key, { ...hit, at: Date.now() });
    } finally {
      pending.delete(key);
    }
  };

  const total = (rows, key) => rows.reduce((s, r) => s + r.stats[key], 0);
  const num = (v) => String(+v.toFixed(1));

  // Returns "M/A" only when a set of players reproduces the displayed %.
  const splitFor = (sets, spec, displayed) => {
    for (const set of sets) {
      const m = total(set, spec.made);
      const a = total(set, spec.att);
      if (a > 0 && Math.abs(m / a - displayed) < 0.0006) return `${num(m)}/${num(a)}`;
    }
    return null;
  };

  // Claims used / allowed in the matchup week, shown as text under each team's column of the Summary tab.
  // Used = the team's executed claims on the matchup's days (transaction history; its "Period" column is the day number).
  // Allowed = used + the team's "Claims Remaining (Week)". Fantrax only reports the remaining claims of the current
  // week, so the text is left out for any other week.
  const CLAIMS_REFRESH_MS = 60000;
  const HISTORY_PAGES = 10;
  const claims = new Map(); // `${frameKey}|${teamIds}` -> { at, byTeam: { [teamId]: [used, allowed] } }

  const fetchClaims = async (ids, fr) => {
    const [first] = fr.days;
    const used = {};
    for (let page = 1; page <= HISTORY_PAGES; page++) {
      const data = await request('getTransactionDetailsHistory', { leagueId: leagueId(), view: 'CLAIM_DROP', pageNumber: String(page) });
      let oldest = Infinity;
      let team = null;
      for (const row of data?.table?.rows ?? []) {
        const cell = (key) => row.cells?.find((c) => c.key === key);
        // a claim + its drop are grouped: only the first row names the team
        if (cell('team')?.teamId) team = cell('team').teamId;
        const day = parseInt(cell('week')?.content, 10);
        if (!Number.isFinite(day)) continue;
        oldest = Math.min(oldest, day);
        if (row.transactionCode === 'CLAIM' && row.executed && team && fr.days.includes(day)) used[team] = (used[team] ?? 0) + 1;
      }
      if (oldest < first || page >= (data?.paginatedResultSet?.totalNumPages ?? 1)) break;
    }
    const byTeam = {};
    await Promise.all(
      ids.map(async (id) => {
        const roster = await call({ teamId: id });
        const left = roster?.miscData?.transactionInfo?.info?.find((i) => /^claims remaining/i.test(i.name))?.value;
        const today = Number(roster?.displayedSelections?.displayedPeriod);
        if (Number.isFinite(left) && fr.days.includes(today)) byTeam[id] = [used[id] ?? 0, (used[id] ?? 0) + left];
      }),
    );
    return byTeam;
  };

  const refreshClaims = async (ids, fr) => {
    const key = `${fr.key}|${ids.join()}`;
    const hit = claims.get(key);
    if (pending.has(key) || (hit && Date.now() - hit.at < CLAIMS_REFRESH_MS)) return;
    pending.add(key);
    try {
      claims.set(key, { at: Date.now(), byTeam: await fetchClaims(ids, fr) });
      schedule();
    } catch {
      claims.set(key, { at: Date.now(), byTeam: hit?.byTeam ?? {} });
    } finally {
      pending.delete(key);
    }
  };

  const syncClaims = (ids, fr) => {
    const table = document.querySelector('league-livescoring-summary-table');
    let el = table?.querySelector(':scope > .fx-claims');
    const byTeam = fr?.days && table ? claims.get(`${fr.key}|${ids.join()}`)?.byTeam : null;
    if (!byTeam || ids.some((id) => !byTeam[id])) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.className = 'fx-claims';
      el.append(document.createElement('span'), document.createElement('span'));
      table.append(el);
    }
    ids.forEach((id, side) => setText(el.children[side], `Matchup Claims: ${byTeam[id][0]}/${byTeam[id][1]}`));
  };

  const teamIds = () => {
    const ids = [...document.querySelectorAll('app-league-livescoring league-livescoring-table-header')].map(teamIdOf).filter(Boolean);
    return ids.length >= 2 && ids[0] !== ids[1] ? ids.slice(0, 2) : null;
  };

  const syncSummary = (ids, fr) => {
    const table = document.querySelector('league-livescoring-summary-table');
    if (!table) return;
    for (const row of table.querySelectorAll('.league-livescoring-summary__row')) {
      const spec = SPLITS[row.children[1]?.textContent.trim()];
      if (!spec) continue;
      [row.children[0], row.children[2]].forEach((cell, side) => {
        const entry = cache.get(`${ids[side]}|${fr.key}`);
        const sets = entry ? [entry.active, entry.rows] : null;
        const displayed = parseFloat(cell?.textContent);
        const split = sets && Number.isFinite(displayed) ? splitFor(sets, spec, displayed) : null;
        if (split) {
          if (cell.getAttribute(ATTR) !== split) cell.setAttribute(ATTR, split);
        } else if (cell?.hasAttribute(ATTR)) {
          cell.removeAttribute(ATTR);
        }
      });
    }
  };

  const real = (el) => [...el.children].filter((c) => !c.classList.contains(COL));

  // Angular re-renders cells and can leave ours misplaced, so every sync keeps only the correctly placed ones
  const ensureCell = (row, idx, spec, tag, ref, keep) => {
    const target = real(row)[idx];
    if (!target) return null;
    // Our cells sit right before the target; several of them can be next to each other
    let cell = null;
    for (let prev = target.previousElementSibling; prev?.classList.contains(COL); prev = prev.previousElementSibling) {
      if (prev.dataset.fxSplit === spec.made) cell = prev;
    }
    if (!cell) {
      cell = document.createElement(tag);
      cell.className = `${COL} ${ref ?? ''}`.trim();
      cell.dataset.fxSplit = spec.made;
      target.before(cell);
    }
    keep.add(cell);
    return cell;
  };

  const setText = (el, text) => {
    if (el && el.textContent !== text) el.textContent = text;
  };

  const scorerIdOf = (aside) => aside?.querySelector('.scorer__image')?.style.backgroundImage.match(/\/hs(\w+?)_/)?.[1];

  // Fantrax's GP column is hidden (data-fx-off); the week range gets one "GP/WG" column of our own in its place:
  // games played / games on the schedule this week
  const GAMES_COL = { made: 'GPWG', title: 'GP/WG' };

  const syncGames = (ut, head, labels, trs, asides, byId, keep, week) => {
    const idx = labels.findIndex((th) => th.textContent.trim() === 'GP');
    if (idx < 0) return;
    labels[idx].setAttribute('data-fx-off', '');
    trs.forEach((tr) => real(tr)[idx]?.setAttribute('data-fx-off', ''));
    if (!week) return;
    const th = ensureCell(head, idx + 1, GAMES_COL, 'th', undefined, keep);
    if (th) setText(th, GAMES_COL.title);
    trs.forEach((tr, i) => {
      const cell = ensureCell(tr, idx, GAMES_COL, 'td', real(tr)[idx]?.className, keep);
      if (!cell) return;
      const row = byId.get(scorerIdOf(asides[i]));
      const text = row ? `${row.stats.GP}/${row.games}` : '';
      setText(cell, text);
      if (cell.hasAttribute('data-empty') !== (text === '')) cell.toggleAttribute('data-empty', text === '');
    });
  };

  const syncTable = (ut, entry, bench, week) => {
    const rows = entry?.rows;
    const head = ut.querySelector('header tr._ut__head');
    const body = ut.querySelector('._ut__content');
    if (!head || !body) return;
    const labels = real(head).filter((c) => c.tagName === 'TH');
    const asides = [...ut.querySelectorAll('aside._ut__aside > td')];
    const trs = [...body.querySelectorAll('tr')];
    const byId = new Map((rows ?? []).map((r) => [r.id, r]));
    const keep = new Set();
    const totalSet = bench ? entry?.bench : entry?.active;
    // Fantrax's Period view totals add up the player lines listed in that table
    const listed = asides.map((a) => byId.get(scorerIdOf(a))).filter(Boolean);

    for (const [label, spec] of Object.entries(SPLITS)) {
      const idx = labels.findIndex((th) => th.textContent.trim() === label);
      if (idx < 0) continue;

      const th = ensureCell(head, idx + 1, spec, 'th', undefined, keep); // +1: leading "Player" cell
      if (th) setText(th, spec.title);

      trs.forEach((tr, i) => {
        const original = real(tr)[idx];
        const cell = ensureCell(tr, idx, spec, 'td', original?.className, keep);
        if (!cell) return;
        const aside = asides[i];
        let text = '-';
        if (rows) {
          if (/^totals$/i.test(aside?.textContent.trim() ?? '')) {
            text = splitFor([listed, totalSet, rows], spec, parseFloat(original?.textContent)) ?? '-';
          } else {
            const stats = byId.get(scorerIdOf(aside))?.stats;
            if (stats && stats[spec.att] > 0) text = `${num(stats[spec.made])}/${num(stats[spec.att])}`;
          }
        }
        setText(cell, text);
        if (cell.hasAttribute('data-empty') !== (text === '-')) cell.toggleAttribute('data-empty', text === '-');
      });
    }
    syncGames(ut, head, labels, trs, asides, byId, keep, week);

    for (const el of ut.querySelectorAll(`.${COL}`)) if (!keep.has(el)) el.remove();
    alignColumns(head, trs, ut.classList.contains('scoring-table-detailed__away') ? 'away' : 'home', bench);
  };

  // The header is a separate table from the body, so give each column the same min-width in both
  // The active and bench tables of a team must keep the same column widths (the week view shows them as one table),
  // so each column takes the wider of the two. Hidden rows / headers measure 0 and are ignored.
  const columnWidths = new Map(); // `${side}|${bench}` -> widths

  const alignColumns = (head, trs, side, bench) => {
    const heads = [...head.children].filter((c) => c.tagName === 'TH');
    const row = trs.find((tr) => tr.getClientRects().length) ?? trs[0];
    const cols = row ? [...row.children] : [];
    if (heads.length !== cols.length) return;
    const own = heads.map((th, i) => Math.ceil(Math.max(th.getBoundingClientRect().width, cols[i].getBoundingClientRect().width)));
    const other = columnWidths.get(`${side}|${!bench}`);
    columnWidths.set(`${side}|${bench}`, own);
    heads.forEach((th, i) => {
      const width = Math.max(own[i], other?.[i] ?? 0);
      if (!width) return;
      const w = `${width}px`;
      if (th.style.minWidth !== w) th.style.minWidth = w;
      for (const tr of trs) if (tr.children[i] && tr.children[i].style.minWidth !== w) tr.children[i].style.minWidth = w;
    });
  };

  // Fantrax sizes the columns when its tables render, and measures 0 for a table hidden at that moment (the other
  // team's). Showing it later leaves the 0px min-widths, so the columns collapse; a resize event makes Fantrax measure again.
  const MEASURE_RETRY_MS = 400;
  const MEASURE_TRIES = 5;
  let measureTries = 0;
  let lastMeasure = 0;

  const remeasure = (tables) => {
    const collapsed = tables.some(
      (ut) =>
        ut.getClientRects().length &&
        [...ut.querySelectorAll('header tr._ut__head > th')].some((th) => !th.hasAttribute('data-fx-off') && th.style.minWidth === '0px'),
    );
    if (!collapsed) {
      measureTries = 0;
      return;
    }
    if (measureTries >= MEASURE_TRIES || Date.now() - lastMeasure < MEASURE_RETRY_MS) return;
    measureTries++;
    lastMeasure = Date.now();
    window.dispatchEvent(new Event('resize'));
  };

  const sync = () => {
    const ids = teamIds();
    if (!ids) return;
    ensureBase(ids[0]);
    const fr = frame();
    if (fr) {
      ids.forEach((id) => refresh(id, fr));
      syncSummary(ids, fr);
      if (fr.days && document.querySelector('league-livescoring-summary-table')) refreshClaims(ids, fr);
    }
    syncClaims(ids, fr);
    // The split columns have no numbers until the roster API answers for the frame on screen (dimmed by CSS)
    const loading = !fr || ids.some((id) => !cache.has(`${id}|${fr.key}`));
    const root = document.querySelector('app-league-livescoring');
    if (root && root.classList.contains('fx-loading') !== loading) root.classList.toggle('fx-loading', loading);

    const tables = [...document.querySelectorAll('ultimate-table.scoring-table-detailed__home, ultimate-table.scoring-table-detailed__away')];
    for (const ut of tables) {
      const side = ut.classList.contains('scoring-table-detailed__home') ? 0 : 1;
      syncTable(ut, fr && cache.get(`${ids[side]}|${fr.key}`), ut.classList.contains('scoring-table-detailed__last'), !!fr?.days);
    }
    remeasure(tables);
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
  // Showing / hiding a table (matchup-espn.js toggles classes) is no DOM mutation
  document.addEventListener('fx-matchup-state', schedule);
  setInterval(schedule, 700);
  sync();
})();
