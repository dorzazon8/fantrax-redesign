const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');

test('rightmost menu and its backdrop remain clickable outside the floating bar', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 664 } });
  try {
    await page.setContent(`
      <style>
        nav-mobile-menu { bottom: 0; width: 100%; overflow: hidden; }
        .nav-mobile__backdrop { position: fixed; inset: 0; }
        nav-mobile-popup { position: fixed; left: 0; right: 0; bottom: 80px; height: 180px; }
      </style>
      <nav-mobile-menu class="nav-mobile-menu nav-mobile-menu--open">
        <div class="nav-mobile__backdrop"></div>
        <nav-mobile-popup><button>Menu item</button></nav-mobile-popup>
        <div class="nav-mobile-menu__bar"><button class="nav-mobile-menu__league">Menu</button></div>
      </nav-mobile-menu>
    `);
    await page.addStyleTag({ path: path.join(__dirname, '..', 'styles', 'fantrax.css') });
    await page.evaluate(() => {
      document.querySelector('nav-mobile-popup button').addEventListener('click', () => document.body.dataset.itemClicked = 'yes');
      document.querySelector('.nav-mobile__backdrop').addEventListener('click', () => document.body.dataset.dismissed = 'yes');
    });
    await page.getByRole('button', { name: 'Menu item' }).click({ timeout: 5000 });
    assert.equal(await page.locator('body').getAttribute('data-item-clicked'), 'yes');
    await page.locator('.nav-mobile__backdrop').click({ position: { x: 10, y: 10 }, timeout: 5000 });
    assert.equal(await page.locator('body').getAttribute('data-dismissed'), 'yes');
  } finally {
    await browser.close();
  }
});
