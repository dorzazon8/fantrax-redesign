// Roster, Players and matchup team tables: while the stats are scrolled sideways the sticky player block narrows and
// its photo folds away (animated by CSS, see "Stats scrolled sideways" in fantrax.css) to leave room for more columns;
// scrolling back to the start brings the photo back. The two thresholds differ so the layout change itself (which
// shortens the scrollable width) can't flip it back and forth.
(() => {
  if (window.__fxPlayerCompact) return;
  window.__fxPlayerCompact = true;

  const ENTER = 30;
  const LEAVE = 6;
  const ANIMATION_MS = 350;

  const PAGES = [
    { root: 'app-league-team-roster', scroller: '.i-table__body' },
    { root: 'app-league-players', scroller: '.i-table__body' },
    { root: 'app-league-livescoring', scroller: 'ultimate-table > section' },
  ];

  // The matchup header follows the body through --fx-max (the scrollable distance, normally refreshed by
  // matchup-tidy.js once a second), which changes on every frame while the player block animates.
  const trackScrollableWidth = (root) => {
    const start = performance.now();
    const tick = () => {
      for (const ut of root.querySelectorAll('ultimate-table')) {
        const section = ut.querySelector(':scope > section');
        if (section) ut.style.setProperty('--fx-max', `${Math.max(0, section.scrollWidth - section.clientWidth)}px`);
      }
      if (performance.now() - start < ANIMATION_MS) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  document.addEventListener(
    'scroll',
    (e) => {
      const el = e.target;
      if (!(el instanceof Element)) return;
      for (const { root, scroller } of PAGES) {
        if (!el.matches(scroller)) continue;
        const page = el.closest(root);
        if (!page) continue;
        const compact = page.hasAttribute('data-fx-compact');
        if (!compact && el.scrollLeft > ENTER) page.setAttribute('data-fx-compact', '');
        else if (compact && el.scrollLeft < LEAVE) page.removeAttribute('data-fx-compact');
        else return;
        if (root === 'app-league-livescoring') trackScrollableWidth(page);
        return;
      }
    },
    { capture: true, passive: true }
  );
})();
