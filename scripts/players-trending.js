// Players page, Stats tab: a "Trending" strip of cards above the table, the available players whose rostered %
// rose the most (the same "+/-" Fantrax shows in the table, sorted descending). The list comes from the page's own
// getPlayerStats request, so it always follows the league's current default player filter.
(() => {
  if (window.__fxTrending) return;
  window.__fxTrending = true;

  const COUNT = 12;
  const CACHE_MS = 5 * 60 * 1000;
  const GENERIC = new Set(['G', 'F']);
  const COLLAPSED_KEY = 'fx-trending-collapsed';
  const SORT = 'OVERVIEW_PLUS_MINUS_PERCENT_OWNED_2';

  let cache = null; // { leagueId, at, players }
  let pending = false;
  let node = null;

  const leagueId = () => location.pathname.match(/league\/(\w+)/)?.[1];

  const onStatsTab = () => {
    const root = document.querySelector('app-league-players');
    const selected = root?.querySelector('.tabs__item--selected');
    return !!root && !!selected && /^stats$/i.test(selected.textContent.trim());
  };

  const trimPositions = (text) => {
    const all = (text || '').split(',').filter(Boolean);
    const kept = all.filter((p) => !GENERIC.has(p.toUpperCase()));
    return (kept.length ? kept : all).join(', ');
  };

  const load = async () => {
    const id = leagueId();
    if (!id || pending) return;
    pending = true;
    try {
      const res = await fetch(`/fxpa/req?leagueId=${id}`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({
          msgs: [{ method: 'getPlayerStats', data: { scoringCategoryType: '1', pageNumber: '1', sortType: SORT } }],
          uiv: 3,
          refUrl: location.href,
        }),
      });
      const data = (await res.json()).responses?.[0]?.data;
      const cells = data?.tableHeader?.cells ?? [];
      const rosIdx = cells.findIndex((c) => c.sortType === 'OVERVIEW_PERCENT_OWNED_2');
      const changeIdx = cells.findIndex((c) => c.sortType === SORT);
      if (rosIdx < 0 || changeIdx < 0) throw new Error('columns not found');
      const players = (data.statsTable ?? [])
        .filter((r) => r.scorer && r.cells?.[changeIdx]?.gainColor === 1)
        .slice(0, COUNT)
        .map((r) => ({
          id: r.scorer.scorerId,
          name: r.scorer.shortName,
          fullName: r.scorer.name,
          team: r.scorer.teamShortName,
          pos: trimPositions(r.scorer.posShortNames),
          photo: r.scorer.headshotUrl,
          ros: r.cells[rosIdx].content,
          change: r.cells[changeIdx].content,
        }));
      cache = { leagueId: id, at: Date.now(), players };
    } catch {
      cache = { leagueId: id, at: Date.now() - CACHE_MS + 30000, players: [] }; // retry in 30 s
    } finally {
      pending = false;
      schedule();
    }
  };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms) => {
    for (const end = Date.now() + ms; Date.now() < end; await wait(100)) {
      const v = fn();
      if (v) return v;
    }
    return null;
  };

  const nameLinkOf = (id) => {
    for (const fig of document.querySelectorAll('app-league-players .i-table__body figure.scorer__image')) {
      const bg = fig.style.backgroundImage || getComputedStyle(fig).backgroundImage;
      if (bg.includes(`/hs${id}_`)) return fig.closest('.i-table__row')?.querySelector('.scorer__info__name a');
    }
    return null;
  };

  const searchBox = () => document.querySelector('app-league-players input.mat-mdc-input-element');

  const search = (input, text) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    for (const type of ['keydown', 'keypress', 'keyup']) input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  };

  // The table is not filtered on this player any more once his card is closed (refreshing it under the card would close it)
  const clearSearchWhenClosed = async () => {
    while (document.querySelector('player-profile-content')) await wait(500);
    if (searchBox()?.value) search(searchBox(), '');
  };

  let opening = false;

  // Opens Fantrax's own player card through the matching table row. A trending player is often not on the shown page
  // of the table, so he is searched by name first.
  const openCard = async (player) => {
    if (opening) return;
    opening = true;
    try {
      let link = nameLinkOf(player.id);
      if (!link && searchBox()) {
        search(searchBox(), player.fullName ?? player.name);
        link = await until(() => nameLinkOf(player.id), 6000);
      }
      if (!link) return;
      link.click();
      if (await until(() => document.querySelector('player-profile-content'), 6000)) clearSearchWhenClosed();
    } finally {
      opening = false;
    }
  };

  const el = (tag, className, text) => {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  const build = (players) => {
    const section = el('section', 'fx-trend');
    const head = el('button', 'fx-trend__head');
    head.type = 'button';
    head.append(el('span', 'fx-trend__icon'), el('h3', '', 'Trending'), el('span', 'fx-trend__sub', 'rostered % up'), el('span', 'fx-trend__chevron'));
    section.toggleAttribute('data-collapsed', localStorage.getItem(COLLAPSED_KEY) === '1');
    head.addEventListener('click', () => {
      const now = section.toggleAttribute('data-collapsed');
      localStorage.setItem(COLLAPSED_KEY, now ? '1' : '0');
    });

    const list = el('div', 'fx-trend__list');
    for (const p of players) {
      const card = el('button', 'fx-trend__card');
      card.type = 'button';
      const photo = el('figure', 'fx-trend__photo');
      if (/^https:\/\/fantraximg\.com\//.test(p.photo ?? '')) photo.style.backgroundImage = `url("${p.photo}")`;
      const meta = [p.team, p.pos].filter(Boolean).join(' · ');
      const stat = el('span', 'fx-trend__stat');
      stat.append(el('span', '', p.ros), el('b', '', `${p.change} ▲`));
      card.append(photo, el('span', 'fx-trend__name', p.name), el('span', 'fx-trend__meta', meta), stat);
      card.addEventListener('click', () => openCard(p));
      list.append(card);
    }
    section.append(head, list);
    return section;
  };

  const sync = () => {
    const anchor = onStatsTab() ? document.querySelector('app-league-players .fx-layout__pane--tab-group') : null;
    if (!anchor) {
      node?.remove();
      node = null;
      return;
    }
    const id = leagueId();
    if (!cache || cache.leagueId !== id || Date.now() - cache.at > CACHE_MS) {
      load();
      if (!cache || cache.leagueId !== id) return;
    }
    if (!cache.players.length) {
      node?.remove();
      node = null;
      return;
    }
    if (node && node.__fxAt === cache.at && node.previousElementSibling === anchor) return;
    node?.remove();
    node = build(cache.players);
    node.__fxAt = cache.at;
    anchor.after(node);
  };

  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      sync();
    });
  }

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  sync();
})();
