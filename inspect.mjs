// Attaches to the running browser and dumps the current page: URL, screenshot, HTML.
// Usage: node inspect.mjs [name]   -> writes snapshots/<name>.{png,html}
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const name = process.argv[2] ?? 'page';
const browser = await chromium.connectOverCDP('http://localhost:9222');
const pages = browser.contexts()[0].pages();
const page = pages[pages.length - 1];

mkdirSync('snapshots', { recursive: true });
await page.screenshot({ path: `snapshots/${name}.png`, fullPage: true });
writeFileSync(`snapshots/${name}.html`, await page.content());
console.log('url:', page.url());
console.log('title:', await page.title());
console.log('viewport:', JSON.stringify(page.viewportSize()));
await browser.close();
