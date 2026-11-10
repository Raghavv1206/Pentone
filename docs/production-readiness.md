# Pentone verification report — 2026-11-10

Automated checks pass for the tested configuration. This is not full production certification: live AI/audio and third-party site validation remain outstanding, and the build toolchain still has dependency advisories.

## Results

| Check | Result |
| --- | --- |
| TypeScript | Passed |
| Unit/integration suite | 102/102 tests across 11 files |
| Real extension browser suite | 4/4 tests in installed Edge |
| Screen matrix | 8 screens × 2 themes × 3 viewport widths |
| Legacy security/static suite | 77/77 assertions |
| Legacy icon/theme/static suite | 242/242 assertions |
| Production build and package | Passed |
| Build integrity | 23 resource declarations, HTML references and WASM headers checked; 35 packaged files |
| ZIP integrity | CRC check passed; all files match the tested build byte for byte |
| Runtime dependency audit | 0 advisories |
| Full dependency audit | 17 advisories: 3 high, 12 moderate, 2 low; 0 critical |

ZIP: `build/chrome-mv3-prod.zip` (15358919 bytes). SHA-256: `670664e641361eb01690b9dc434a6f9a49a1559d123edcbd33b51c6d0855cd8a`.

## Fixes and stress coverage

- Tool results now propagate failures for missing targets, invalid arguments, missing injection results, unavailable history, blocked playback/fullscreen and unmatched form choices. Explicit field/tab targets are preserved. Chrome injection arguments serialize correctly; click/key events avoid duplicate dispatch.
- Tool JSON parsing preserves braces, escaped quotes and nested properties in argument strings. Background message shape, sender and tool arguments are validated.
- Autofill inspector/matcher/filler contracts agree, including duplicate names and shadow roots. Preview is read-only; section filling is scoped. Resume imports save parsed data and file bytes, reject unsupported/oversized files and report storage errors. Custom dropdowns requiring site-specific behavior are left for manual selection.
- Untrusted overlay text is escaped. Phishing form-origin comparison and Unicode-hostname diagnostics were corrected. Security reports avoid guarantees of safety. Privacy wording distinguishes local AI from potentially online browser speech services.
- Chat cancellation prevents queued tools and stale workflow state updates after stop/reset. Hydration precedes persistence. Media is passed as media and unsupported analysis is reported. Auxiliary text operations use separate sessions. Native sessions are released on errors.
- Shared model/offscreen initialization, speech errors, microphone track selection, TTS queues and wake-word cancellation were repaired and covered with lifecycle tests.
- Stress cases include 200 concurrent memory saves plus 50 deletes; 100 vault writes; 100 chat-model, embedding-model and offscreen startup calls; 100 snapshot/reorder cycles; 100 queued utterances; and 100 real browser field writes.
- Build/post-processing failures propagate; packaging rebuilds and verifies assets. Compatible dependency security updates were applied. Build outputs, test profiles and screenshots are excluded from Git.

## Remaining release work

The browser suite intentionally blocks external model downloads. Verify Gemini Nano inference, image/audio input, translation/writing/summarization, embedding search and full PDF/file processing on supported Chrome hardware with actual downloaded models. Native success-path tests currently use mocks. Check cold/warm startup, model storage/quotas and recovery from interrupted downloads.

Verify physical microphone selection, permission prompts, transcription quality, synthesized audio and wake-word activation with a valid Picovoice key. Selected-microphone transcription uses `SpeechRecognition.start(audioTrack)` and needs a browser that supports that overload. Speech recognition is not guaranteed to run locally. The tests do not constitute a long-duration CPU/RAM/GPU soak or cross-browser certification.

Test the main third-party sites and ATS systems the project intends to support, including iframes and custom widgets. Current browser fixtures exercise ordinary local pages. All 38 tools have contract coverage, but every feature/component does not have exhaustive live success-path coverage.

The remaining audit findings are in development/build dependencies: `@parcel/reporter-dev-server`, `content-security-policy-parser`, `deepmerge`, `esbuild`, `glob`, `image-size`, `minimatch`, `svelte`, `tsup` and `yaml`. The high findings concern `content-security-policy-parser` and `image-size`. Most remaining fixes require coordinated toolchain/major-version changes; two low findings report no patched release. Review these before trusting untrusted build inputs or exposing a development server. Plasmo 0.90.5 still relies on bundle post-processing, which the browser tests exercise. Dependency peer warnings remain for Vite/esbuild/Node types and htmlnano/SVGO.

The runtime audit being clean does not prove absence of vulnerabilities. Audit counts reflect the registry snapshot taken on this date.

## Reproduction

See `tests/README.md`. Screenshots and failure traces are under the ignored `tests/evidence/` directory. The baseline was pushed to `main` as `4ac8a38` before repairs; the follow-up commit contains the fixes, tests and this report.
