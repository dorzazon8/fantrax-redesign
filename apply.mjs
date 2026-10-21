// Injects styles/fantrax.css into the live page (and every future navigation) for fast iteration.
// Usage: node apply.mjs [shot-name]   -> re-injects CSS, writes snapshots/<shot-name>.png
import { chromium } from 'playwright';
import { readFileSync, readdirSync } from 'node:fs';

const css = readFileSync('styles/fantrax.css', 'utf8');
const scripts = readdirSync('scripts')
  .filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(`scripts/${f}`, 'utf8'));
const shot = process.argv[2] ?? 'after';
const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];

for (const page of ctx.pages()) {
  await page.evaluate((css) => {
    document.getElementById('fx-redesign')?.remove();
    const el = document.createElement('style');
    el.id = 'fx-redesign';
    el.textContent = css;
    document.head.append(el);
  }, css);
  for (const code of scripts) await page.evaluate(code);
}
const pages = ctx.pages();
await pages[pages.length - 1].screenshot({ path: `snapshots/${shot}.png` });
await browser.close();
