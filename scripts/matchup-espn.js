// ESPN-style matchup screen: one [Team A | Summary | Team B] segmented toggle replaces the
// Matchup/Summary tabs + layout icons, and the period/date picker becomes a "< Tue, Oct 20 >" row.
// The team tabs use Fantrax's Day view (arrows step one day, so each day's lineup shows who plays) and have a
// small Day | Week switch that swaps to its Period view: every player's totals for the whole scoring week.
// In the Week range the active and bench tables are shown as one (CSS, see .fx-merged). The fx-team-*, fx-merged and
// fx-busy classes of the root follow what Fantrax actually shows, not the last tap (a tap needs a request first).
// The Summary tab always uses the Period view (week totals). The header score always shows the week
// (see matchup-week-score.js). Fantrax's own controls stay in the DOM (hidden by CSS)
// and are driven by clicks. The Summary tab is selected whenever the matchups page is entered.
// The two team headers are replaced by one compact, sticky score row ([logo 5-2-2 ... 2-5-2 logo]) built from them.
(() => {
  if (window.__fxEspn) return;
  window.__fxEspn = true;

  const ROOT = 'app-league-livescoring';
  const MODES = ['home', 'summary', 'away'];
  const FRAME_COOLDOWN_MS = 1200;
  const RECHECK_MS = 500;
  const SETTLE_MS = 1000;
  const QUIET_MS = 500;
  const DEFAULT_WINDOW_MS = 8000;
  let teamMode = 'home';
  let teamRange = 'day'; // team tabs: 'day' = one day's lineup, 'week' = every player's week totals
  let defaultUntil = Date.now() + DEFAULT_WINDOW_MS;
  let lastRoot = null;
  let lastMatchupId = null;
  let readySince = 0;
  const READY_STABLE_MS = 300;
  let lastFrameClick = 0;
  let lastDefaultClick = 0;
  let settleUntil = 0; // a tab click takes a moment to show in the DOM; until then the tab state must not drive other clicks

  const settle = () => {
    settleUntil = Date.now() + SETTLE_MS;
  };
  const defaulting = () => Date.now() < defaultUntil;

  // Fantrax resets its tab when a response lands after a tab click, so the default Summary click waits until
  // its API responses (/fxpa/req) have stopped arriving for a moment. Fantrax keeps its own fetch reference,
  // so completed requests are read from the resource timing entries instead of patching fetch.
  let lastNetActivity = Date.now();
  try {
    new PerformanceObserver((list) => {
      if (list.getEntries().some((e) => /fxpa\/req/.test(e.name))) lastNetActivity = Date.now();
    }).observe({ type: 'resource' });
  } catch {
    // no resource timing: the click only waits for the page's own settle delay
  }
  const netQuiet = () => Date.now() - lastNetActivity > QUIET_MS;

  const root = () => document.querySelector(ROOT);
  const tab = (name) => [...document.querySelectorAll(`${ROOT} .tabs__item`)].find((b) => b.textContent.trim() === name);
  const isSummary = () => tab('Summary')?.classList.contains('tabs__item--selected') ?? false;
  const stackedIcon = () => document.querySelectorAll(`${ROOT} .tab-icon`)[2];

  // Timeframes pills: [0] daily, [1] period, [2] unused
  const frames = () => [...document.querySelectorAll(`${ROOT} .livescoring-mobile-filters pill-group[aria-label="Timeframes"] button`)];
  const frameIsDay = () => frames()[0]?.classList.contains('mat-sport') ?? false;

  // Summary and the team tabs' Week range need the Period view (week totals); the Day range needs the Day view
  const wantsDay = () => !isSummary() && teamRange === 'day';

  // A pill click is followed by a request; the next click waits until the frame has switched (so quick Day / Week
  // taps are applied one after the other as soon as the page is ready) or FRAME_COOLDOWN_MS has passed
  let frameClickTarget = null;

  const ensureFrame = () => {
    const filters = document.querySelector(`${ROOT} .livescoring-mobile-filters`);
    const pills = frames();
    if (!filters || pills.length < 2) return;
    const wantDay = wantsDay();
    const day = frameIsDay();
    filters.classList.toggle('fx-week', !day);
    if (frameClickTarget !== null && day === frameClickTarget) frameClickTarget = null;
    if (day === wantDay) return;
    if (frameClickTarget !== null && Date.now() - lastFrameClick < FRAME_COOLDOWN_MS) return;
    lastFrameClick = Date.now();
    frameClickTarget = wantDay;
    pills[wantDay ? 0 : 1].click();
  };

  // Entering the matchups page (or tapping its bottom-nav button) lands on Summary. Fantrax resets its own tab
  // while it finishes loading, so Summary is re-applied for a few seconds unless the user picks a tab first.
  const applyDefault = () => {
    const el = root();
    const matchupId = new URLSearchParams(location.search).get('matchupId');
    if (el !== lastRoot || (el && matchupId !== lastMatchupId)) {
      lastRoot = el;
      if (el) startDefaultWindow();
    }
    lastMatchupId = matchupId;
    const summaryTab = tab('Summary');
    if (!el || !summaryTab || !defaulting() || !netQuiet()) return;
    if (Date.now() - lastDefaultClick < FRAME_COOLDOWN_MS) return;
    if (isSummary()) {
      // Fantrax can show the Summary tab as selected while still rendering the matchup tables; toggling through Matchup repairs it
      if (document.querySelector(`${ROOT} .league-livescoring-summary__row`) || !document.querySelector(`${ROOT} .scoring-header`)) return;
      lastDefaultClick = Date.now();
      tab('Matchup')?.click();
      settle();
      return;
    }
    lastDefaultClick = Date.now();
    summaryTab.click();
    settle();
  };

  // The page's first request is in flight before any response is seen, so entering the page counts as network activity
  const startDefaultWindow = () => {
    defaultUntil = Date.now() + DEFAULT_WINDOW_MS;
    lastNetActivity = Date.now();
    readySince = 0;
    root()?.classList.remove('fx-ready');
  };

  // The content stays hidden (CSS, until fx-ready) while Fantrax and the other matchup scripts are still filling it in:
  // Summary selected, the games row and the shooting splits loaded and, with Projected on, the projection applied.
  // A user's own pick or the end of the default window reveals it regardless.
  const contentReady = () => {
    if (!defaulting()) return true;
    const games = document.querySelector(`${ROOT} .fx-games`);
    const projectedOn = document.querySelector(`${ROOT} pill-group[aria-label="Projected"] button`)?.getAttribute('aria-checked') === 'true';
    return (
      isSummary() &&
      !!document.querySelector(`${ROOT} .league-livescoring-summary__row`) &&
      !root().classList.contains('fx-loading') &&
      !!games &&
      [...games.children].every((side) => side.childElementCount > 0) &&
      (!projectedOn || !!document.querySelector(`${ROOT} [data-fx-proj]`))
    );
  };

  const syncReady = () => {
    const el = root();
    if (!el) return;
    if (!contentReady()) {
      readySince = 0;
      return;
    }
    readySince ||= Date.now();
    if (Date.now() - readySince >= READY_STABLE_MS && !el.classList.contains('fx-ready')) el.classList.add('fx-ready');
  };

  document.addEventListener(
    'click',
    (e) => {
      if (e.target.closest?.('.nav-mobile-menu__button')?.textContent.includes('Matchups')) startDefaultWindow();
      if (e.target.closest?.('.livescoring-swipe-matchups__item')) startDefaultWindow();
    },
    true,
  );

  const teamNames = () => {
    const names = [...document.querySelectorAll(`${ROOT} .scoring-header__name`)].map((n) => n.textContent.trim());
    return names.length >= 2 ? names.slice(0, 2) : null;
  };

  const select = (mode) => {
    defaultUntil = 0;
    if (mode === 'summary') {
      if (!isSummary()) tab('Summary')?.click();
    } else {
      teamMode = mode;
      if (isSummary()) tab('Matchup')?.click();
    }
    settle();
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

  // One sticky row with both teams' logo + week score, mirrored from Fantrax's (hidden) team headers
  const ensureScoreRow = () => {
    const host = document.querySelector(`${ROOT} section.content__main__rows`);
    const headers = [...document.querySelectorAll(`${ROOT} league-livescoring-table-header`)].slice(0, 2);
    let bar = host?.querySelector(':scope > .fx-score');
    if (!host || headers.length < 2 || !teamNames()) {
      bar?.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'fx-score';
      for (let i = 0; i < 2; i++) {
        const side = document.createElement('div');
        side.append(document.createElement('figure'), document.createElement('b'));
        bar.append(side);
      }
      host.append(bar);
    }
    headers.forEach((header, i) => {
      const [logo, score] = bar.children[i].children;
      const image = header.querySelector('.scoring-header__logo')?.style.backgroundImage ?? '';
      if (logo.style.backgroundImage !== image) logo.style.backgroundImage = image;
      const wlt = header.querySelector('.scoring-header__score-primary h2')?.textContent.match(/\d+/g)?.slice(0, 3).join('-') ?? '';
      if (score.textContent !== wlt) score.textContent = wlt;
    });
  };

  // Season record per team from the standings: matchups W-L-T
  let standings = null; // { at, byTeam: { [teamId]: "0-0-0" } }
  let standingsPending = false;
  const STANDINGS_REFRESH_MS = 60000;

  const loadStandings = async () => {
    if (standingsPending || (standings && Date.now() - standings.at < STANDINGS_REFRESH_MS)) return;
    const leagueId = location.pathname.match(/league\/(\w+)/)?.[1];
    if (!leagueId) return;
    standingsPending = true;
    try {
      const res = await fetch(`/fxpa/req?leagueId=${leagueId}`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ msgs: [{ method: 'getStandings', data: { leagueId } }], uiv: 3, refUrl: location.href }),
      });
      const table = (await res.json()).responses?.[0]?.data?.tableList?.[0];
      const keys = table?.header?.cells.map((c) => c.key) ?? [];
      const byTeam = {};
      for (const row of table?.rows ?? []) {
        const teamId = row.fixedCells?.find((c) => c.teamId)?.teamId;
        const cell = (key) => row.cells[keys.indexOf(key)]?.content ?? '0';
        const rank = parseInt(row.fixedCells?.[0]?.content, 10);
        const place = Number.isFinite(rank) ? ` \u00b7 ${rank}${['th', 'st', 'nd', 'rd'][rank % 100 > 10 && rank % 100 < 14 ? 0 : rank % 10 < 4 ? rank % 10 : 0]}` : '';
        if (teamId) byTeam[teamId] = `${cell('win')}-${cell('loss')}-${cell('tie')}${place}`;
      }
      standings = { at: Date.now(), byTeam };
    } catch {
      standings = { at: Date.now(), byTeam: standings?.byTeam ?? {} };
    } finally {
      standingsPending = false;
    }
  };

  // Team names with their season record under the score, on the Summary tab only
  const ensureTeamsRow = () => {
    const host = document.querySelector(`${ROOT} section.content__main__rows`);
    const headers = [...document.querySelectorAll(`${ROOT} league-livescoring-table-header`)].slice(0, 2);
    const names = teamNames();
    let bar = host?.querySelector(':scope > .fx-teams');
    if (!host || headers.length < 2 || !names || !isSummary()) {
      bar?.remove();
      return;
    }
    loadStandings();
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'fx-teams';
      for (let i = 0; i < 2; i++) {
        const side = document.createElement('div');
        side.append(document.createElement('b'), document.createElement('span'));
        bar.append(side);
      }
      host.append(bar);
    }
    headers.forEach((header, i) => {
      const teamId = header.querySelector('a[href*="teamId="]')?.getAttribute('href').match(/teamId=(\w+)/)?.[1];
      const [name, record] = bar.children[i].children;
      const text = standings?.byTeam[teamId] ?? '';
      if (name.textContent !== names[i]) name.textContent = names[i];
      if (record.textContent !== text) record.textContent = text;
    });
  };

  // Short row under the score with each team's games of the week: "played 26/30 · left 8/9", effective / raw.
  // Played: games that scored (Fantrax's own count, active slots only) / all games the roster's players played.
  // Left: games that fit the lineup if it is set optimally / all games the roster's players have left.
  // (window.__fxWeekGames comes from matchup-week-score.js, window.__fxGames from matchup-effective-games.js;
  // Fantrax's own played / live / remaining chip is hidden.) Without the raw numbers only Fantrax's counts are shown.
  const ensureGamesRow = () => {
    const host = document.querySelector(`${ROOT} section.content__main__rows`);
    const headers = [...document.querySelectorAll(`${ROOT} league-livescoring-table-header`)].slice(0, 2);
    let bar = host?.querySelector(':scope > .fx-games');
    if (!host || headers.length < 2 || !teamNames()) {
      bar?.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'fx-games';
      for (let i = 0; i < 2; i++) bar.append(document.createElement('div'));
      host.append(bar);
    }
    headers.forEach((header, i) => {
      const teamId = header.querySelector('a[href*="teamId="]')?.getAttribute('href').match(/teamId=(\w+)/)?.[1];
      const info = window.__fxWeekGames?.[teamId];
      const raw = window.__fxGames?.[teamId];
      const settled = window.__fxEffSettled === lastMatchupId;
      const side = bar.children[i];
      const items = info && (raw || settled) ? [[info[0], raw?.played, 'played'], [raw?.leftEff ?? info[2], raw?.left, 'left']] : [];
      const text = items.map((item) => item.join('/')).join('|');
      if (side.dataset.fxText === text) return;
      side.dataset.fxText = text;
      side.replaceChildren();
      for (const [eff, all, label] of items) {
        const item = document.createElement('span');
        const name = document.createElement('i');
        name.textContent = `${label} `;
        const num = document.createElement('b');
        num.textContent = eff;
        item.append(name, num, all === undefined ? '' : `/${all}`);
        side.append(item);
      }
    });
  };

  // Day | Week switch of the team tabs, in the filters grid next to the Projected toggle
  const RANGES = { day: 'Day', week: 'Week' };

  const ensureRange = () => {
    const filters = document.querySelector(`${ROOT} .livescoring-mobile-filters`);
    let bar = filters?.querySelector(':scope > .fx-range');
    filters?.classList.toggle('fx-summary', isSummary());
    if (!filters || !teamNames() || isSummary()) {
      bar?.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'fx-range';
      bar.setAttribute('role', 'tablist');
      for (const [range, label] of Object.entries(RANGES)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.range = range;
        btn.textContent = label;
        btn.setAttribute('role', 'tab');
        btn.addEventListener('click', () => {
          teamRange = range;
          sync();
        });
        bar.append(btn);
      }
      filters.append(bar);
    }
    for (const btn of bar.children) btn.setAttribute('aria-selected', String(btn.dataset.range === teamRange));
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
    ensureScoreRow();
    ensureTeamsRow();
    ensureGamesRow();
    ensureRange();
    syncDateLabel();
    syncReady();
    // Until the default Summary has stuck, the tab state is not the user's choice
    if (defaulting() && !isSummary()) return;

    // Classes follow what Fantrax really shows, so a Day / Week tap never styles the previous frame's data
    const summary = isSummary();
    const hasTeams = !!teamNames();
    const day = frameIsDay();
    const framed = frames().length >= 2;
    let changed = false;
    const flag = (name, on) => {
      if (el.classList.contains(name) !== on) {
        el.classList.toggle(name, on);
        changed = true;
      }
    };
    flag('fx-team-home', hasTeams && !summary && teamMode === 'home');
    flag('fx-team-away', hasTeams && !summary && teamMode === 'away');
    // Period view (the Week range): active + bench players share one table of week totals
    flag('fx-merged', hasTeams && !summary && framed && !day);
    // The requested frame is still loading: the tables show the other frame's numbers meanwhile (dimmed by CSS)
    flag('fx-busy', hasTeams && framed && day !== wantsDay());
    // Class changes are no DOM mutations: tell the other matchup scripts (tidy, shooting splits) to re-sync
    if (changed) document.dispatchEvent(new Event('fx-matchup-state'));

    // A tab click takes a moment to show in the DOM: no frame / layout clicks until it has
    if (Date.now() < settleUntil) return;
    ensureFrame();

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
  // Fantrax can settle on its own Day view after our click without any further DOM change, so re-check regularly
  setInterval(schedule, RECHECK_MS);
  sync();
})();
