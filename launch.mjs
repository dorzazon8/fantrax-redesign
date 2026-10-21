// Launches a headed, mobile-emulated Chromium with a persistent profile (login survives restarts).
// Exposes CDP on :9222 so other scripts (inspect.mjs) can attach to the same logged-in session.
import { chromium, devices } from 'playwright';

const ctx = await chromium.launchPersistentContext('./.profile', {
  ...devices['iPhone 14'],
  headless: false,
  args: ['--remote-debugging-port=9222'],
});

const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto('https://www.fantrax.com/login');
console.log('Browser ready. Log in, then tell the assistant. Ctrl+C to quit.');
await new Promise(() => {});
