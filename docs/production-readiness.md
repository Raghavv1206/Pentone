# Pentone 1.1.1 verification report — 2026-11-10

The additive upgrade and microphone setup fix pass the automated checks below. Native Chrome speech-pack installation and local recognizer startup were also verified with synthetic input. Other live on-device models, physical audio and the intended third-party websites still require release testing; this report does not certify unrestricted browser automation or the absence of vulnerabilities.

## Results

| Check | Result |
| --- | --- |
| TypeScript | Passed |
| Unit/integration suite | 240/240 tests across 13 files |
| Registered tools | 119 unique tools: 38 existing and 81 additional; every tool has an availability/error contract check |
| Generated tab layouts | 2,000 property-test cases covering direction, reference preservation and window isolation |
| Real extension browser suite | 10/10 tests in installed Edge, using disposable local profiles and fixtures; speech UI cases use controlled native API fixtures |
| Native Chrome speech | Actual `en-IN` language-pack installation and recognizer startup passed with `processLocally: true` and synthetic microphone input |
| Screen matrix | 8 existing screens × 2 themes × 3 viewport widths |
| Legacy security/static suite | 77/77 assertions |
| Legacy icon/theme/static suite | 242/242 assertions |
| Production build and package | Passed |
| Build integrity | 23 resource declarations, HTML references, WASM headers, optional permissions and isolated page-agent asset verified across 36 packaged files |
| ZIP integrity | All 36 archive entries match the tested build by SHA-256; no missing or extra files |
| Runtime dependency audit | 0 advisories |
| Full dependency audit | 17 advisories: 3 high, 12 moderate, 2 low; 0 critical, all in development/build dependencies |

Package: `build/chrome-mv3-prod.zip`, 15,719,478 bytes.

SHA-256: `b3fa96362ef8f18855e79768c81208be1d590db6e0c19e814e05c125e50db487`.

## Verified behavior

- The actual text and voice intent paths preserve “left of”, “right of” and “except” tab qualifiers. Missing or ambiguous references do not close anything. An execution-time guard rejects attempts to widen a scoped request into closing every tab.
- The real extension closes only the two tabs left of a YouTube reference in a disposable four-tab window, while preserving the reference, the tab to its right and the separate test window.
- Additional page tools execute the locally bundled agent in the isolated world, bind to document IDs, use accessible names and reject ambiguous/disabled targets. Native fields, open shadow-root controls, table spans, CSV formula escaping, unsafe URLs, input budgets and cookie rejection have dedicated tests.
- Stop aborts active waiting tools before a later control appears. Both mocked and real-browser tests verify that no delayed click occurs. Single-use confirmations bind consequential actions to the task, parameters and current targets; a real extension-UI dialog is exercised against a disposable fixture.
- Optional permissions fail clearly when absent. Workspaces validate local storage before restoring tabs/pins/groups, saved workflows reject recursion and fixed tab IDs, and multi-step operations report partial errors.
- Microphone startup installs a missing supported local speech pack instead of treating first-use setup as an error. It prefers an already installed English dialect to a new download, shares in-flight installation, reports progress and supports cancellation and fresh-click retry. The microphone, Settings and onboarding use the same setup helper. Recognition requires `processLocally`; synthesis excludes online voices and never falls through to the browser's unspecified default voice. Tests verify cancellation cannot start the microphone later.
- Existing storage, model/offscreen lifecycle, form/profile, TTS queue and UI regressions remain covered. Stress cases include concurrent memory/vault operations, 100 startup calls, 100 DOM snapshot/reorder cycles, 100 queued utterances and 100 real browser field writes.
- Real-browser testing found and fixed a Plasmo/Zod namespace-import incompatibility that unit tests did not reveal. The final production build loads successfully under the extension CSP.

## Remaining release checks

The browser suite blocks external model downloads and uses local pages. Verify Gemini Nano inference, image/audio input, translation, writing, summarization, embedding search and PDF/file processing on the supported Chrome/hardware configuration with installed models. Test cold/warm startup, storage limits, interrupted downloads and recovery. Native model success-path tests use controlled mocks.

Native language-pack installation and local recognition startup succeeded in Chrome 156.0.8078.80 on Windows using a disposable profile and synthetic microphone input. Verify physical microphones, transcription quality, other supported languages/browser versions, available system voices and wake-word activation with the project's valid Picovoice key. Local speech support varies by browser/version; unsupported configurations explain the required setup without silently using online recognition. The automated suites are not a long-duration CPU/RAM/GPU soak.

Test the intended third-party websites, ATS forms, accessible custom widgets and permitted iframes. Contract coverage for every tool does not mean exhaustive live success-path coverage for every component or website. Chrome-protected pages, native prompts, closed shadow roots and trusted-input requirements remain platform limits. See [browser-upgrade.md](browser-upgrade.md) for precise capability bounds and development instructions.

The unchanged development/build advisories affect `@parcel/reporter-dev-server`, `content-security-policy-parser`, `deepmerge`, transitive `esbuild`, `glob`, `image-size`, `minimatch`, `svelte`, `tsup` and `yaml`. The three high findings concern `content-security-policy-parser` and `image-size`; their available fixes require coordinated toolchain/API changes. Two low findings have no patched release. This additive upgrade retains the existing Plasmo toolchain and its post-build compatibility patches. Review those advisories before exposing a development server or building untrusted input. Peer-version warnings remain in the toolchain.

The dependency audit results are from the 1.1.0 registry snapshot taken on this date; 1.1.1 changes no dependencies or lockfile. A clean runtime audit does not prove absence of vulnerabilities.

## Reproduction

See [tests/README.md](../tests/README.md). Run `pnpm check`, then `pnpm test:browser`; the legacy static scripts inspect the built output and must run after the build finishes. Run `pnpm package` to rebuild, verify and package. Screenshots, traces, temporary browser profiles and raw audit output are kept in the ignored `tests/evidence/` directory.

The upgrade was implemented on the previously verified `main` commit `6c6e18f`, preserving the existing UI and legacy tool implementations while adding tool modules and the necessary integration fixes. The 1.1.1 microphone repair builds on the published upgrade commit `1f84e02` and keeps the existing voice controls, adding setup progress and cancellation.
