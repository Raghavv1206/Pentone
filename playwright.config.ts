import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: './tests/browser', timeout: 45000, workers: 1,
  reporter: 'list', outputDir: 'tests/evidence/playwright', use: { trace: 'retain-on-failure' } })
