// Player card (dialog): merges FGM + FGA and FTM + FTA into single "FGM/FGA" and "FTM/FTA" columns.
// Season stats have no attempts column, so attempts are derived from made / percentage.
// Angular owns the cells, so the first cell of each pair gets data-fx-pair (rendered via CSS ::after)
// and the attempts cell is hidden (data-fx-hide). See styles/fantrax.css ("Player card").
(() => {
  if (window.__fxPlayerCard) return;
  window.__fxPlayerCard = true;

  const PAIRS = [
    { made: 'FGM', att: 'FGA', pct: 'FG%' },
    { made: 'FTM', att: 'FTA', pct: 'FT%' },
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

  const fmt = (n) => `${+n.toFixed(1)}`;
  const EMPTY = '-';

  const fromAttempts = (made, att) => {
    const m = number(made);
    const a = number(att);
    return m === null || a === null || a === 0 ? EMPTY : `${fmt(m)}/${fmt(a)}`;
  };

  // pct is "-" when there are no attempts; made = 0 with a real 0% leaves attempts unknown
  const fromPct = (made, pct) => {
    const m = number(made);
    const p = number(pct);
    if (m === null || p === null || p <= 0 || p > 1) return EMPTY;
    return `${fmt(m)}/${fmt(m / p)}`;
  };

  const syncTable = (table) => {
    const header = table.querySelector('.i-table__header');
    if (!header) return;
    const heads = [...header.children];
    const names = heads.map((c) => c.textContent.trim());
    const rows = [...table.querySelectorAll('.i-table__body .i-table__row')];

    for (const { made, att, pct } of PAIRS) {
      const i = names.indexOf(made);
      if (i < 0) continue;
      const j = names[i + 1] === att ? i + 1 : -1;
      const k = names.indexOf(pct);
      if (j < 0 && k < 0) continue;

      setAttr(heads[i], 'data-fx-title', `${made}/${att}`);
      if (j >= 0) setAttr(heads[j], 'data-fx-hide', '');

      for (const row of rows) {
        const cells = [...row.children];
        const text = j >= 0 ? fromAttempts(cells[i], cells[j]) : fromPct(cells[i], cells[k]);
        if (!cells[i]) continue;
        setAttr(cells[i], 'data-fx-pair', text);
        setAttr(cells[i], 'data-fx-empty', text === EMPTY ? '' : null);
        if (j >= 0 && cells[j]) setAttr(cells[j], 'data-fx-hide', '');
      }
    }
  };

  const sync = () => {
    for (const table of document.querySelectorAll('player-profile-content .i-table')) syncTable(table);
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
