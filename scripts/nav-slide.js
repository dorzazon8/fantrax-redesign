// Bottom nav: the highlight behind the current page is one pill that slides to the pressed page instead of
// disappearing from one button and appearing on the next. Angular owns the buttons (it only moves their "current"
// class), so the pill is an extra child of the bar that follows whichever button is current; CSS hides the
// per-button highlight once the bar has data-fx-slide.
(() => {
  if (window.__fxNavSlide) return;
  window.__fxNavSlide = true;

  const PILL = 'fx-nav-pill';

  // The analyzer page sits above the Fantrax page that is still current underneath it
  const currentButton = (bar) => bar.querySelector('.fx-analyzer-btn.current') ?? bar.querySelector('.nav-mobile-menu__button.current');

  const sync = () => {
    const bar = document.querySelector('nav-mobile-menu .nav-mobile-menu__bar');
    if (!bar) return;
    let pill = bar.querySelector(`.${PILL}`);
    if (!pill) {
      pill = document.createElement('span');
      pill.className = PILL;
      pill.setAttribute('aria-hidden', 'true');
      bar.prepend(pill);
    }
    const btn = currentButton(bar);
    if (!btn || !btn.offsetWidth) {
      pill.style.opacity = '0';
      return;
    }
    if (!bar.hasAttribute('data-fx-slide')) bar.setAttribute('data-fx-slide', '');
    const x = `translate(${btn.offsetLeft}px, ${btn.offsetTop}px)`;
    const first = pill.style.opacity !== '1';
    if (first) pill.style.transition = 'none';
    if (pill.style.transform !== x) pill.style.transform = x;
    const size = { width: `${btn.offsetWidth}px`, height: `${btn.offsetHeight}px` };
    for (const [k, v] of Object.entries(size)) if (pill.style[k] !== v) pill.style[k] = v;
    pill.style.opacity = '1';
    if (first) {
      // the pill appears in place; only later moves animate
      void pill.offsetWidth;
      pill.style.transition = '';
    }
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

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', schedule);
  setInterval(schedule, 1000);
  sync();
})();
