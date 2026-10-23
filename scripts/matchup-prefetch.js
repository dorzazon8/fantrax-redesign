// Matchup prefetch: Fantrax loads the matchup with one getLiveScoringStats request per view (Summary and the team
// tabs' Day / Week frames), so every switch waits for a round trip. This script loads the views of the open matchup
// ahead of time and keeps them fresh, and answers Fantrax's own request for a view from that copy.
//  - Responses are cached by request data (the matchup, view and date) for TTL_MS and shared with requests in flight.
//  - After each of Fantrax's requests the other views of the same matchup are prefetched, then refreshed every REFRESH_MS.
// Fantrax calls window.fetch for every request, so wrapping it is enough; where it does not, requests just go out as before.
(() => {
  if (window.__fxPrefetch) return;
  window.__fxPrefetch = true;

  const TTL_MS = 20000;
  const REFRESH_MS = 15000;
  const FORGET_MS = 120000;
  const DEBOUNCE_MS = 300;
  const METHOD = 'getLiveScoringStats';
  // [mainView, viewType]: Summary uses the Period view, the team tabs the Day (1) and Period (2) views
  const VIEWS = [
    ['SUMMARY', '2'],
    ['MATCHUP', '1'],
    ['MATCHUP', '2'],
  ];

  const nativeFetch = window.fetch;
  const cache = new Map(); // key -> { at, promise: Promise<{ status, text }> }
  let template = null; // the latest request of Fantrax itself: { url, body, init }
  let timer = 0;

  const parse = (input, init) => {
    const url = typeof input === 'string' ? input : input?.url;
    if (!url || !/\/fxpa\/req/.test(url) || typeof init?.body !== 'string') return null;
    try {
      const body = JSON.parse(init.body);
      if (!body.msgs?.some((m) => m.method === METHOD)) return null;
      return { url, body, init };
    } catch {
      return null;
    }
  };

  // Fantrax sends the stats together with other messages (the scores summary); all of them tell the requests apart
  const keyOf = ({ url, body }) => `${url}|${JSON.stringify(body.msgs.map((m) => [m.method, Object.entries(m.data ?? {}).sort()]))}`;

  const respond = ({ status, text }) => new Response(text, { status, headers: { 'content-type': 'application/json' } });

  const fetchRaw = (req, init) => nativeFetch.call(window, req.url, init).then(async (res) => ({ status: res.status, text: await res.text() }));

  const load = (req, init) => {
    const key = keyOf(req);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
    const promise = fetchRaw(req, init);
    const entry = { at: Date.now(), promise };
    cache.set(key, entry);
    // a failed request is not kept: the next one (Fantrax's own retry included) goes out again
    promise.then(
      (r) => r.status !== 200 && cache.get(key) === entry && cache.delete(key),
      () => cache.get(key) === entry && cache.delete(key),
    );
    return promise;
  };

  // A refresh replaces the entry only once it has arrived, so a tap meanwhile is still answered from the older copy
  const refreshing = new Set();
  const refresh = (req, init) => {
    const key = keyOf(req);
    const hit = cache.get(key);
    if (!hit) return load(req, init).catch(() => {});
    if (Date.now() - hit.at < REFRESH_MS - 1000 || refreshing.has(key)) return;
    refreshing.add(key);
    fetchRaw(req, init)
      .then((r) => r.status === 200 && cache.set(key, { at: Date.now(), promise: Promise.resolve(r) }))
      .catch(() => {})
      .finally(() => refreshing.delete(key));
  };

  window.fetch = function (input, init) {
    const req = parse(input, init);
    if (!req) return nativeFetch.apply(this, arguments);
    // other scripts of this userscript send the same request without Fantrax's client info (tz): not a template
    if ('tz' in req.body) template = req;
    schedule();
    return load(req, init).then(respond);
  };

  const prefetch = () => {
    if (!template || !/livescoring/.test(location.pathname) || document.visibilityState === 'hidden') return;
    for (const [mainView, viewType] of VIEWS) {
      const msgs = template.body.msgs.map((m) => (m.method === METHOD ? { ...m, data: { ...m.data, mainView, viewType } } : m));
      const body = { ...template.body, msgs };
      refresh({ url: template.url, body }, { ...template.init, body: JSON.stringify(body) });
    }
    for (const [key, entry] of cache) if (Date.now() - entry.at > FORGET_MS) cache.delete(key);
  };

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(prefetch, DEBOUNCE_MS);
  }

  setInterval(prefetch, REFRESH_MS);
})();
