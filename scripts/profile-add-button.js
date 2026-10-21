// Player card: tags the add (+) button with the player's availability (data-fx-st = "FA" or "W") so CSS can colour it
// like the Players page: green = free agent, yellow = on waivers.
// The Players list already knows each row's availability, so it is matched by headshot id. Without a list row
// (card opened from another page) Fantrax's own green button means free agent and any other add button means waivers.
(() => {
  if (window.__fxProfileAdd) return;
  window.__fxProfileAdd = true;

  const idOf = (el) => el?.style.backgroundImage.match(/\/hs(\w+?)_/)?.[1];

  const setAttr = (el, name, value) => {
    if (value === null) {
      if (el.hasAttribute(name)) el.removeAttribute(name);
    } else if (el.getAttribute(name) !== value) {
      el.setAttribute(name, value);
    }
  };

  const listStatus = (id) => {
    if (!id) return null;
    for (const row of document.querySelectorAll('app-league-players .i-table__body .i-table__row[data-fx-st]')) {
      if (idOf(row.querySelector('.scorer__image')) === id) return row.dataset.fxSt;
    }
    return null;
  };

  const sync = () => {
    for (const card of document.querySelectorAll('player-profile-content')) {
      const id = idOf(card.querySelector('.player-profile__header__image'));
      for (const tx of card.querySelectorAll('.button-group--player-profile player-tx')) {
        const btn = tx.querySelector('button');
        const isAdd = btn?.querySelector('mat-icon')?.textContent.trim() === 'add';
        const status = isAdd ? (listStatus(id) ?? (btn.classList.contains('mat-green--fill') ? 'FA' : 'W')) : null;
        setAttr(tx, 'data-fx-st', status);
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

  new MutationObserver(schedule).observe(document.body, {
    childList: true,
    subtree: true,
  });
  sync();
})();
