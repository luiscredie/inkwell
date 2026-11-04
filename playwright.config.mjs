import { defineConfig, devices } from '@playwright/test';

const chromium = { launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {} };
export default defineConfig({
  testDir: 'tools',
  testMatch: /(smoke|journeys|decks|trades|colecao|precos|perfil|comunidades|coach|comecar|login|counter|eventos|security|overview)\.spec\.mjs/,
  timeout: 30000,
  use: {
    baseURL: process.env.INKWELL_URL || 'http://localhost:8080/index.html',
    headless: true,
  },
  // chromium: every spec (local runs can point at an already installed Chromium; CI uses the one `playwright install`
  // fetches). iphone: the visitor journeys (issue #145) in WebKit with an iPhone's screen, touch and user agent —
  // only when asked (PW_WEBKIT=1), since it needs `npx playwright install webkit`.
  projects: [
    { name: 'chromium', use: { ...chromium } },
    ...(process.env.PW_WEBKIT ? [{ name: 'iphone', testMatch: /(journeys|overview)\.spec\.mjs/, use: { ...devices['iPhone 13'] } }] : []),
  ],
  reporter: 'list',
});
