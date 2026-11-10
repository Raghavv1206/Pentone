import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
export default defineConfig({ resolve: { alias: Object.fromEntries(['porcupine-web', 'web-voice-processor'].map(name => [`@picovoice/${name}`, fileURLToPath(new URL(`./node_modules/@picovoice/${name}/dist/esm/index.js`, import.meta.url))])) }, test: {
  environment: 'jsdom', environmentOptions: { jsdom: { url: 'https://example.com/form' } },
  include: ['tests/**/*.test.{ts,tsx}'], setupFiles: ['tests/setup.ts'],
  silent: 'passed-only', testTimeout: 15000, restoreMocks: true, maxWorkers: 2
} })
