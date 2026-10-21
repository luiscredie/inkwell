import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tools',
  testMatch: /(smoke|decks|colecao|precos)\.spec\.mjs/,
  timeout: 30000,
  use: {
    baseURL: process.env.INKWELL_URL || 'http://localhost:8080/index.html',
    headless: true,
    // local runs can point at an already installed Chromium; CI uses the one `playwright install` fetches
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  reporter: 'list',
});
