const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');

const script = (name) => path.join(__dirname, '..', 'scripts', name);
const css = path.join(__dirname, '..', 'styles', 'fantrax.css');

test('analyzer loads the next opponent and returns to the current matchup', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const requests = [];
  let unavailable = false;
  const roster = {
    displayedSelections: { displayedFantasyTeamId: 'me', displayedPeriod: '4', displayedStartDate: '2026-01-01' },
    periodOppnentTeamIds: ['old'],
    fantasyTeams: [{ id: 'me', name: 'Me' }, { id: 'old', name: 'Old opponent' }, { id: 'new', name: 'New opponent' }],
    miscData: { transactionInfo: { info: [{ name: 'Claims Remaining (Week)', value: 0 }] } },
    tables: [{ header: { cells: ['Opp', 'GP', 'PTS'].map((shortName) => ({ shortName })) }, rows: [
      { scorer: { scorerId: 'player', name: 'Player' }, statusId: '1', posId: '307', eligiblePosIds: ['307'], cells: [{ content: 'game' }, { content: '10' }, { content: '2' }] },
    ] }],
  };
  await page.route('https://test.local/**', async (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ contentType: 'text/html', body: '<nav-mobile-menu><div class="nav-mobile-menu__bar"><a class="nav-mobile-menu__button" href="/livescoring">Matchups</a></div></nav-mobile-menu>' });
    const { msgs } = route.request().postDataJSON();
    requests.push(...msgs);
    const responses = msgs.map(({ method, data }) => {
      if (method === 'getTeamRosterInfo') {
        const row = roster.tables[0].rows[0];
        const cells = data.timeframeTypeCode === 'BY_PERIOD' ? [row.cells[0], row.cells[1], { content: '100' }] : row.cells;
        const rows = [{ ...row, cells }];
        if (data.teamId === 'old' || data.teamId === 'new') {
          rows.push({ statusId: '1', posId: '307', cells: [] });
          rows.push({ ...row, scorer: { scorerId: 'bench', name: 'Bench player' }, statusId: '2', cells });
          rows.push({ ...row, scorer: { scorerId: 'extra', name: 'Extra player' }, statusId: '2', cells });
        }
        return { data: { ...roster, tables: [{ ...roster.tables[0], rows }] } };
      }
      if (method === 'getLiveScoringStats') return { data: data.date
        ? { displayPeriod: unavailable ? 'Jan 1, 2026 - Jan 7, 2026' : 'Jan 8, 2026 - Jan 14, 2026', matchups: ['new_me'] }
        : { displayPeriod: 'Jan 1, 2026 - Jan 7, 2026', matchups: ['me_old'] } };
      return { data: { statsTable: [], tableHeader: { cells: [] } } };
    });
    return route.fulfill({ json: { responses } });
  });
  try {
    await page.goto('https://test.local/league/test/home');
    await page.addScriptTag({ path: script('match-analyzer.js') });
    await page.locator('.fx-analyzer-btn').click();
    await page.getByText('Old opponent', { exact: true }).first().waitFor();
    assert.equal(await page.locator('.fx-an__claims b').textContent(), '0');
    assert.equal(await page.locator('.fx-an__catval.is-opp').nth(8).textContent(), '406');
    const before = requests.length;
    await page.getByRole('button', { name: 'Next week', exact: true }).click();
    await page.getByText('New opponent', { exact: true }).first().waitFor();
    assert.match(await page.locator('.fx-an__sub').textContent(), /Jan 8 - Jan 14/);
    assert.equal(await page.locator('.fx-an__claims').count(), 0);
    assert.equal(await page.locator('.fx-an__catval').nth(8).textContent(), '14');
    assert.equal(await page.locator('.fx-an__catval.is-opp').nth(8).textContent(), '28');
    assert.equal(await page.getByText('Both lineups maximize games').count(), 1);
    const next = requests.slice(before);
    assert.ok(next.some((m) => m.method === 'getLiveScoringStats' && m.data.date === '2026-01-08'));
    assert.ok(next.some((m) => m.method === 'getTeamRosterInfo' && m.data.teamId === 'new' && m.data.period === '8'));
    assert.ok(!next.some((m) => m.method === 'getTeamRosterInfo' && m.data.period === '4' && m.data.timeframeTypeCode === 'BY_PERIOD'));
    await page.getByRole('button', { name: 'Current week' }).click();
    await page.getByText('Old opponent', { exact: true }).first().waitFor();
    assert.equal(await page.locator('.fx-an__catval.is-opp').nth(8).textContent(), '406');
    unavailable = true;
    await page.getByRole('button', { name: 'Next week', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.match(await page.locator('.fx-an__sub').textContent(), /Jan 1 - Jan 7/);
    assert.equal(await page.getByRole('button', { name: 'Next week', exact: true }).count(), 1);
  } finally {
    await browser.close();
  }
});

test('summary exposes native week arrows without exposing them in team week view', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route('https://test.local/**', (route) => route.fulfill({ contentType: 'text/html', body: `
    <app-league-livescoring><section class="content__main__rows">
      <div class="tabs__item">Matchup</div><div class="tabs__item tabs__item--selected">Summary</div>
      <div class="scoring-header__name">Home</div><div class="scoring-header__name">Away</div>
      <div class="league-livescoring-summary__row"></div>
      <div class="livescoring-mobile-filters"><league-livescoring-filters-period><mat-form-field>
        <div class="mat-mdc-select-value"><span class="mat-mdc-select-value-text">1 (Jan 1 - Jan 7)</span></div>
        <div class="mat-mdc-form-field-icon-suffix"><button>prev</button><button>next</button></div>
      </mat-form-field></league-livescoring-filters-period>
      <pill-group aria-label="Timeframes"><button></button><button class="mat-sport"></button></pill-group></div>
    </section></app-league-livescoring>` }));
  try {
    await page.goto('https://test.local/league/test/livescoring?matchupId=home_away');
    await page.addStyleTag({ path: css });
    await page.addScriptTag({ path: script('matchup-espn.js') });
    const next = page.getByRole('button', { name: 'Next week' });
    await next.waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('button', { name: 'Previous week' }).isVisible(), true);
    await page.evaluate(() => {
      document.querySelectorAll('.mat-mdc-form-field-icon-suffix button').forEach((button) => {
        button.addEventListener('click', () => button.setAttribute('data-clicked', 'yes'));
      });
    });
    await next.click();
    await page.getByRole('button', { name: 'Previous week' }).click();
    assert.equal(await page.locator('.mat-mdc-form-field-icon-suffix button[data-clicked="yes"]').count(), 2);
    await page.evaluate(() => {
      document.querySelectorAll('.tabs__item')[1].classList.remove('tabs__item--selected');
    });
    await page.waitForFunction(() => document.querySelector('.livescoring-mobile-filters')?.classList.contains('fx-week') && !document.querySelector('.livescoring-mobile-filters')?.classList.contains('fx-summary'));
    assert.equal(await page.locator('.mat-mdc-form-field-icon-suffix button').last().isVisible(), false);
  } finally {
    await browser.close();
  }
});

test('summary game counts are fetched and cached by selected week', async () => {
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      const dates = [];
      await page.route('https://test.local/**', async (route) => {
        if (route.request().method() !== 'POST') return route.fulfill({ contentType: 'text/html', body: '<app-league-livescoring></app-league-livescoring>' });
        const { msgs } = route.request().postDataJSON();
        const responses = msgs.map(({ method, data }) => {
          if (method === 'getTeamRosterInfo') return { data: {
            displayedSelections: { displayedPeriod: '4', displayedStartDate: '2026-01-01' },
            tables: [{ header: { cells: [] }, rows: [] }],
          } };
          if (method === 'getLiveScoringStats') {
            dates.push(data.date ?? '');
            const next = data.date === '2026-01-08';
            const count = next ? 9 : 3;
            return { data: {
              displayPeriod: next ? 'Jan 8, 2026 - Jan 14, 2026' : 'Jan 1, 2026 - Jan 7, 2026',
              matchups: ['home_away'],
              matchupMap: { home_away: 'key' },
              statsPerTeam: { allTeamsStats: {
                home: { ACTIVE: { playerGameInfo: [count, 0, count] } },
                away: { ACTIVE: { playerGameInfo: [count, 0, count] } },
              } },
            } };
          }
          return { data: {} };
        });
        return route.fulfill({ json: { responses } });
      });
      try {
        await page.goto('https://test.local/league/test/livescoring?matchupId=home_away');
        await page.addScriptTag({ path: script('matchup-week-score.js') });
        await page.addScriptTag({ path: script('matchup-effective-games.js') });
        await page.waitForFunction(() => window.__fxWeekGames?.home?.[0] === 3 && window.__fxEffSettled === 'home_away|');
        await page.evaluate(() => {
          history.pushState({}, '', '/league/test/livescoring;date=2026-01-08?matchupId=home_away');
          document.querySelector('app-league-livescoring').append(document.createElement('span'));
        });
        await page.waitForFunction(() => window.__fxWeekGamesKey === 'home_away|2026-01-08' && window.__fxWeekGames?.home?.[0] === 9 && window.__fxEffSettled === 'home_away|2026-01-08');
        assert.ok(dates.includes('2026-01-08'));
        assert.deepEqual(await page.evaluate(() => window.__fxGames.home), { played: 0, left: 0, leftEff: 0 });
      } finally {
        await browser.close();
      }
});
