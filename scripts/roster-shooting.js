// Roster page: merges FGM + FGA and FTM + FTA into single "FGM/FGA" and "FTM/FTA" columns.
// Angular owns the cells, so nothing is added or removed: the first cell of each pair gets a
// data-fx-pair attribute (rendered via CSS ::after) and the second one is hidden (data-fx-hide).
(() => {
  if (window.__fxRosterShooting) return;
  window.__fxRosterShooting = true;

  const PAIRS = [
    ['FGM', 'FGA'],
    ['FTM', 'FTA'],
  ];

  const setAttr = (el, name, value) => {
    if (value === null) {
      if (el.hasAttribute(name)) el.removeAttribute(name);
    } else if (el.getAttribute(name) !== value) {
      el.setAttribute(name, value);
    }
  };

  const number = (el) => {
    const v = parseFloat(el?.textContent.replace(/,/g, ''));
    return Number.isFinite(v) ? v : null;
  };

  const pairText = (made, att) => {
    const m = number(made);
    const a = number(att);
    if (m === null || a === null || a === 0) return '-';
    return `${+m.toFixed(1)}/${+a.toFixed(1)}`;
  };

  const sync = () => {
    const header = document.querySelector('league-team-roster-tables .i-table__header');
    if (!header) return;
    const headCells = [...header.children].filter((c) => !c.classList.contains('i-table__cell--sticky-left') && !c.classList.contains('i-table__cell--sticky-right'));
    const rows = [...document.querySelectorAll('league-team-roster-tables .i-table__body .i-table__row')];

    for (const [made, att] of PAIRS) {
      const i = headCells.findIndex((c) => c.textContent.trim() === made);
      const j = headCells.findIndex((c) => c.textContent.trim() === att);
      if (i < 0 || j !== i + 1) continue;

      setAttr(headCells[i], 'data-fx-title', `${made}/${att}`);
      setAttr(headCells[j], 'data-fx-hide', '');

      for (const row of rows) {
        const cells = [...row.children].filter((c) => c.tagName === 'TABLE-CELL');
        // table-cells start at the "Opp" column, which is also the first header cell
        const m = cells[i];
        const a = cells[j];
        if (!m || !a) continue;
        const text = pairText(m, a);
        setAttr(m, 'data-fx-pair', text);
        setAttr(m, 'data-fx-empty', text === '-' ? '' : null);
        setAttr(a, 'data-fx-hide', '');
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
  sync();
})();
