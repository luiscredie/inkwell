import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tools',
  testMatch: /smoke\.spec\.mjs/,
  timeout: 30000,
  use: {
    baseURL: process.env.INKWELL_URL || 'http://localhost:8080/index.html',
    headless: true,
  },
  reporter: 'list',
});
