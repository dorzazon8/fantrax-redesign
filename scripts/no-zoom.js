// Behaves like an app: no pinch zoom and no double-tap zoom.
// The Android app already disables zoom in its WebView; this covers the userscript in a browser.
// iOS Safari ignores user-scalable=no, so the pinch gesture is blocked explicitly as well.
(() => {
  if (window.__fxNoZoom) return;
  window.__fxNoZoom = true;

  const LOCKED = ['maximum-scale=1', 'user-scalable=no'];

  const lockViewport = () => {
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport';
      document.head.append(meta);
    }
    const kept = meta.content.split(',').map((s) => s.trim()).filter((s) => s && !/^(maximum-scale|minimum-scale|user-scalable)\b/.test(s));
    const content = (kept.length ? kept : ['width=device-width', 'initial-scale=1']).concat(LOCKED).join(', ');
    if (meta.content !== content) meta.content = content;
  };

  lockViewport();
  new MutationObserver(lockViewport).observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['content'] });

  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => e.preventDefault());
  }
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );
})();
