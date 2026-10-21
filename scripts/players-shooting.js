// Players page: merges made + attempts columns (FGM/FGA, FTM/FTA, 3PTM/3PTA) into single "M/A" columns
// on the views that have both (Standard, Extra). Angular owns the cells, so the made cell gets
// data-fx-pair (rendered via CSS ::after) and the attempts cell gets data-fx-merged (hidden by CSS).
(() => {
  if (window.__fxPlayersShooting) return;
  window.__fxPlayersShooting = true;

  const PAIRS = [
    ['FGM', 'FGA'],
    ['FTM', 'FTA'],
    ['3PTM', '3PTA'],
  ];
  const EMPTY = '-';

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
    return m === null || a === null || a === 0 ? EMPTY : `${+m.toFixed(1)}/${+a.toFixed(1)}`;
  };

  const sync = () => {
    const table = document.querySelector('app-league-players league-players-table .i-table');
    const header = table?.querySelector('.i-table__header');
    if (!header) return;
    const heads = [...header.children];
    const names = heads.map((c) => c.textContent.trim());
    const rows = [...table.querySelectorAll('.i-table__body .i-table__row')];
    const merged = new Set();

    for (const [made, att] of PAIRS) {
      const i = names.indexOf(made);
      if (i < 0 || names[i + 1] !== att) continue;
      merged.add(i).add(i + 1);

      setAttr(heads[i], 'data-fx-title', `${made}/${att}`);
      setAttr(heads[i + 1], 'data-fx-merged', '');

      for (const row of rows) {
        const cells = [...row.children];
        if (!cells[i] || !cells[i + 1]) continue;
        const text = pairText(cells[i], cells[i + 1]);
        setAttr(cells[i], 'data-fx-pair', text);
        setAttr(cells[i], 'data-fx-empty', text === EMPTY ? '' : null);
        setAttr(cells[i + 1], 'data-fx-merged', '');
      }
    }

    // Tabs / views without a pair: clear what an earlier view left on the reused cells
    const stale = (el, i) => {
      if (merged.has(i)) return;
      for (const a of ['data-fx-title', 'data-fx-merged', 'data-fx-pair', 'data-fx-empty']) setAttr(el, a, null);
    };
    heads.forEach(stale);
    for (const row of rows) [...row.children].forEach(stale);
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
