// Matchup tab tidy-up: hides the empty "Totals" rows, the always-empty GP row of the Summary tab and the
// Hide/Show bench button and keeps the bench expanded.
// Team tables: tags the Totals rows (data-fx-total), numbers the player rows (data-fx-idx), alternates their shading
// (data-fx-z) and marks bench rows of players that are also in the active table (data-fx-dup, hidden by CSS while the
// week view shows active + bench as one table).
(() => {
  if (window.__fxMatchupTidy) return;
  window.__fxMatchupTidy = true;

  const HIDE = 'fx-hide';

  const setAttr = (el, name, value) => {
    if (value === null) {
      if (el.hasAttribute(name)) el.removeAttribute(name);
    } else if (el.getAttribute(name) !== value) {
      el.setAttribute(name, value);
    }
  };

  const setStyle = (el, name, value) => {
    if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
  };

  const playerId = (aside) => aside.querySelector('.scorer__image')?.style.backgroundImage.match(/\/hs(\w+?)_/)?.[1] ?? null;

  const SECTION = 'app-league-livescoring ultimate-table > section';
  const sideOf = (ut) => (ut.classList.contains('scoring-table-detailed__away') ? 'away' : 'home');

  // The active and bench tables scroll sideways separately; keep their columns lined up
  const alignScroll = (from) => {
    const sections = [...document.querySelectorAll(SECTION)].filter((s) => sideOf(s.parentElement) === sideOf(from.parentElement));
    for (const other of sections) if (other !== from && other.scrollLeft !== from.scrollLeft) other.scrollLeft = from.scrollLeft;
  };

  document.addEventListener(
    'scroll',
    (e) => {
      if (e.target instanceof HTMLElement && e.target.matches(SECTION)) alignScroll(e.target);
    },
    true,
  );

  // Week range: the merged table has no part totals, so the active table's Totals row (the games that count for the
  // matchup, the same numbers as the Summary tab) is copied into a one-row table under the last table
  const CLONE = 'data-fx-clone';

  const syncWeekTotals = (root, side, tables, merged) => {
    const existing = root.querySelector(`ultimate-table.scoring-table-detailed__${side}[${CLONE}]`);
    const source = tables[0];
    const asides = source ? [...source.querySelectorAll('aside._ut__aside > td')] : [];
    const at = asides.findIndex((a) => /^totals$/i.test(a.textContent.trim()));
    const row = source?.querySelectorAll('._ut__content tr')[at];
    if (!merged || !row) {
      existing?.remove();
      return;
    }
    const anchor = tables[tables.length - 1];
    const signature = `${row.textContent.replace(/\s+/g, ' ')}|${row.children.length}`;
    if (existing && existing.dataset.fxSig === signature && existing.previousElementSibling === anchor) return;
    existing?.remove();
    const copy = source.cloneNode(true);
    copy.setAttribute(CLONE, '');
    copy.dataset.fxSig = signature;
    copy.classList.add('scoring-table-detailed__last');
    copy.querySelectorAll('aside._ut__aside > td').forEach((td, i) => i !== at && td.remove());
    copy.querySelectorAll('._ut__content tr').forEach((tr, i) => i !== at && tr.remove());
    anchor.after(copy);
    const scrolled = source.querySelector(':scope > section')?.scrollLeft ?? 0;
    const section = copy.querySelector(':scope > section');
    if (section) section.scrollLeft = scrolled;
  };

  const syncTeamTables = () => {
    const root = document.querySelector('app-league-livescoring');
    if (!root) return;
    const merged = root.classList.contains('fx-merged');
    for (const side of ['home', 'away']) {
      // [active table, bench table]; in the merged view they count as one table
      const tables = [...root.querySelectorAll(`ultimate-table.scoring-table-detailed__${side}:not([${CLONE}])`)];
      const activeIds = new Set();
      let n = 0;
      tables.forEach((ut, t) => {
        if (!merged || t === 0) n = 0;
        const asides = [...ut.querySelectorAll('aside._ut__aside > td')];
        const rows = [...ut.querySelectorAll('._ut__content tr')];
        asides.forEach((aside, i) => {
          const tr = rows[i];
          const total = /^totals$/i.test(aside.textContent.trim());
          const id = total ? null : playerId(aside);
          const dup = t > 0 && id !== null && activeIds.has(id);
          if (t === 0 && id !== null) activeIds.add(id);
          const counted = !total && !(merged && dup);
          if (counted) n++;
          const z = counted ? (n % 2 === 0 ? 'even' : 'odd') : null;
          for (const el of [aside, tr]) {
            if (!el) continue;
            setAttr(el, 'data-fx-total', total ? '' : null);
            setAttr(el, 'data-fx-dup', dup ? '' : null);
            setAttr(el, 'data-fx-z', z);
          }
          setAttr(aside, 'data-fx-idx', counted ? String(n) : null);
        });
      });
      for (const ut of tables) {
        const section = ut.querySelector(':scope > section');
        if (section) setStyle(ut, '--fx-max', `${Math.max(0, section.scrollWidth - section.clientWidth)}px`);
      }
      syncWeekTotals(root, side, tables, merged);
      const first = tables[0]?.querySelector(':scope > section');
      if (first) alignScroll(first);
    }
  };

  const sync = () => {
    for (const label of document.querySelectorAll('.scoring-table__row .scoring-table__cell__main > b')) {
      if (/^totals$/i.test(label.textContent.trim())) label.closest('.scoring-table__row')?.classList.add(HIDE);
    }

    syncTeamTables();

    for (const row of document.querySelectorAll('.league-livescoring-summary__row')) {
      if (row.children[1]?.textContent.trim() === 'GP') row.classList.add(HIDE);
    }

    for (const btn of document.querySelectorAll('.scoring-table__cell--full button')) {
      const text = btn.textContent.trim();
      if (!/^(hide|show) bench$/i.test(text)) continue;
      btn.classList.add(HIDE);
      if (/^show/i.test(text) && !btn.dataset.fxExpanded) {
        btn.dataset.fxExpanded = '1';
        btn.click();
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

  new MutationObserver(schedule).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  // the fx-merged class is set by matchup-espn.js without any DOM change of its own
  document.addEventListener('fx-matchup-state', schedule);
  setInterval(schedule, 1000);
  sync();
})();
