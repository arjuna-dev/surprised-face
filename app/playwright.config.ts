import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  timeout: 15_000,
  expect: { timeout: 3000 },
  workers: 1,
  reporter: [['list'], ['json', { outputFile: '../output/playwright/results.json' }]],
  outputDir: '../output/playwright/test-results',
  use: { baseURL: 'http://127.0.0.1:9017', viewport: { width: 1280, height: 800 }, screenshot: 'only-on-failure', channel: process.env.SURPRISED_FACE_TEST_BROWSER },
  webServer: [
    {
      command: 'SURPRISED_FACE_UI_TEST=1 npx quasar dev -p 9017 -H 127.0.0.1',
      url: 'http://127.0.0.1:9017',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'python3 -m http.server 9018 --bind 127.0.0.1 -d ..',
      url: 'http://127.0.0.1:9018/landing/index.html',
      reuseExistingServer: false,
      timeout: 15_000,
    },
  ],
});
