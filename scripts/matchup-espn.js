// ESPN-style matchup screen: one [Team A | Summary | Team B] segmented toggle replaces the
// Matchup/Summary tabs + layout icons, and the period/date picker becomes a "< Tue, Oct 20 >" row.
// There is no Day/Week switch: the team tabs use Fantrax's Day view (arrows step one day, so each day's
// lineup shows who plays), the Summary tab uses its Period view (week totals). The header score always
// shows the week (see matchup-week-score.js). Fantrax's own controls stay in the DOM (hidden by CSS)
// and are driven by clicks. The Summary tab is selected whenever the matchups page is entered.
(() => {
  if (window.__fxEspn) return;
  window.__fxEspn = true;

  const ROOT = 'app-league-livescoring';
  const MODES = ['home', 'summary', 'away'];
  const FRAME_COOLDOWN_MS = 2000;
  let teamMode = 'home';
  let pendingDefault = true;
  let lastRoot = null;
  let lastFrameClick = 0;

  const root = () => document.querySelector(ROOT);
  const tab = (name) => [...document.querySelectorAll(`${ROOT} .tabs__item`)].find((b) => b.textContent.trim() === name);
  const isSummary = () => tab('Summary')?.classList.contains('tabs__item--selected') ?? false;
  const stackedIcon = () => document.querySelectorAll(`${ROOT} .tab-icon`)[2];

  // Timeframes pills: [0] daily, [1] period, [2] unused
  const frames = () => [...document.querySelectorAll(`${ROOT} .livescoring-mobile-filters pill-group[aria-label="Timeframes"] button`)];
  const frameIsDay = () => frames()[0]?.classList.contains('mat-sport') ?? false;

  // Summary needs the Period view (week totals); team tabs need the Day view (that day's lineup)
  const ensureFrame = () => {
    const filters = document.querySelector(`${ROOT} .livescoring-mobile-filters`);
    const pills = frames();
    if (!filters || pills.length < 2) return;
    const wantDay = !isSummary();
    const day = frameIsDay();
    filters.classList.toggle('fx-week', !day);
    if (day !== wantDay && Date.now() - lastFrameClick > FRAME_COOLDOWN_MS) {
      lastFrameClick = Date.now();
      pills[wantDay ? 0 : 1].click();
    }
  };

  // Entering the matchups page (or tapping its bottom-nav button) lands on Summary
  const applyDefault = () => {
    const el = root();
    if (el !== lastRoot) {
      lastRoot = el;
      if (el) pendingDefault = true;
    }
    if (!pendingDefault || !el) return;
    const summaryTab = tab('Summary');
    if (!summaryTab) return;
    pendingDefault = false;
    if (!isSummary()) summaryTab.click();
  };

  document.addEventListener(
    'click',
    (e) => {
      if (e.target.closest?.('.nav-mobile-menu__button')?.textContent.includes('Matchups')) pendingDefault = true;
    },
    true,
  );

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
    applyDefault();
    ensureToggle();
    ensureFrame();
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
