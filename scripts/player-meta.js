// Player subtitle everywhere: "BOS - SF, PF" (team first, then positions) instead of "SF,PF,F - BOS".
// The generic G and F eligibilities are dropped to keep the list short.
// Angular owns the spans, so they are only tagged (data-fx-pos / data-fx-team); CSS renders the new text.
(() => {
  if (window.__fxPlayerMeta) return;
  window.__fxPlayerMeta = true;

  const GENERIC = new Set(['G', 'F']);

  const setAttr = (el, name, value) => {
    if (value === null) {
      if (el.hasAttribute(name)) el.removeAttribute(name);
    } else if (el.getAttribute(name) !== value) {
      el.setAttribute(name, value);
    }
  };

  const format = (el) => {
    let pos = null;
    let team = null;
    for (const child of el.children) {
      if (child.classList.contains('scorer-icon')) continue;
      const text = child.textContent.trim();
      const teamMatch = text.match(/^-\s*(.+)$/);
      if (teamMatch) {
        team = child;
        team.__fxValue = teamMatch[1].replace(/^\((.+)\)$/, '$1');
      } else if (!pos && /^[A-Za-z]{1,3}(\s*,\s*[A-Za-z]{1,3})*$/.test(text)) {
        pos = child;
        const all = text.split(/\s*,\s*/);
        const kept = all.filter((p) => !GENERIC.has(p.toUpperCase()));
        pos.__fxValue = (kept.length ? kept : all).join(', ');
      }
    }
    if (!pos || !team) {
      for (const child of el.children) {
        setAttr(child, 'data-fx-pos', null);
        setAttr(child, 'data-fx-team', null);
      }
      setAttr(el, 'data-fx-meta', null);
      return;
    }
    setAttr(pos, 'data-fx-pos', pos.__fxValue);
    setAttr(team, 'data-fx-team', team.__fxValue);
    setAttr(el, 'data-fx-meta', '');
  };

  const sync = () => {
    for (const el of document.querySelectorAll('.scorer__info__positions')) format(el);
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
