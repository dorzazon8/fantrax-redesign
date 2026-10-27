// Player page (/player/<id>/<league>, opened from the Trending cards): Fantrax shows the card as a plain page there, so it
// gets what the card dialog has: the close button (Fantrax hides it on a page, but it already goes back) and the player info
// folded behind "more". Angular owns the page, so the content is only tagged (data-fx-page) and one button is added.
(() => {
  if (window.__fxPlayerPage) return;
  window.__fxPlayerPage = true;

  const sync = () => {
    for (const content of document.querySelectorAll('player-profile-content')) {
      if (content.closest('.mat-mdc-dialog-surface')) continue;
      if (!content.hasAttribute('data-fx-page')) content.setAttribute('data-fx-page', '');
      const bio = content.querySelector('.player-profile__bio');
      const row = content.querySelector('.player-profile__mobile-actions');
      if (bio && row && !content.querySelector('.fx-more')) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'fx-more';
        more.innerHTML = '<span class="fx-more__chev"></span>more';
        more.addEventListener('click', () => {
          const open = content.toggleAttribute('data-fx-open');
          more.firstChild.classList.toggle('is-open', open);
        });
        row.append(more);
      }
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

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  sync();
})();
