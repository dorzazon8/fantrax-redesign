// Claim flow: while the claim toast says "Pick player to drop from roster", tapping a player's name, positions or slot tag on the
// roster adds him as the drop (the same as opening his card and pressing the red minus). Fantrax's own per-row
// minus button is hidden by CSS; this clicks it. The roster gets data-fx-pick so CSS can hint that rows are tappable.
(() => {
  if (window.__fxClaimDrop) return;
  window.__fxClaimDrop = true;

  const picking = () => /pick player to drop/i.test(document.querySelector('player-tx-toast')?.textContent ?? '');

  const dropButton = (row) =>
    [...row.querySelectorAll('player-tx button')].find((b) => b.querySelector('mat-icon')?.textContent.trim() === 'remove');

  document.addEventListener(
    'click',
    (e) => {
      if (!picking() || !(e.target instanceof Element)) return;
      if (!e.target.closest('.scorer__info__name, .scorer__info__positions, .lineup-btn')) return;
      const row = e.target.closest('app-league-team-roster .i-table__body .i-table__row');
      const btn = row && dropButton(row);
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      btn.click();
    },
    true,
  );

  const sync = () => {
    const roster = document.querySelector('app-league-team-roster');
    if (!roster) return;
    const on = picking();
    if (roster.hasAttribute('data-fx-pick') !== on) roster.toggleAttribute('data-fx-pick', on);
  };

  new MutationObserver(() => requestAnimationFrame(sync)).observe(document.body, { childList: true, subtree: true, characterData: true });
  sync();
})();
