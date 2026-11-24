// The pages the app shows (it loads inkwell.com.br), on phone screens: iPhone (WebKit) and Android (Chromium).
// This tests the web content in mobile emulation, not the native app. Needs the site served on :8080
// (cd site && python3 -m http.server 8080) — or INKWELL_URL=https://inkwell.com.br/ for the published site.
import { defineConfig, devices } from '@playwright/test';
const chrome = process.env.PW_CHROMIUM ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } } : {};
export default defineConfig({
  testDir: '.', testMatch: /webview-smoke\.spec\.mjs/, timeout: 60000, workers: 2, reporter: 'line',
  projects: [
    { name: 'android', use: { ...devices['Pixel 7'], ...chrome } },
    ...(process.env.PW_WEBKIT ? [{ name: 'iphone', use: { ...devices['iPhone 13'] } }] : []),
  ],
});
