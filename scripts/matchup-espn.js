// ESPN-style matchup screen: one [Team A | Summary | Team B] segmented toggle replaces the
// Matchup/Summary tabs + layout icons, and the period/date picker becomes a "< Tue, Oct 20 >" row.
// A Day | Week switch replaces Fantrax's Timeframes icons: Week = "Period" (whole roster, week totals),
// Day = daily view (arrows step one day). Fantrax's own controls stay in the DOM (hidden by CSS) and are driven by clicks.
(() => {
  if (window.__fxEspn) return;
  window.__fxEspn = true;

  const ROOT = 'app-league-livescoring';
  const MODES = ['home', 'summary', 'away'];
  let teamMode = 'home';
  let defaulted = false;

  const root = () => document.querySelector(ROOT);
  const tab = (name) => [...document.querySelectorAll(`${ROOT} .tabs__item`)].find((b) => b.textContent.trim() === name);
  const isSummary = () => tab('Summary')?.classList.contains('tabs__item--selected') ?? false;
  const stackedIcon = () => document.querySelectorAll(`${ROOT} .tab-icon`)[2];

  // Timeframes pills: [0] daily, [1] period, [2] unused
  const frames = () => [...document.querySelectorAll(`${ROOT} .livescoring-mobile-filters pill-group[aria-label="Timeframes"] button`)];
  const frameIsDay = () => frames()[0]?.classList.contains('mat-sport') ?? false;

  const ensureRange = () => {
    const filters = document.querySelector(`${ROOT} .livescoring-mobile-filters`);
    const pills = frames();
    let box = filters?.querySelector(':scope > .fx-range');
    if (!filters || pills.length < 2) {
      box?.remove();
      return;
    }
    if (!box) {
      box = document.createElement('div');
      box.className = 'fx-range';
      for (const [i, label] of [[0, 'Day'], [1, 'Week']]) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.dataset.frame = String(i);
        btn.addEventListener('click', () => frames()[i]?.click());
        box.append(btn);
      }
      filters.append(box);
    }
    const day = frameIsDay();
    filters.classList.toggle('fx-week', !day);
    for (const btn of box.children) btn.setAttribute('aria-pressed', String((btn.dataset.frame === '0') === day));

    // Land on the whole-roster Week view once; afterwards the user's choice sticks
    if (!defaulted) {
      defaulted = true;
      if (day) frames()[1]?.click();
    }
  };

  const teamNames = () => {
    const names = [...document.querySelectorAll(`${ROOT} .scoring-header__name`)].map((n) => n.textContent.trim());
    return names.length >= 2 ? names.slice(0, 2) : null;
  };

  const select = (mode) => {
    if (mode === 'summary') {
      if (!isSummary()) tab('Summary')?.click();
    } else {
      teamMode = mode;
      if (isSummary()) tab('Matchup')?.click();
    }
    sync();
  };

  const ensureToggle = () => {
    const host = document.querySelector(`${ROOT} section.content__main__rows`);
    const names = teamNames();
    let bar = host?.querySelector(':scope > .fx-seg');
    if (!host || !names) {
      bar?.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'fx-seg';
      bar.setAttribute('role', 'tablist');
      for (const mode of MODES) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.mode = mode;
        btn.setAttribute('role', 'tab');
        btn.addEventListener('click', () => select(mode));
        bar.append(btn);
      }
      host.append(bar);
    }
    const labels = { home: names[0], summary: 'Summary', away: names[1] };
    const active = isSummary() ? 'summary' : teamMode;
    for (const btn of bar.children) {
      const { mode } = btn.dataset;
      if (btn.textContent !== labels[mode]) btn.textContent = labels[mode];
      btn.setAttribute('aria-selected', String(mode === active));
    }
  };

  // "1 (Oct 20 - Oct 25)" -> "Oct 20 - Oct 25", "Tue Oct 20" -> "Tue, Oct 20"
  const formatDate = (text) => {
    const range = text.match(/\(([^)]+)\)/);
    if (range) return range[1];
    return text.replace(/^([A-Za-z]{3})\s+/, '$1, ');
  };

  const syncDateLabel = () => {
    for (const el of document.querySelectorAll('.livescoring-mobile-filters .mat-mdc-select-value')) {
      const text = el.querySelector('.mat-mdc-select-value-text')?.textContent.trim();
      if (text && el.dataset.fxLabel !== formatDate(text)) el.dataset.fxLabel = formatDate(text);
    }
  };

  const sync = () => {
    const el = root();
    if (!el) return;
    ensureToggle();
    ensureRange();
    syncDateLabel();

    const summary = isSummary();
    const hasTeams = !!teamNames();
    el.classList.toggle('fx-team-home', hasTeams && !summary && teamMode === 'home');
    el.classList.toggle('fx-team-away', hasTeams && !summary && teamMode === 'away');

    // Team views need Fantrax's stacked layout (full-width table per team)
    const icon = stackedIcon();
    if (hasTeams && !summary && icon && !icon.classList.contains('tab-icon--active')) icon.click();
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
