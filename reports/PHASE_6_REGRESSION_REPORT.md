# PENTONE — PHASE 6: REGRESSION & INTEGRATION TEST REPORT

- **Date:** November 3, 2026
- **Test Runner:** `node:test` via `tsx`
- **Working Branch:** `feature/phase-4-offline-resilience`
- **HEAD SHA:** `7b0220ec491daddedaa9d6629ecd1927585e6665`
- **Baseline Commit:** `f6e31c78a9d652d69a002efb00726ec73a606122`
- **Target Runtime:** Chrome Manifest V3 (Chromium 156.0.8078.80 / Windows 11 x64)

---

## 1. TEST EXECUTION SUMMARY & RECONCILIATION

| Metric | Previous Baseline (Phase 5) | Phase 6 Final State | Reconciliation Status |
|---|---|---|---|
| **Total Test Suites** | 19 suites | **20 suites** | +1 suite (`tests/phase6-complete-feature-reliability.test.ts`) |
| **Total Test Cases** | 184 tests | **188 tests** | Fully reconciled (+4 tests) |
| **Passed Tests** | 184 tests | **188 tests** | 100% Pass (0 failures) |
| **Failed Tests** | 0 tests | **0 tests** | 0 failures |
| **Cancelled / Skipped** | 0 tests | **0 tests** | 0 skipped |
| **Test Duration** | ~1.24s | **1.15s** | High-performance execution |
| **Production Build Status** | Passing | **Passing (Clean)** | Plasmo 0.90.5 MV3 bundle verified |
| **Waveform Invariant Diff** | 0 bytes | **0 bytes** | Strictly 0 bytes diff against `f6e31c78a9d652d69a002efb00726ec73a606122` |
| **Waveform SHA-256 Hash** | Matching | `68E8209E06F761DE3EAA5C9A4CE6C09829BD73F8C2F4961F4C47AC634871231F` | Confirmed invariant |

---

## 2. SUITE-BY-SUITE RECONCILED TEST DISCOVERY INVENTORY

Every single test suite registered in `package.json` (`"test": "tsx --test tests/..."`) was executed individually and collectively. The sum of the verified test counts across all 20 individual suites equals **exactly 188**:

$$\sum_{i=1}^{20} \text{Suite Tests}_i = 22 + 9 + 5 + 4 + 6 + 11 + 9 + 26 + 12 + 7 + 14 + 24 + 7 + 5 + 10 + 4 + 1 + 2 + 6 + 4 = 188$$

| # | Test Suite File | Actual Discovered Tests | Status | Key Coverage Scope |
|---|---|---|---|---|
| 1 | `tests/tool-parser.test.ts` | **22** | **PASS** | Reasoning stripping (narrative traces, think() calls, XML tags), friendly status lines, loose English queries, Python-style signatures, multi-step navigation, proactive compaction thresholds, parameter schema validation, circuit breakers, and deduplication. |
| 2 | `tests/ai-config.test.ts` | **9** | **PASS** | Prompt API device capability detection, circuit breaker lifecycle, fallback tier hierarchy, and availability normalization. |
| 3 | `tests/security.test.ts` | **5** | **PASS** | Prompt injection protection, URL validation, scheme restrictions, untrusted origin checks, and fail-closed validation. |
| 4 | `tests/session-lifecycle.test.ts` | **4** | **PASS** | Session recreation, memory cleanup, concurrency safety during initialization, and session reset semantics. |
| 5 | `tests/conversation-integrity.test.ts` | **6** | **PASS** | Message formatting, visual-only message filtering, ChatML conversation history serialization, and role boundary preservation. |
| 6 | `tests/context-summarizer-selection.test.ts` | **11** | **PASS** | Context compaction limits, proactive summarizer triggers, token estimation, sanitized screenshot data URL handling, and compaction safety margins. |
| 7 | `tests/voice-memory-reliability.test.ts` | **9** | **PASS** | `storeMemory` tool-level validation, rejection of single-word names, fact persistence, Hinglish phonetics, multilingual rules, and speech accumulation. |
| 8 | `tests/agent-execution-reasoning.test.ts` | **26** | **PASS** | Silent reasoning trace filtering, multi-step scenario dispatch, task state management, context limits, and deterministic tool routing. |
| 9 | `tests/agent-reliability-audio.test.ts` | **12** | **PASS** | Audio buffer resampling, float conversion, RMS volume metrics calculation, speech detection, and audio buffer bounds. |
| 10 | `tests/full-duplex-audio-stage1.test.ts` | **7** | **PASS** | Persistent audio pipeline lifecycle, device switching, stream retention, and AudioContext state handling. |
| 11 | `tests/local-whisper-asr-stage2.test.ts` | **14** | **PASS** | Whisper Tiny INT8 initialization, generation token cancellation, silence gating, and transcription accuracy. |
| 12 | `tests/barge-in-cancellation-stage3.test.ts` | **24** | **PASS** | BargeInController state transitions (`IDLE` -> `INITIALIZING` -> `CALIBRATING` -> `LISTENING` -> `USER_SPEAKING` -> `PROCESSING`), speech interruption, and TTS halting. |
| 13 | `tests/voice-model-preloading-noise-rejection.test.ts` | **7** | **PASS** | Preloading warmup, noise artifact rejection, and Whisper hallucination filtering. |
| 14 | `tests/critical-voice-pipeline-remediation.test.ts` | **5** | **PASS** | Energy thresholding, transient noise rejection, audio buffer pre-validation, and RMS gating. |
| 15 | `tests/persistent-audio-pipeline-ptt.test.ts` | **10** | **PASS** | PTT state transitions, press-and-hold lifecycle, ambient noise baseline measurement, and keyboard shortcut handling. |
| 16 | `tests/critical-production-recovery.test.ts` | **4** | **PASS** | Offline recovery, model cache integrity, graceful fallback semantics, and error boundaries. |
| 17 | `tests/all-26-tools-contract.test.ts` | **1** | **PASS** | Tool contract verification: Schema validation, parameter checking, and high-impact action gates across all registered tools. |
| 18 | `tests/document-processor-repair.test.ts` | **2** | **PASS** | Native PKZip inflation, DOCX paragraph and table parsing, and PDF text layer extraction. |
| 19 | `tests/feature-repair-and-completion.test.ts` | **6** | **PASS** | Repairs verification: DEF-01 (tool authorization), DEF-02 (document processing), DEF-03 (vision boundary), DEF-04 (ChatML prefix sanitization), DEF-05 (deterministic router fallback), and active voice transformation. |
| 20 | `tests/phase6-complete-feature-reliability.test.ts` | **4** | **PASS** | Phase 6 repairs: Text-origin UI tool authorization, voice-origin token enforcement, PPTX `presentation.xml` manifest ordering, and tool registry cardinality (27 tools). |
| **TOTAL** | **20 Suites** | **188 Tests** | **PASS (100%)** | **Zero failures, zero skipped, zero regressions.** |

---

## 3. PRODUCTION BUILD VERIFICATION

Executed `pnpm build`:
- Framework: Plasmo `0.90.5`
- Target: `chrome-mv3`
- Bundle Post-Processing: `scripts/patch-bundle.js`
- Build Output: `build/chrome-mv3-prod/`
  - `manifest.json`: Valid Chrome Manifest V3
  - `static/background/index.js`: Background Service Worker bundle
  - `sidepanel.html`: Sidepanel React entrypoint
  - `assets/ort-wasm-simd-threaded.jsep.wasm`: 29.5 MB bundled locally
  - `assets/ort-wasm-simd-threaded.jsep.mjs`: 47.2 KB bundled locally
  - `assets/pdf.worker.min.mjs`: 1.1 MB bundled locally
- **Result:** **BUILD SUCCESSFUL (0 errors)** in 5.88s.

---

## 4. WAVEFORM INVARIANT VERIFICATION

- Baseline commit: `f6e31c78a9d652d69a002efb00726ec73a606122`
- Target File: `components/waveform.tsx`
- Invariant Check Command: `git diff f6e31c78a9d652d69a002efb00726ec73a606122 -- components/waveform.tsx`
- Output: Strictly **0 bytes** (**PASS**)
- Verified SHA-256 Hash: `68E8209E06F761DE3EAA5C9A4CE6C09829BD73F8C2F4961F4C47AC634871231F` (**MATCH**)
