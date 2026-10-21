// Players page: hides the Rk and Sta columns on every tab, and Score / Ros / +/- on the Stats and Schedule tabs (the list stays sorted by Score),
// and tags each row with its availability (data-fx-st = "FA" or "W") so the add button can be coloured.
// Angular owns the cells, so they are only tagged; CSS hides them.
(() => {
  if (window.__fxPlayersColumns) return;
  window.__fxPlayersColumns = true;

  const ALWAYS_HIDDEN = new Set(['Rk', 'Sta']);
  const TAB_HIDDEN = new Set(['Score', 'Ros']);
  const HIDE_ON_TABS = new Set(['Stats', 'Schedule']);

  const setAttr = (el, name, value) => {
    if (value === null) {
      if (el.hasAttribute(name)) el.removeAttribute(name);
    } else if (el.getAttribute(name) !== value) {
      el.setAttribute(name, value);
    }
  };

  const availability = (text) => {
    if (/^FA\b/i.test(text)) return 'FA';
    // No dropped player was on waivers while this was written, so the exact text is a guess: "W", "W (Oct 22)", "Waivers"...
    if (/^W(\s|\(|$)|^waiver/i.test(text)) return 'W';
    return null;
  };

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Schedule tab pager: label it with the dates it covers ("Oct 21 - Oct 27") instead of the word "Schedule"
  const syncPagerRange = (labels) => {
    const title = [...document.querySelectorAll('app-league-players .pagination > b')][0];
    if (!title) return;
    const days = labels.map((l) => l.match(/^\w{3}\s+(\d{1,2})\/(\d{1,2})$/)).filter(Boolean);
    const fmt = (m) => `${MONTHS[+m[1] - 1]} ${+m[2]}`;
    setAttr(title, 'data-fx-range', days.length ? `${fmt(days[0])} - ${fmt(days[days.length - 1])}` : null);
  };

  const sync = () => {
    const table = document.querySelector('app-league-players league-players-table .i-table');
    if (!table) return;
    const header = table.querySelector('.i-table__header');
    if (!header) return;

    const tabHidden = HIDE_ON_TABS.has(document.querySelector('app-league-players .tabs__item--selected')?.textContent.trim() ?? '');
    const labels = [...header.children].map((c) => c.textContent.trim());
    // Only the "+/-" right after Ros is Ros's change; the Schedule tab has a second +/- that belongs to another column
    const hiddenIdx = labels.flatMap((l, i) =>
      ALWAYS_HIDDEN.has(l) || (tabHidden && (TAB_HIDDEN.has(l) || (l === '+/-' && labels[i - 1] === 'Ros'))) ? [i] : [],
    );
    const staIdx = labels.indexOf('Sta');
    syncPagerRange(labels);

    [...header.children].forEach((c, i) => setAttr(c, 'data-fx-hide', hiddenIdx.includes(i) ? '' : null));

    for (const row of table.querySelectorAll('.i-table__body .i-table__row')) {
      const cells = [...row.children];
      cells.forEach((c, i) => setAttr(c, 'data-fx-hide', hiddenIdx.includes(i) ? '' : null));
      setAttr(row, 'data-fx-st', staIdx >= 0 ? availability(cells[staIdx]?.textContent.trim() ?? '') : null);
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
