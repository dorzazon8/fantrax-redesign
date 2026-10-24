// Matchup tables: tags every header / body cell with its column kind (data-fx-w) so the CSS gives the stat columns the same
// compact, fixed widths as the roster and Players tables. Fantrax's own inline widths are wider than the values need.
// A body row has no Player cell (it sits in the aside), so its cells line up with the header cells after the first one.
(() => {
  if (window.__fxMatchupColumns) return;
  window.__fxMatchupColumns = true;

  const kindOf = (label) => {
    if (label === 'FGM/FGA' || label === 'FTM/FTA') return 'ma';
    if (label === 'FG%' || label === 'FT%') return 'pct';
    if (label === 'Opp' || label === 'GP') return null;
    if (label === 'GP/WG') return 'gw';
    return 'n';
  };

  const tag = (cell, kind) => {
    if (kind === null || cell.hasAttribute('data-fx-off')) {
      if (cell.hasAttribute('data-fx-w')) cell.removeAttribute('data-fx-w');
    } else if (cell.getAttribute('data-fx-w') !== kind) {
      cell.setAttribute('data-fx-w', kind);
    }
  };

  const sync = () => {
    for (const ut of document.querySelectorAll('app-league-livescoring ultimate-table')) {
      const head = [...(ut.querySelector(':scope > header tr._ut__head')?.children ?? [])];
      if (head.length < 2) continue;
      const kinds = head.slice(1).map((th) => kindOf(th.textContent.trim()));
      head.slice(1).forEach((th, i) => tag(th, kinds[i]));
      // The body table's own (invisible) thead sets its column widths, so it is tagged like a row
      // (and must hide the same columns, or it adds a phantom column)
      const off = head.slice(1).map((th) => th.hasAttribute('data-fx-off'));
      for (const th of ut.querySelector('._ut__content thead')?.children ?? []) {
        const i = [...th.parentElement.children].indexOf(th);
        if (th.hasAttribute('data-fx-off') !== !!off[i]) th.toggleAttribute('data-fx-off', !!off[i]);
      }
      for (const row of ut.querySelectorAll('._ut__content thead, ._ut__content tr')) {
        [...row.children].forEach((td, i) => {
          if (i < kinds.length) tag(td, kinds[i]);
        });
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
  sync();
})();
