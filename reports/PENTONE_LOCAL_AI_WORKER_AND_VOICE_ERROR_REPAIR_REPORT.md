# Pentone — Local AI Worker & Voice Error Visibility Repair Report

**Date:** 2026-11-03  
**Branch:** `feature/phase-4-offline-resilience`  
**Base Commit (`main`):** `f6e31c78a9d652d69a002efb00726ec73a606122`  
**HEAD Commit:** `7b0220ec491daddedaa9d6629ecd1927585e6665`  
**Status:** **PASSED / RESOLVED**

---

## 1. Executive Summary

This targeted reliability repair resolves the critical runtime defect causing the persistent `Local AI Engine Offline` state, chat failure misattribution, and missing error feedback on the Voice page.

### Key Outcomes:
1. **Resolved ONNX Model IR Version Mismatch:** Upgraded `onnxruntime-web` resolution to `1.31.1` via `pnpm.overrides`, replacing the legacy `1.14.0` binary (which was capped at IR $\le 8$). The bundled ONNX runtime now natively loads `onnx-community/Qwen2.5-0.5B-Instruct` (which requires ONNX IR version 10).
2. **Hardened Dedicated Inference Worker:** Refined `lib/workers/inference-worker.ts` and `lib/generative-runtime.ts` with typed error categorization (`ONNXSessionError`, `ModelNotProvisionedError`), clean thread lifecycle disposal, and bounded recovery retries.
3. **Disambiguated Chat Error Feedback:** Repaired `lib/ai.ts` to distinguish between:
   - Chrome Prompt API unavailable vs session creation failure on device.
   - Genuine model cache miss (`ModelNotProvisionedError`) vs ONNX session initialization failure.
   - Chat messages no longer falsely claim "Local AI model is not provisioned" when verified model files exist in CacheStorage.
4. **Synchronized Voice Page Health & Preserved Transcripts:** Updated `screens/main-screen.tsx` to subscribe to `generativeRuntime.subscribe()`, rendering the offline/recovery banner and accurate status dot. Decoupled Whisper speech recognition from generative SLM responses: recognized speech is displayed and preserved even if AI response generation fails.
5. **Maintained Core Invariants:**
   - `components/waveform.tsx` has **strictly 0 diff** against main baseline `f6e31c78a9d652d69a002efb00726ec73a606122`.
   - `env.allowRemoteModels = false` remains strictly enforced across all pipelines for zero external network egress.
   - All 171 automated tests pass cleanly with 0 failures.

---

## 2. Root Cause Analysis

### A. ONNX IR Version Incompatibility
- **Symptom in Production Logs:**
  ```text
  [AI] Prompt API session creation failed on device, falling back to local Qwen SLM:
  The device is unable to create a session to run the model. Please check the result of availability() first.

  Unsupported model IR version: 10, max supported IR version: 8

  [GenerativeRuntime] Dedicated Worker initialization failed: Can't create a session
  ```
- **Root Cause:**
  - `onnx-community/Qwen2.5-0.5B-Instruct` (`onnx/model_quantized.onnx`, commit `22942cb7d7ba4cc81bb4673549ca4d4614469b5e`) was exported using ONNX IR version 10.
  - `@xenova/transformers@2.17.2` specified `"dependencies": { "onnxruntime-web": "1.14.0" }`.
  - ONNX Runtime 1.14.0 was built against ONNX 1.13, which only supports ONNX IR versions $\le 8$.
  - When `InferenceSession.create` was invoked inside the inference worker with the Qwen model buffer, the underlying WASM runtime emitted `Unsupported model IR version: 10, max supported IR version: 8` and threw `Can't create a session`.

### B. Chat Error Misattribution
- In `lib/ai.ts`, when `generativeRuntime.initializeLocalModel()` failed, the code unconditionally threw:
  ```typescript
  throw new Error(
    `Local AI model is not provisioned and Chrome Prompt API is unavailable (${textAvail}). Please download the local models in Settings to enable offline AI.`
  )
  ```
  This falsely claimed the model was not provisioned even when the 512 MB Qwen artifact was 100% verified and resident in `CacheStorage`.

### C. Voice Page Error Invisibility & Transcript Loss
- `screens/main-screen.tsx` previously did not subscribe to `generativeRuntime`. When the inference worker crashed or entered the offline state, the main Voice view showed a green "ready" dot and no error banner.
- When a user spoke via Spacebar PTT or the microphone button, Whisper successfully transcribed the audio, but when the subsequent agent dispatch failed due to the SLM error, the error was swallowed or logged only to console. The user saw no feedback and their recognized words were not displayed on the screen.

---

## 3. Implementation Details

### A. `package.json` & Dependency Resolution
Configured pnpm overrides to ensure all instances of `onnxruntime-web` resolve to `1.31.1`:
```json
  "packageManager": "pnpm@10.17.0",
  "pnpm": {
    "overrides": {
      "onnxruntime-web": "1.31.1"
    }
  }
```
- Both `@xenova/transformers` and `@ricky0123/vad-web` now resolve to `onnxruntime-web@1.31.1`.
- Verified that `assets/ort-wasm-simd-threaded.wasm` (14,848,852 bytes) is the matching 1.31.1 WASM binary supporting IR version 10+.

### B. Inference Worker & Generative Runtime Hardening
- **`lib/workers/inference-worker.ts`:**
  - Differentiated between `ModelNotProvisionedError` (file missing/unprovisioned) and `ONNXSessionError` (runtime session creation failure).
  - Propagates full error context to the parent thread.
- **`lib/generative-runtime.ts`:**
  - Proper disposal of old worker instances during `restartEngine()`.
  - Resets `recoveryAttempts = 0` on explicit restart.
  - Prevents hanging promises on worker termination.

### C. Chat Error Disambiguation (`lib/ai.ts`)
Updated `ensureSession` in `lib/ai.ts`:
- Checks `generativeRuntime.getState().error`.
- If Prompt API session creation failed on device AND local Qwen SLM failed, reports both accurate causes.
- Only recommends downloading models in Settings if the failure was a genuine cache miss (`ModelNotProvisionedError`).

### D. Voice Page UI Synchronization (`screens/main-screen.tsx`)
- Added subscription to `generativeRuntime.subscribe()` in `useEffect`.
- Rendered the `Local AI Engine Offline` / `Local AI Recovering...` banner with the `Restart Engine` action button.
- Updated `computedStatusDot` to reflect `'error'` when `engineState.status === 'error'` and `'processing'` when recovering.
- Under the waveform, rendered the user's recognized speech: `Heard: "[whisperText]"` alongside assistant status.
- Rendered inline AI generation error cards if the assistant generation fails, clearly distinguishing speech recognition success from AI response failure.

---

## 4. Verification & Test Evidence

### A. New Regression Test Suite (`tests/local-ai-worker-and-voice-error-repair.test.ts`)
Executed with Node test runner:
```text
✔ Item 1: ONNX Runtime Web version and compatibility with IR version 10 models (48.9468ms)
✔ Item 2: Model configurations and immutable revisions for all three models (0.5622ms)
✔ Item 3: Qwen generative text inference protocol and bounds checking (1.1227ms)
✔ Item 4: MiniLM embedding generation and semantic similarity ranking (0.5584ms)
✔ Item 5: Whisper Tiny speech transcription from audio sample (15.0425ms)
✔ Item 6 & 7: Chat error disambiguation between Prompt API and Local SLM failures (1.2232ms)
✔ Item 8: Voice page UI synchronization with GenerativeRuntime state (632.4297ms)
✔ Item 9: Speech recognition vs AI generation error decoupling and transcript preservation (1.6189ms)
✔ Item 11: Strict offline zero-egress configuration in all pipelines (2.2712ms)
✔ Item 12: Worker recovery bounded retries and clean disposal (0.5968ms)
✔ Item 14: Strict Waveform Invariant (components/waveform.tsx must have 0 diff) (199.0558ms)
ℹ tests 11, pass 11, fail 0
```

### B. Full Test Suite (`npm test`)
```text
ℹ tests 171
ℹ suites 0
ℹ pass 171
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1861.1861
```

### C. Phase 4 Regression Suites
Ran `tests/phase4-offline-resilience.test.ts`, `tests/phase4-1-model-provisioning-restoration.test.ts`, `tests/phase4-2-model-alignment-revisions.test.ts`, `tests/critical-ptt-failure-repair.test.ts`, and `tests/critical-runtime-repair.test.ts`:
```text
ℹ tests 45, pass 45, fail 0
```

### D. Production Bundle Inspection
- `build/chrome-mv3-prod/onnx.39a9f57f.js`: Verified presence of `onnxruntime-web@1.31.1` and total absence of `1.14.0`.
- `build/chrome-mv3-prod/transformers.1fabdbf2.js`: Verified presence of `onnxruntime-web@1.31.1`.
- `build/chrome-mv3-prod/assets/ort-wasm-simd-threaded.wasm`: Exact size `14848852` bytes.

---

## 5. Architectural Invariant Compliance

| Invariant | Requirement | Status | Verification |
|---|---|---|---|
| **Waveform File Integrity** | `components/waveform.tsx` must be identical to `f6e31c78a9d652d69a002efb00726ec73a606122` | **PASS** | `git diff ... components/waveform.tsx` yields 0 bytes |
| **Offline Zero Egress** | `env.allowRemoteModels = false` in all neural pipelines | **PASS** | Verified in Worker, Whisper, and Embeddings pipelines |
| **Model Immutability** | All model revisions pinned to 40-char commit SHAs | **PASS** | Verified in Model Provisioning registry |
| **Engine Isolation** | Dedicated Web Worker for SLM token loop | **PASS** | Never loads 495MB Qwen on renderer main thread |
| **Error Decoupling** | Voice ASR availability decoupled from Generative SLM | **PASS** | Whisper transcripts preserved during SLM offline states |

---

## 6. Conclusion

The `Local AI Engine Offline` issue caused by the ONNX Runtime IR version mismatch is completely repaired. The dedicated worker can now create sessions for `onnx-community/Qwen2.5-0.5B-Instruct` without IR version errors. Error feedback across both Chat and Voice pages is accurate, transparent, and actionable, with speech recognition decoupled from generation failures and recognized transcripts preserved.
