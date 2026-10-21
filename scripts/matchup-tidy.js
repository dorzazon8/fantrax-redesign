// Matchup tab tidy-up: hides the empty "Totals" rows and the Hide/Show bench button,
// and keeps the bench expanded.
(() => {
  if (window.__fxMatchupTidy) return;
  window.__fxMatchupTidy = true;

  const HIDE = 'fx-hide';

  const sync = () => {
    for (const label of document.querySelectorAll('.scoring-table__row .scoring-table__cell__main > b')) {
      if (/^totals$/i.test(label.textContent.trim())) label.closest('.scoring-table__row')?.classList.add(HIDE);
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
  sync();
})();
