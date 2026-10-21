// Hides the whole minutes-remaining pill (clock icon + value) in player-game-info.
(() => {
  if (window.__fxGameIcons) return;
  window.__fxGameIcons = true;

  const HIDE = 'fx-hide-pill';

  const sync = () => {
    for (const icon of document.querySelectorAll('player-game-info mat-icon')) {
      if (icon.textContent.trim() === 'timer') icon.closest('mark')?.classList.add(HIDE);
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
