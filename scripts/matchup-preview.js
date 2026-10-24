// Matchup page entry: the Summary totals of the user's matchup are fetched in the background (on every other page, and
// again every minute) so that tapping Matchups shows them at once, while Fantrax and the other matchup scripts still fill
// in the real page behind it. The preview fades out when that page is ready (fx-ready, see matchup-espn.js).
// It also warms the projection data (see matchup-projection.js) for the same matchup.
(() => {
  if (window.__fxPreview) return;
  window.__fxPreview = true;

  const REFRESH_MS = 60000;
  const FIRST_FETCH_MS = 1500;
  const MAX_SHOW_MS = 10000;
  const LOWER_WINS = new Set(['TO']);

  let data = null; // { at, names: [a, b], rows: [{ name, a, b }] }
  let pending = false;
  let overlay = null;
  let shownAt = 0;

  const leagueId = () => location.pathname.match(/league\/(\w+)/)?.[1];
  const onMatchups = () => !!document.querySelector('app-league-livescoring');

  const fetchPreview = async () => {
    if (pending || !leagueId()) return;
    pending = true;
    try {
      const res = await fetch(`/fxpa/req?leagueId=${leagueId()}`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({
          msgs: [{ method: 'getLiveScoringStats', data: { sppId: '-1', mobileMatchupView: true, teamId: 'ALL', layout: 'DETAILED', mainView: 'SUMMARY', mobileView: 'MATCHUPS', viewType: '2', newView: true } }],
          uiv: 3,
          refUrl: location.href,
        }),
      });
      const d = (await res.json()).responses?.[0]?.data;
      const matchupId = d?.displayedSelections?.matchupId;
      if (!matchupId) return;
      const ids = matchupId.split('_');
      const cats = (d.scoringCategoriesPerGroup?.['3010'] ?? []).filter((c) => c.shortName !== 'GP');
      const totals = ids.map((id) => {
        const byCat = {};
        for (const c of d.statsPerTeam?.allTeamsStats?.[id]?.ACTIVE?.statsMap?._3010?.object2 ?? []) byCat[c.scipId.split('#')[1]] = c.av ?? 0;
        return byCat;
      });
      data = {
        at: Date.now(),
        names: ids.map((id) => d.fantasyTeamInfo?.[id]?.name ?? ''),
        rows: cats.map((c) => ({ name: c.shortName, a: totals[0][c.id.split('#')[1]] ?? 0, b: totals[1][c.id.split('#')[1]] ?? 0 })),
      };
      window.__fxProjectionWarm?.(matchupId);
      if (overlay) render();
    } catch {
      // the next refresh tries again
    } finally {
      pending = false;
    }
  };

  const format = (name, v) => (name.endsWith('%') ? v.toFixed(3).replace(/^0/, '') : String(Math.round(v)));

  const render = () => {
    if (!overlay || !data) return;
    const html = [`<div class="fx-pre__teams"><b>${esc(data.names[0])}</b><b>${esc(data.names[1])}</b></div>`];
    for (const { name, a, b } of data.rows) {
      const [x, y] = [format(name, a), format(name, b)];
      const lead = x === y ? -1 : (LOWER_WINS.has(name) ? a < b : a > b) ? 0 : 1;
      html.push(
        `<div class="fx-pre__row"><span class="${lead === 0 ? 'fx-pre__lead' : ''}">${x}</span><i>${esc(name)}</i><span class="${lead === 1 ? 'fx-pre__lead' : ''}">${y}</span></div>`,
      );
    }
    if (overlay.dataset.fxHtml !== html.join('')) {
      overlay.dataset.fxHtml = html.join('');
      overlay.innerHTML = overlay.dataset.fxHtml;
    }
  };

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  const show = () => {
    if (!data) return;
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'fx-pre';
      document.body.append(overlay);
    }
    const headline = document.querySelector('app-league-livescoring headline');
    overlay.style.top = `${headline ? headline.getBoundingClientRect().bottom : 70}px`;
    render();
    shownAt = Date.now();
    requestAnimationFrame(() => overlay?.classList.add('fx-pre--on'));
  };

  const hide = () => {
    if (!overlay) return;
    const el = overlay;
    overlay = null;
    el.classList.remove('fx-pre--on');
    setTimeout(() => el.remove(), 300);
  };

  const check = () => {
    if (overlay && (document.querySelector('app-league-livescoring.fx-ready') || Date.now() - shownAt > MAX_SHOW_MS)) hide();
    if (!onMatchups() && !pending && (!data || Date.now() - data.at > REFRESH_MS) && !document.hidden) fetchPreview();
  };

  document.addEventListener(
    'click',
    (e) => {
      if (e.target.closest?.('.nav-mobile-menu__button')?.textContent.includes('Matchups') && !onMatchups()) show();
    },
    true,
  );

  setTimeout(fetchPreview, FIRST_FETCH_MS);
  setInterval(check, 500);
})();
