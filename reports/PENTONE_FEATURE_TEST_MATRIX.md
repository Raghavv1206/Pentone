# Pentone Feature Test Matrix & Test Count Reconciliation

**Branch:** `feature/reliability-completion`  
**Base Commit:** `f8930bb`  
**Date:** 2026-11-01  
**Total Automated Tests:** **274 Tests** (Zero Failing, Zero Skipped)

---

## 1. Exact Test Count Reconciliation

The repository contains three distinct, non-overlapping test execution suites:

| Suite Category | Invocation Command | Test Files Covered | Total Tests | Pass | Fail | Skipped |
|:---|:---|:---|:---:|:---:|:---:|:---:|
| **Core Unit & Mock Suites** | `npm test` | 15 test files (defined in `package.json` `"test"` script) | **171** | 171 | 0 | 0 |
| **Comprehensive Integration Suites** | `npx tsx --test tests/suite-*.test.ts` | 11 integration suites (`suite-a` through `suite-k`) | **92** | 92 | 0 | 0 |
| **Independent AI Verification Suite** | `npx tsx --test tests/independent-ai-verification.test.ts` | `tests/independent-ai-verification.test.ts` | **11** | 11 | 0 | 0 |
| **Repository Total Coverage** | — | **27 test files** | **274** | **274** | **0** | **0** |

### Explanation of Unit Test Increase from 170 to 171
- In baseline commit `f8930bb`, `tests/session-lifecycle.test.ts` contained 3 unit tests.
- During remediation, 1 regression test was added:  
  `test('Session Lifecycle: Text actions strictly request text-only session and succeed when multimodal is unsupported')`
- This brought `tests/session-lifecycle.test.ts` from 3 to 4 tests.
- Because `npm test` executes the 15 core test files specified in `package.json`, its count increased from 170 to 171.
- `tests/independent-ai-verification.test.ts` (11 tests) is **not** included in the `npm test` script in `package.json`; it is executed separately via `npx tsx --test tests/independent-ai-verification.test.ts`.

---

## 2. Integration Suite Breakdown (92 Tests across Suites A - K)

- `Suite A` (`suite-a-ptt-state-machine.test.ts`): 10 tests passing
- `Suite B` (`suite-b-tool-parser.test.ts`): 7 tests passing
- `Suite C` (`suite-c-tool-registry-health.test.ts`): 4 tests passing
- `Suite D` (`suite-d-browser-youtube-execution.test.ts`): 5 tests passing
- `Suite E` (`suite-e-permissions-and-injection.test.ts`): 4 tests passing
- `Suite F` (`suite-f-in-page-components.test.ts`): 4 tests passing
- `Suite G` (`suite-g-onnx-whisper-lifecycle.test.ts`): 4 tests passing
- `Suite H` (`suite-h-security-invariance.test.ts`): 5 tests passing
- `Suite I` (`suite-i-post-remediation-hardening.test.ts`): 7 tests passing
- `Suite J` (`suite-j-onboarding-and-download-lifecycle.test.ts`): 25 tests passing
- `Suite K` (`suite-k-ptt-lifecycle-and-writer-api.test.ts`): 17 tests passing

---

## 3. Independent AI Verification Suite Breakdown (11 Tests)

File: [`tests/independent-ai-verification.test.ts`](file:///c:/project/New%20folder/Marionette/tests/independent-ai-verification.test.ts)

1. `checkPromptAPIAvailability never uses text availability as proof of image capability` (PASS)
2. `Text Action 1 - Explain requests text-only session and streams chunks` (PASS)
3. `Text Action 2 - Summarize requests text-only session and streams chunks` (PASS)
4. `Text Action 3 - Rewrite requests text-only session and streams chunks` (PASS)
5. `Text Action 4 - Translate requests text-only session and streams chunks` (PASS)
6. `Text Action 5 - Ask Pentone requests text-only session and custom prompt` (PASS)
7. `Image Scenario 1 - Image-capable model available creates multimodal session` (PASS)
8. `Image Scenario 2 - Image capability unavailable returns clean message without crash` (PASS)
9. `Image Scenario 3 - Image session creation rejected surfaces error cleanly` (PASS)
10. `Image Scenario 4 - Invalid image input surfaces fetch error without crashing` (PASS)
11. `Image Scenario 5 - Session cleanup and retry releases old session` (PASS)

---

## 4. Feature Verification Mapping by Verification Terminology

### A. Logic Verified (22 Units)
1. `FEAT-TXT-02`: In-Page Text Explainer View (`suite-f`)
2. `FEAT-TXT-03`: Text Explanation Action (`independent-ai-verification`)
3. `FEAT-TXT-04`: Text Preset Actions (Summarize, Rewrite, Translate, Ask) (`independent-ai-verification`)
4. `FEAT-VOX-02`: Voice Reactive Waveform Visualizer (`persistent-audio-pipeline-ptt`)
5. `FEAT-VOX-04`: Full-Duplex Audio & Barge-In Playback Interruption (`barge-in-cancellation-stage3`)
6. `FEAT-CHAT-01`: Side Panel Chat Streaming Interface (`conversation-integrity`)
7. `FEAT-CHAT-02`: Proactive Context Window Compaction & Pruning (`context-summarizer-selection`)
8. `FEAT-UI-01`: In-Page Draggable Floating Action Controls (`suite-f`)
9. `FEAT-UI-02`: Dual Theme System (Light / Dark / System Palette) (`suite-h`)
10. `FEAT-SET-02`: Diagnostics Telemetry Screen (`suite-h`)
11. `TOOL-01`: `think` (`suite-c`, `suite-d`)
12. `TOOL-14`: `storeMemory` (`voice-memory-reliability`)
13. `TOOL-23`: `searchVault` (`suite-c`)
14. `TOOL-24`: `getVaultStats` (`suite-c`)
15. `TOOL-25`: `getPlaybook` (`suite-c`)
16. `SVC-VOX-04`: Audio Pre-Validation Energy & Duration Gate (`voice-model-preloading-noise-rejection`)
17. `SVC-VOX-05`: Whisper Hallucination Filter (`voice-model-preloading-noise-rejection`)
18. `SVC-VOX-06`: Audio Resampling Engine (`full-duplex-audio-stage1`)
19. `SVC-VOX-07`: Ambient Noise Floor Dynamic Calibration (`voice-model-preloading-noise-rejection`)
20. `SVC-CHAT-01`: Silent Reasoning & Thought XML Stripper (`agent-execution-reasoning`)
21. `SVC-CHAT-02`: In-Prompt Stored Memory Injection (`voice-memory-reliability`)
22. `SVC-IMG-01`: Audio Modality Boundary Guard (`suite-j`)

### B. Automated Mock Verified (33 Units)
1. `FEAT-TXT-01`: In-Page Selection Tooltip (`suite-f`)
2. `FEAT-TXT-05`: Text Rewriter View & Presets (`suite-f`)
3. `FEAT-TXT-06`: In-Place Text Replacement (`suite-f`)
4. `FEAT-TXT-07`: Text Writer View & Generator (`suite-k`)
5. `FEAT-TXT-08`: In-Place Text Insertion (`suite-f`)
6. `FEAT-IMG-01`: Crosshair Drag Screenshot Selection (`suite-f`)
7. `FEAT-VOX-03`: Speaker Profile Acoustic Enrollment Screen (`suite-h`)
8. `FEAT-VOX-05`: Text-to-Speech (TTS) Voice Playback (`suite-e`)
9. `FEAT-SET-01`: Settings Screen (5 Tabs) (`suite-h`)
10. `FEAT-SET-03`: Onboarding Setup & Model Readiness Flow (`suite-j`)
11. `TOOL-02`: `getPageTitle` (`suite-c`)
12. `TOOL-03`: `openTab` (`suite-d`)
13. `TOOL-04`: `closeTab` (`suite-c`)
14. `TOOL-05`: `getAccessibilitySnapshot` (`suite-c`)
15. `TOOL-06`: `findElements` (`tool-parser`)
16. `TOOL-07`: `clickElement` (`suite-d`)
17. `TOOL-08`: `fillInput` (`suite-d`)
18. `TOOL-09`: `listen` (`suite-c`)
19. `TOOL-10`: `captureScreenshot` (`suite-c`)
20. `TOOL-11`: `captureAudio` (`suite-i`)
21. `TOOL-12`: `writeContent` (`suite-k`)
22. `TOOL-13`: `summarizePage` (`suite-c`)
23. `TOOL-15`: `translateText` (`suite-c`)
24. `TOOL-16`: `detectLanguage` (`suite-c`)
25. `TOOL-17`: `scrollUp` (`suite-c`)
26. `TOOL-18`: `scrollDown` (`suite-c`)
27. `TOOL-19`: `pressKey` (`suite-c`)
28. `TOOL-20`: `highlightSelector` (`suite-c`)
29. `TOOL-21`: `highlightText` (`suite-c`)
30. `TOOL-22`: `captureCurrentPage` (`suite-c`)
31. `TOOL-26`: `getTabs` (`suite-c`)
32. `TOOL-27`: `switchTab` (`suite-c`)
33. `SVC-VOX-03`: Local Whisper ASR WebAssembly Engine (`local-whisper-asr-stage2`)

### C. Integration Verified (4 Units)
1. `FEAT-VOX-01`: PTT Spacebar Keyboard Trigger (`suite-a`, `suite-k`)
2. `SVC-VOX-01`: PTT Focus-Loss Safety Guard & Invalidation (`suite-a`, `suite-k`)
3. `SVC-VOX-02`: React Unmount Lifecycle Cleanup Engine (`suite-k`)
4. `SVC-VOX-08`: Voice Authorization Gate & Token Manager (`suite-b`, `suite-h`)

### D. Blocked (1 Unit)
1. `FEAT-IMG-02`: Multimodal Screenshot Analysis (`independent-ai-verification`) — Blocked on desktop Chrome Gemini Nano model architecture.

### E. Physical Chrome Verified (0 Units)
No live end-user physical session recorded in this automated environment.

### F. Not Verified (0 Units)
All 60 functional units have automated test coverage.
