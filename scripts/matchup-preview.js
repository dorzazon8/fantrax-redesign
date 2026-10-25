// Warms the projection data (see matchup-projection.js) for the user's matchup in the background (on every other page,
// and again every minute), so the matchup page has it ready when it is opened.
(() => {
  if (window.__fxPreview) return;
  window.__fxPreview = true;

  const REFRESH_MS = 60000;
  const FIRST_FETCH_MS = 1500;

  let fetchedAt = 0;
  let pending = false;

  const leagueId = () => location.pathname.match(/league\/(\w+)/)?.[1];
  const onMatchups = () => !!document.querySelector('app-league-livescoring');

  const warm = async () => {
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
      const matchupId = (await res.json()).responses?.[0]?.data?.displayedSelections?.matchupId;
      if (!matchupId) return;
      fetchedAt = Date.now();
      window.__fxProjectionWarm?.(matchupId);
    } catch {
      // the next refresh tries again
    } finally {
      pending = false;
    }
  };

  setTimeout(warm, FIRST_FETCH_MS);
  setInterval(() => {
    if (!onMatchups() && Date.now() - fetchedAt > REFRESH_MS && !document.hidden) warm();
  }, 500);
})();
