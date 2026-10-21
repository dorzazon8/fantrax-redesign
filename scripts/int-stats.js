// Show whole-number stats as ints ("3.0" -> "3"); real decimals ("2.5") and
// 3-decimal percentages (".714", "1.000") are left untouched.
(() => {
  if (window.__fxIntStats) return;
  window.__fxIntStats = true;

  const WHOLE_DECIMAL = /^(-?\d+)\.0$/;
  const CELL = '.i-table__cell';

  const fixText = (node) => {
    if (!node.parentElement?.closest(CELL)) return;
    const m = WHOLE_DECIMAL.exec(node.nodeValue.trim());
    if (m) node.nodeValue = m[1];
  };

  const fixTree = (root) => {
    if (root.nodeType === Node.TEXT_NODE) return fixText(root);
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) fixText(n);
  };

  new MutationObserver((mutations) => {
    for (const mu of mutations) {
      if (mu.type === 'characterData') fixText(mu.target);
      else mu.addedNodes.forEach(fixTree);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  fixTree(document.body);
})();
