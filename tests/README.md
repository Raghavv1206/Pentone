# Pentone verification

Use Node.js 22.12+ and pnpm 10.17.0. Validation was run on Windows with Node.js 26.13.0 and the installed Microsoft Edge browser.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test:browser
pnpm package
```

`check` runs TypeScript, unit/integration tests, the production build and artifact integrity checks. `package` rebuilds, applies the post-build patches, verifies resources and creates `build/chrome-mv3-prod.zip`.

The Playwright suite loads `build/chrome-mv3-prod` as a real unpacked extension into an isolated, headless Edge profile. Build first. Set `PENTONE_TEST_CHANNEL=chromium` only if an extension-compatible Playwright Chromium is already installed. It serves a local fixture, blocks external HTTP(S) traffic, and never uses your normal browser profile. Profiles, screenshots and failure traces go into the ignored `tests/evidence/` folder.

The browser tests cover 8 screens in 2 themes at widths 360/430/800, background message validation, real DOM writes, tab navigation, zoom, screenshots, voice badges, profile autofill, and memory persistence/deletion. They do not run model downloads or native audio recognition. Screenshot capture disables transitions to avoid recording an intermediate theme color.

Unit/integration tests execute serialized injected functions against a DOM, render React hooks/screens, and use fake IndexedDB plus Chrome API mocks. Every registered tool has an availability/error contract check. Success paths are covered selectively, not exhaustively. Native model and audio lifecycle tests use controlled mocks.

Additional legacy static checks:

```sh
node scripts/stress-test-suite.mjs
node scripts/icon-and-theme-stress-test.mjs
pnpm audit --prod
pnpm audit
```

The legacy scripts contain source inspections and algorithm simulations; their totals are not a measure of end-to-end feature coverage. See `docs/production-readiness.md` for the measured results and release limitations.
