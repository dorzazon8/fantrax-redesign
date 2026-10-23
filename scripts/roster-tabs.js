// Roster page: hides the "Min/Max" and "Schedule - Week" (a subset of "Schedule - Full") tabs and shortens "Schedule - Full"
// to "Schedule". Angular owns the tab buttons, so a button only gets a data-fx-hide / data-fx-label attribute
// (display: none / the label drawn by CSS) instead of being changed.
(() => {
  if (window.__fxRosterTabs) return;
  window.__fxRosterTabs = true;

  const HIDDEN = new Set(['min/max', 'schedule-week']);
  const LABELS = { 'schedule-full': 'Schedule' };

  const sync = () => {
    for (const tab of document.querySelectorAll('app-league-team-roster .tabs__item')) {
      const name = tab.textContent.replace(/\s+/g, '').toLowerCase();
      const hide = HIDDEN.has(name);
      if (hide !== tab.hasAttribute('data-fx-hide')) {
        if (hide) tab.setAttribute('data-fx-hide', '');
        else tab.removeAttribute('data-fx-hide');
      }
      const label = LABELS[name];
      if (label && tab.dataset.fxLabel !== label) tab.dataset.fxLabel = label;
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
