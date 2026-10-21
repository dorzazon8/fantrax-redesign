// Made/attempted shooting splits, which Fantrax's live-scoring data omits (it only has FG% / FT%).
//  - Summary tab: "(M/A)" after FG% and FT% (see CSS ::after on [data-fx-ma]).
//  - Team tables: extra "FGM/FGA" and "FTM/FTA" columns right before FG% and FT%.
// FGM/FGA/FTM/FTA come from getTeamRosterInfo ("Standard" stats): matchup period in Week view,
// day period (1 = first day of the season) in Day view. Summary/total values are shown only if
// their ratio matches the displayed %.
(() => {
  if (window.__fxShootingSplits) return;
  window.__fxShootingSplits = true;

  const REFRESH_MS = 30000;
  const ATTR = 'data-fx-ma';
  const COL = 'fx-col';
  const DAY_MS = 86400000;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const SPLITS = {
    'FG%': { made: 'FGM', att: 'FGA', title: 'FGM/FGA' },
    'FT%': { made: 'FTM', att: 'FTA', title: 'FTM/FTA' },
  };

  const cache = new Map(); // `${teamId}|${frameKey}` -> { at, rows }
  const pending = new Set();
  let baseDay = null; // UTC midnight of day period 1

  const leagueId = () => location.pathname.match(/league\/(\w+)/)?.[1];
  const teamIdOf = (header) => header.querySelector('a[href*="teamId="]')?.getAttribute('href').match(/teamId=(\w+)/)?.[1];

  const call = async (data) => {
    const res = await fetch(`/fxpa/req?leagueId=${leagueId()}`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({
        msgs: [{ method: 'getTeamRosterInfo', data: { leagueId: leagueId(), scoringCategoryType: '1', ...data } }],
        uiv: 3,
        refUrl: location.href,
      }),
    });
    return (await res.json()).responses?.[0]?.data;
  };

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

  // What the page currently shows, as roster-API params: "1 (Oct 20 - Oct 25)" = matchup period, "Tue Oct 20" = one day
  const frame = () => {
    const text = document.querySelector('.livescoring-mobile-filters .mat-mdc-select-value-text')?.textContent.trim() ?? '';
    if (!isDayView()) {
      const period = text.match(/^(\d+)\s*\(/)?.[1];
      return period ? { key: `w${period}`, params: { period, timeframeTypeCode: 'BY_PERIOD' } } : null;
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
        return { key: `d${n}`, params: { period: String(n) } };
      }
    }
    return null;
  };

  const fetchRoster = async (teamId, fr) => {
    const table = (await call({ teamId, ...fr.params }))?.tables?.[0];
    if (!table) return [];
    const header = table.header.cells;
    return table.rows
      .filter((r) => r.scorer)
      .map((r) => {
        const offset = header.length - r.cells.length;
        const stats = {};
        header.forEach((c, i) => {
          const v = parseFloat(String(r.cells[i - offset]?.content ?? '').replace(/,/g, ''));
          stats[c.shortName] = Number.isFinite(v) ? v : 0;
        });
        return { id: r.scorer.scorerId, active: r.statusId === '1', stats };
      });
  };

  const refresh = async (teamId, fr) => {
    const key = `${teamId}|${fr.key}`;
    const hit = cache.get(key);
    if (pending.has(key) || (hit && Date.now() - hit.at < REFRESH_MS)) return;
    pending.add(key);
    try {
      cache.set(key, { at: Date.now(), rows: await fetchRoster(teamId, fr) });
      schedule();
    } catch {
      cache.set(key, { at: Date.now(), rows: hit?.rows ?? [] });
    } finally {
      pending.delete(key);
    }
  };

  const total = (rows, key) => rows.reduce((s, r) => s + r.stats[key], 0);
  const num = (v) => String(+v.toFixed(1));

  // Returns "M/A" only when a candidate set of players reproduces the displayed %.
  const splitFor = (sets, spec, displayed) => {
    for (const set of sets) {
      const m = total(set, spec.made);
      const a = total(set, spec.att);
      if (a > 0 && Math.abs(m / a - displayed) < 0.0006) return `${num(m)}/${num(a)}`;
    }
    return null;
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
        const rows = cache.get(`${ids[side]}|${fr.key}`)?.rows;
        const displayed = parseFloat(cell?.textContent);
        const split = rows && Number.isFinite(displayed) ? splitFor([rows.filter((r) => r.active), rows], spec, displayed) : null;
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
    const prev = target.previousElementSibling;
    let cell = prev?.classList.contains(COL) && prev.dataset.fxSplit === spec.made ? prev : null;
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

  const syncTable = (ut, rows, bench) => {
    const head = ut.querySelector('header tr._ut__head');
    const body = ut.querySelector('._ut__content');
    if (!head || !body) return;
    const labels = real(head).filter((c) => c.tagName === 'TH');
    const asides = [...ut.querySelectorAll('aside._ut__aside > td')];
    const trs = [...body.querySelectorAll('tr')];
    const byId = new Map((rows ?? []).map((r) => [r.id, r]));
    const keep = new Set();
    const totalSet = bench ? (rows ?? []).filter((r) => !r.active) : (rows ?? []).filter((r) => r.active);

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
            text = splitFor([totalSet, rows], spec, parseFloat(original?.textContent)) ?? '-';
          } else {
            const stats = byId.get(scorerIdOf(aside))?.stats;
            if (stats && stats[spec.att] > 0) text = `${num(stats[spec.made])}/${num(stats[spec.att])}`;
          }
        }
        setText(cell, text);
        if (cell.hasAttribute('data-empty') !== (text === '-')) cell.toggleAttribute('data-empty', text === '-');
      });
    }
    for (const el of ut.querySelectorAll(`.${COL}`)) if (!keep.has(el)) el.remove();
    alignColumns(head, trs);
  };

  // The header is a separate table from the body, so give each column the same min-width in both
  const alignColumns = (head, trs) => {
    const heads = [...head.children].filter((c) => c.tagName === 'TH');
    const cols = trs[0] ? [...trs[0].children] : [];
    if (heads.length !== cols.length) return;
    const widths = heads.map((th, i) => Math.ceil(Math.max(th.getBoundingClientRect().width, cols[i].getBoundingClientRect().width)));
    heads.forEach((th, i) => {
      const w = `${widths[i]}px`;
      if (th.style.minWidth !== w) th.style.minWidth = w;
      for (const tr of trs) if (tr.children[i] && tr.children[i].style.minWidth !== w) tr.children[i].style.minWidth = w;
    });
  };

  const sync = () => {
    const ids = teamIds();
    if (!ids) return;
    if (isDayView()) ensureBase(ids[0]);
    const fr = frame();
    if (fr) {
      ids.forEach((id) => refresh(id, fr));
      syncSummary(ids, fr);
    }
    for (const ut of document.querySelectorAll('ultimate-table.scoring-table-detailed__home, ultimate-table.scoring-table-detailed__away')) {
      const side = ut.classList.contains('scoring-table-detailed__home') ? 0 : 1;
      syncTable(ut, fr && cache.get(`${ids[side]}|${fr.key}`)?.rows, ut.classList.contains('scoring-table-detailed__last'));
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
