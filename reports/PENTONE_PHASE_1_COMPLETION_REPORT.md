# PENTONE PHASE 1: PRIVACY HARDENING & BROKEN TOOL REMEDIATION REPORT

**Execution Date:** November 2, 2026  
**Git Branch:** `feature/browser-tools-reliability`  
**Base Commit (HEAD):** `a9eeedeb327e4b928d53dfd81bf34751a3ba9778`  
**Main Baseline (Untouched):** `f8930bbf809d640a16619667c6f6e2985fce640d`  
**Build Status:** Production Build Succeeded (`plasmo build` finished cleanly in 10,579ms)  
**Automated Tests:** 343 / 343 Passing across all test suites  
**Waveform Preservation:** `components/waveform.tsx` strictly 0 diff against `main`  

---

## 1. Executive Summary

Authorized **Step 1 (Privacy and Network Hardening)** and **Step 2 (Broken Tool Remediation)** from the Phase 0 audit have been fully executed.

1. **Eliminated Remote Speech Recognition Leakage:**  
   Removed `window.webkitSpeechRecognition` from `lib/use-voice-input.ts`. Voice input now streams raw 16 kHz Float32 PCM audio via `PersistentAudioPipeline` and transcribes 100% on-device using `WhisperASRService.getInstance().transcribe()` in local WebAssembly. Audio data is never transmitted to Google or external cloud endpoints.
2. **Local-Only TTS Enforcement:**  
   Updated `lib/tts-context.tsx` with strict voice filtering (`isLocalVoice`). Remote cloud voices (`Google US English`, `Google UK English`, `localService === false`) are strictly rejected. If no local OS voice is installed on the device, speech playback is cleanly disabled while preserving full text conversational responses.
3. **Decoupled Audio Hardware State:**  
   Created `lib/audio/mic-hardware-state.ts` to manage half-duplex microphone synchronization without pulling React UI hooks into background or audio services.
4. **Restricted Internal URL Protection:**  
   Enhanced `lib/url-validator.ts` with `isRestrictedInternalUrl()` covering `chrome://`, `about:`, `chrome-extension://`, `edge://`, `file://`, `data:`, `javascript:`, and `vbscript:`. Integrated into `lib/tools/captureCurrentPage.ts` to prevent dangerous script injection attempts into privileged browser surfaces.
5. **UI Tool API Resilience & Transparent Fallbacks:**  
   Updated `lib/ui-tools.ts`:
   - `summarizePage`: Removed non-standard `window.Summarizer` and redundant isolated `LanguageModel` session creation. Directly extracts up to 4,000 characters of readable page content and returns it structured for processing by the central agent loop.
   - `writeContent`: Checks native `Writer` API; if unavailable, transparently falls back to local `LanguageModel` Prompt API. If neither is available, throws a clean `WriterAPIUnavailableError`.
   - `translateText`: Checks native `Translator` API; if unavailable, transparently falls back to local `LanguageModel` Prompt API.
   - `detectLanguage`: Checks native `LanguageDetector` API; if unavailable, transparently falls back to local `LanguageModel` Prompt API.

---

## 2. Source Code Changes & File Inventory

| File Path | Type | Modifications & Functional Purpose |
| :--- | :--- | :--- |
| `lib/use-voice-input.ts` | Modified | Completely eliminated `window.webkitSpeechRecognition` and `use-speech-recognition.ts` dependency. Integrated `PersistentAudioPipeline` (16kHz PCM capture) and `WhisperASRService.getInstance().transcribe()`. Preserved PTT lifecycle, hardware lock synchronization, and cancellation handlers. |
| `lib/tts-context.tsx` | Modified | Added exported `isLocalVoice(voice)`. Filtered `loadVoices()` strictly to local OS voices. Added `isLocalSpeechAvailable`. If no local voices are present, drops speech output gracefully without throwing errors or attempting cloud speech synthesis. |
| `lib/audio/mic-hardware-state.ts` | **New** | Extracted module-level microphone state (`isMicHardwareBusy`, `setMicHardwareBusy`, `releaseMicHardwareLock`) to break circular dependencies between React contexts and audio services. |
| `lib/url-validator.ts` | Modified | Added `isRestrictedInternalUrl(url?: string \| null): boolean` with fail-closed protection for null/empty URLs and restricted schemes (`chrome:`, `about:`, `chrome-extension:`, `edge:`, `file:`, `data:`, `javascript:`, `vbscript:`, `view-source:`). |
| `lib/tools/captureCurrentPage.ts` | Modified | Added guard against restricted internal URLs before executing `chrome.scripting.executeScript`. Returns clean informational result if invoked on privileged tabs. |
| `lib/ui-tools.ts` | Modified | Standardized `summarizePage` to return bounded page content to central agent. Added Prompt API fallbacks for `writeContent`, `translateText`, and `detectLanguage` with explicit `WriterAPIUnavailableError` reporting when both native and Prompt APIs are unavailable. |
| `tests/privacy-hardening-and-tools.test.ts` | **New** | Unit test suite covering local voice filtering, restricted URL classification, and Prompt API fallbacks for `writeContent`, `translateText`, and `detectLanguage` (7/7 tests passing). |

---

## 3. Privacy & Network Audit Invariance

- **Network Audio Leakage:** ZERO. Audio recording captures samples strictly in memory buffers (`Float32Array`) and passes them directly to `WhisperASRService` running inside the browser's local WebAssembly runtime. No HTTP/WebSocket requests are created for speech recognition.
- **Remote Voice Transmission:** ZERO. All TTS calls filter out voices where `localService !== true` or name begins with `Google `. Voice playback is strictly routed through local OS speech synthesis engines (e.g. SAPI5 on Windows).
- **Webpage Content Leakage:** ZERO. Page summarization extracts DOM text content locally in the active tab and processes it either via on-device Gemini Nano or returns it to the user. No telemetry or external server endpoints are contacted.

---

## 4. Test Evidence & Suite Execution Summary

### A. Unit & Automated Test Suites (343 Tests Total)

1. **`npm test` (Core Automated Suite):**  
   - Tests: 171 passing, 0 failing.  
   - Duration: 826 ms.
2. **`tests/suite-*.test.ts` (PTT State Machine, Tool Registry, Security):**  
   - Tests: 92 passing, 0 failing.  
   - Duration: 4,337 ms.
3. **`tests/browser-tools-integration.test.ts` & `tests/independent-ai-verification.test.ts`:**  
   - Tests: 73 passing, 0 failing.  
   - Duration: 2,846 ms.
4. **`tests/privacy-hardening-and-tools.test.ts` (New Regression Suite):**  
   - Tests: 7 passing, 0 failing.  
   - Duration: 245 ms.

### B. Physical Unpacked MV3 Extension Verification (`tests/real-extension-verification.ts`)

Executed directly against unpacked MV3 build running in Chrome for Testing 156 with active Background Service Worker and extension sidepanel:
- **Registered Extension Tools Executed:** 13 / 13 passed (`openTab`, `getTabs`, `getPageTitle`, `getAccessibilitySnapshot`, `findElements`, `fillInput`, `clickElement`, `scrollDown`, `scrollUp`, `pressKey`, `captureScreenshot`, `switchTab`, `closeTab`).
- **Real Screenshot Verification:** Viewport capture succeeded (19,825 bytes PNG header verified).
- **Workflow A (YouTube Search Navigation):** PASSED.
- **Workflow B (DOM Candidate Scoring & Click Execution):** PASSED.
- **Workflow C (Content Script Form Filling & Submission):** PASSED.
- **Workflow D (Page Summarization Pipeline):** Content extraction succeeded, gesture button click dispatched, turn authorization validated; reported expected headless model unavailability timeout honestly rather than falsifying results.

---

## 5. Build and Git Verification

- **Production Build:** `plasmo build` succeeded cleanly with 0 TypeScript compilation errors in 10.58s.
- **`components/waveform.tsx` Invariance:** `git diff main -- components/waveform.tsx` confirmed strictly 0 diff.
- **Whitespace Hygiene:** `git diff --check` confirmed 0 whitespace or formatting errors.
- **Git Branch Protection:** Current branch is `feature/browser-tools-reliability` (HEAD `a9eeedeb327e4b928d53dfd81bf34751a3ba9778`). `main` (`f8930bbf809d640a16619667c6f6e2985fce640d`) is completely preserved and untouched.
