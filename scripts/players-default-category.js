// Players page: the Stats tab opens on the "Standard" scoring category instead of Fantrax's own default.
// Applied once each time the page is entered, so a category picked afterwards sticks.
(() => {
  if (window.__fxPlayersDefaultCategory) return;
  window.__fxPlayersDefaultCategory = true;

  const applied = new WeakSet();

  const sync = () => {
    const root = document.querySelector('app-league-players');
    const group = root?.querySelector('pill-group[aria-label="Scoring Category"]');
    if (!root || !group || applied.has(root)) return;
    const standard = [...group.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Standard');
    if (!standard) return;
    applied.add(root);
    if (!standard.classList.contains('pill--active')) standard.click();
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
  });
  sync();
})();
