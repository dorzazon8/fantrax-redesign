// Bundles styles/fantrax.css + scripts/*.js into one userscript for iOS Safari
// (Userscripts app / Tampermonkey). Usage: node build.mjs -> dist/fantrax-redesign.user.js
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';

const css = readFileSync('styles/fantrax.css', 'utf8');
const scripts = readdirSync('scripts')
  .filter((f) => f.endsWith('.js'))
  .map((f) => `// --- ${f}\n${readFileSync(`scripts/${f}`, 'utf8')}`)
  .join('\n');

const REPO = 'dorzazon8/fantrax-redesign';
const releaseUrl = `https://github.com/${REPO}/releases/latest/download/fantrax-redesign.user.js`;
// CI passes FX_VERSION (from the git tag); local builds fall back to the date.
const version = process.env.FX_VERSION ?? new Date().toISOString().slice(0, 10).replaceAll('-', '.');

const out = `// ==UserScript==
// @name         Fantrax Mobile Redesign
// @description  Cleaner Fantrax NBA mobile UI
// @version      ${version}
// @updateURL    ${releaseUrl}
// @downloadURL  ${releaseUrl}
// @match        https://www.fantrax.com/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(() => {
  const style = document.createElement('style');
  style.id = 'fx-redesign';
  style.textContent = ${JSON.stringify(css)};
  document.head.append(style);
})();

${scripts}
`;

mkdirSync('dist', { recursive: true });
writeFileSync('dist/fantrax-redesign.user.js', out);
console.log('dist/fantrax-redesign.user.js', out.length, 'bytes');
