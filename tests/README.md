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

The additive browser suite tests the actual text/voice parser through tab execution, including 2,000 generated layouts. It covers accessible names, open shadow roots, protected form fields, table/CSV extraction, cookie choices, unsafe URLs, input budgets, permission denial, single-use confirmations, workspace restore, saved workflows and cancellation. Speech tests require local recognition and exclude online TTS voices. `pretest` builds the isolated page agent fixture; if invoking Vitest directly, first run `node scripts/build-page-agent.cjs --test`.

The additional real Edge cases preserve the reference tab and other windows, execute the bundled page agent, cancel a pending click, and exercise confirmation in the extension UI. Two microphone cases inject a controlled speech API into the real extension UI: first-use installation and cancellation before a delayed download finishes. All browser mutations target disposable local fixtures. New tool documentation and development instructions are in `docs/browser-upgrade.md`.

The setup checklist tests cover browser-language defaults, bidirectional translation choices, actual cache entries instead of stale booleans, read-only availability checks, individual retry after partial failure, temporary session cleanup, cancellation, duplicate clicks and bounded waits. Real-extension UI cases exercise onboarding with native API fixtures, a failed Writer download followed by a successful retry, preservation of its retry message after returning from the permission tab, and the Voice-page link to a focused Settings item. They do not download actual Gemini Nano or translation models.

`local-speech.test.ts`, `speech.test.tsx` and `workflow.test.tsx` cover installed-language selection, first-use setup, concurrent installation, download cancellation, a fresh-click retry, unsupported local speech and microphone lifecycle errors. All speech API requests require local processing.

A separate Chrome 156 check on 2026-11-10 bundled the real local-speech helper into a loopback page, downloaded the native `en-IN` pack in a disposable profile, then successfully started native recognition with `processLocally: true` and synthetic microphone input. This was an opt-in network-enabled check outside the offline browser suite. To repeat manually, load the production extension in a separate supported Chrome profile, click the microphone, wait for setup, verify local recognition starts, then stop. Physical microphone capture and transcription accuracy require their own checks.

Additional legacy static checks:

```sh
node scripts/stress-test-suite.mjs
node scripts/icon-and-theme-stress-test.mjs
pnpm audit --prod
pnpm audit
```

The legacy scripts contain source inspections and algorithm simulations; their totals are not a measure of end-to-end feature coverage. See `docs/production-readiness.md` for the measured results and release limitations.
