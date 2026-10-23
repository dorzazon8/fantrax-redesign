// Roster page: hides the "Min/Max" tab. Angular owns the tab buttons, so the button only gets a
// data-fx-hide attribute (display: none via CSS) instead of being removed.
(() => {
  if (window.__fxRosterTabs) return;
  window.__fxRosterTabs = true;

  const sync = () => {
    for (const tab of document.querySelectorAll('app-league-team-roster .tabs__item')) {
      const hide = tab.textContent.replace(/\s+/g, '').toLowerCase() === 'min/max';
      if (hide !== tab.hasAttribute('data-fx-hide')) {
        if (hide) tab.setAttribute('data-fx-hide', '');
        else tab.removeAttribute('data-fx-hide');
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

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  sync();
})();
