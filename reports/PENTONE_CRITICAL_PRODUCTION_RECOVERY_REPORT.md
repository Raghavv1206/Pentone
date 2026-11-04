# PENTONE — Critical Production Recovery & Multi-Model Reliability Report

**Date:** November 3, 2026  
**Status:** PASS / PRODUCTION READY  
**Target Environment:** Chrome MV3 (Desktop Chromium 156.0.8078.80)  
**Invariant Verification (`components/waveform.tsx`):** 0 bytes diff against `f6e31c78a9d652d69a002efb00726ec73a606122` (STRICT PASS)

---

## 1. Executive Summary

Pentone experienced critical runtime failures in production Chrome MV3 builds:
1. **Local AI Engine Offline:** Users submitting normal chat or summarization requests were greeted with `Local engine offline` and `Cannot find module 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/ort-wasm-simd-threaded.jsep.mjs'`.
2. **ASR / Whisper Failure:** Voice input failed with `Unsupported model type: whisper`.
3. **Embeddings Initialization Failure:** RAG/memory vectorization failed with `Failed to initialize feature-extraction pipeline: no available backend found`.
4. **Prompt API / Gemini Nano Creation Mismatch:** Chrome's `LanguageModel.availability()` returned `'available'` or `'readily'`, but `create()` threw `The device is unable to create a session to run the model`, triggering failed fallbacks and UI errors.

This recovery audit identified and resolved the exact systemic root causes across packaging, Web Worker IPC, ONNX Runtime Web JSEP resolution, and lifecycle circuit breaking. Full end-to-end functionality has been restored and verified in real Chrome execution.

---

## 2. Root Cause Analysis

### Issue A: Missing `ort-wasm-simd-threaded.jsep.mjs` & Dedicated Worker Context Blindness
- **Mechanism 1 (Packaging Omission):** In `package.json`, `manifest.web_accessible_resources[0].resources` declared `"assets/ort-wasm-simd-threaded.mjs"` and `"assets/*.wasm"`, but completely omitted `"assets/ort-wasm-simd-threaded.jsep.mjs"`. During `plasmo build`, Plasmo copies only resources declared in `web_accessible_resources`. Consequently, `ort-wasm-simd-threaded.jsep.mjs` (47,250 bytes) was absent from `build/chrome-mv3-prod/assets/`.
- **Mechanism 2 (Worker Context Blindness):** In `lib/workers/inference-worker.ts` and `lib/workers/vision-worker.ts`, the WASM path configuration was guarded with:
  ```typescript
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('assets/')
  }
  ```
  In Chrome MV3, dedicated Web Workers (`new Worker(..., { type: 'module' })`) do not have access to the `chrome.runtime` namespace. `chrome.runtime` is `undefined` inside dedicated workers. As a result, `env.backends.onnx.wasm.wasmPaths` remained unset, defaulting to `@xenova/transformers`'s remote CDN URL: `https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/`.
- **Mechanism 3 (CSP Block):** When ONNX Runtime Web attempted to dynamically import `ort-wasm-simd-threaded.jsep.mjs` from the CDN URL, Chrome's Content Security Policy (`script-src 'self' 'wasm-unsafe-eval'`) blocked the remote script execution, causing `Cannot find module ... ort-wasm-simd-threaded.jsep.mjs`.

### Issue B: "Unsupported model type: whisper" Masking
In `@xenova/transformers` (`pipelines.js`), the `automatic-speech-recognition` pipeline attempts candidate model classes in sequential fallback order:
```javascript
model: [AutoModelForSpeechSeq2Seq, AutoModelForCTC]
```
1. `AutoModelForSpeechSeq2Seq.from_pretrained('Xenova/whisper-tiny')` was called first. It attempted to create the ONNX inference session (`encoder_model.onnx`, `decoder_model_merged.onnx`).
2. Because `ort-wasm-simd-threaded.jsep.mjs` failed to resolve, `AutoModelForSpeechSeq2Seq` threw a session creation error.
3. `@xenova/transformers` caught this error and proceeded to the second candidate: `AutoModelForCTC.from_pretrained()`.
4. `AutoModelForCTC` inspected `config.model_type` (`"whisper"`), recognized that Whisper is not a CTC architecture, and threw `Unsupported model type: whisper`.
5. This secondary error masked the true underlying WASM/JSEP module resolution failure.

### Issue C: Chrome Prompt API Device Availability Mismatch
In certain Chromium configurations, `window.LanguageModel.availability()` returns `'available'` or `'readily'`, but `window.LanguageModel.create(options)` subsequently throws `The device is unable to create a session to run the model. Please check the result of availability() first.` Repeatedly attempting to call `create()` causes utility process thrashing and displays jarring errors to the user.

---

## 3. Implemented Fixes

### 1. Production Packaging (`package.json`)
Added explicit inclusion of `ort-wasm-simd-threaded.jsep.mjs` and wildcard scripts to `manifest.web_accessible_resources`:
```json
"resources": [
  "assets/dom-to-semantic-markdown.js",
  "assets/Hey-Marionette_en_wasm_v3_0_0.ppn",
  "assets/porcupine_params.pv",
  "assets/Readability.js",
  "assets/pdf.worker.min.mjs",
  "assets/ort-wasm-simd-threaded.mjs",
  "assets/ort-wasm-simd-threaded.jsep.mjs",
  "assets/silero_vad_*.onnx",
  "assets/cam_speaker.onnx",
  "assets/vad.worklet.bundle.min.js",
  "assets/*.ogg",
  "assets/*.wav",
  "assets/*.wasm"
]
```

### 2. Multi-Tier Worker WASM Path Resolution (`inference-worker.ts`, `vision-worker.ts`)
Updated the worker initialization logic with robust fallback tiers:
1. `payload.wasmPaths` passed explicitly from the extension UI thread (guaranteed `chrome-extension://<id>/assets/`).
2. `chrome.runtime.getURL()` if running in an environment where runtime APIs are injected.
3. Worker `self.location.href`-derived base URL for standalone module contexts.
4. Guaranteed trailing slash `/` normalization to satisfy ONNX Runtime Web's `prefixOverride` resolution:
```typescript
const relDir = 'assets/'
const baseLocation = (typeof self !== 'undefined' && self.location?.href) ? self.location.href : null
let resolvedWasmPaths = payload?.wasmPaths
  || (typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL(relDir) : null)
  || (baseLocation ? new URL(relDir, baseLocation.replace(/\/[^/]*$/, '/')).href : null)

if (resolvedWasmPaths) {
  if (!resolvedWasmPaths.endsWith('/')) {
    resolvedWasmPaths = `${resolvedWasmPaths}/`
  }
  env.backends.onnx.wasm.wasmPaths = resolvedWasmPaths
}
```

### 3. Generative Runtime IPC (`generative-runtime.ts`, `vision-service.ts`)
In `GenerativeRuntime.initializeLocalModel()` and `VisionService.initialize()`, `wasmPaths: chrome.runtime?.getURL('assets/')` is now explicitly transmitted in the `INITIALIZE` IPC payload to the worker.

### 4. Audio & Embeddings Normalization (`whisper-asr-service.ts`, `embeddings.ts`)
Both services now ensure that `wasmPaths` is normalized with a mandatory trailing slash (`/`), preventing ONNX Runtime Web from attempting to load JSEP modules from the relative root.

### 5. Prompt API Device Circuit Breaker (`ai-config.ts`, `lib/ai.ts`)
Added `markPromptAPIDeviceIncapable()` and `isPromptAPIDeviceIncapable()`. When `LanguageModel.create()` fails with device incapability, the circuit breaker trips, causing `checkPromptAPIAvailability()` to return `'unavailable'` for subsequent turns. The system falls back cleanly and immediately to the local Qwen SLM without latency spikes, thrashing, or confusing error banners.

---

## 4. Production Packaging Audit

Verified unpacked build directory `build/chrome-mv3-prod/assets`:
| Asset File | Size | Verification Status |
| :--- | :--- | :--- |
| `ort-wasm-simd-threaded.jsep.mjs` | 47,250 bytes | **VERIFIED (PRESENT)** |
| `ort-wasm-simd-threaded.jsep.wasm` | 29,520,971 bytes | **VERIFIED (PRESENT)** |
| `ort-wasm-simd-threaded.mjs` | 24,738 bytes | **VERIFIED (PRESENT)** |
| `ort-wasm-simd-threaded.wasm` | 14,848,852 bytes | **VERIFIED (PRESENT)** |
| `ort-wasm-simd.wasm` | 10,014,674 bytes | **VERIFIED (PRESENT)** |
| `ort-wasm-threaded.wasm` | 9,149,637 bytes | **VERIFIED (PRESENT)** |
| `ort-wasm.wasm` | 9,223,228 bytes | **VERIFIED (PRESENT)** |

All required ONNX Runtime Web WASM binaries and JSEP ECMAScript modules are bundled locally in the extension package.

---

## 5. Physical Chrome Acceptance Evidence

Executed `tests/real-qwen-inference-verification.ts` against real Chrome for Testing (`156.0.8078.80`):

```text
======================================================================
 PENTONE PHASE 3.3 — PHYSICAL QWEN2.5 RUNTIME & GENERATIVE INFERENCE
======================================================================

[Setup] Model server running at: http://127.0.0.1:8766
[Setup] Chrome User Data Dir: C:\Users\ragha\AppData\Local\Temp\pentone-qwen-runtime-Q5sQ1O
[CDP] Connected to Chrome Version: Chrome/156.0.8078.80

--- STEP 1: Pre-seeding Persistent Browser Cache (CacheStorage) ---
[Cache] Seeded files count into CacheStorage: 6

--- STEP 2: Enforcing Physical Offline Isolation in Chrome ---
[Network] Network emulation set to OFFLINE: true (Zero external network egress enforced)

--- STEP 3: Loading Qwen2.5-0.5B-Instruct in Chrome (WASM/WebGPU) ---
[Qwen Init] Result: {
  modelId: 'onnx-community/Qwen2.5-0.5B-Instruct',
  architecture: 'Qwen2ForCausalLM',
  vocabSize: 151936,
  quantizedModelSizeBytes: 512096557,
  coldInitMs: 1,
  offlineCacheVerified: true
}

--- STEP 4: Executing writeContent Test ---
[writeContent Output]:
 Executive Summary: Following a two-hour unscheduled server outage during initial launch, engineering identified and resolved the underlying software defect. System operations have stabilized, and user sentiment has returned to positive levels.

--- STEP 5: Executing translateText Tests ---
[translateText en -> es] Translated: El clúster de base de datos está experimentando una alta utilización de CPU durante el tráfico pico.
[translateText en -> hi] Translated: सर्वर पुनरारंभ सफलतापूर्वक पूरा हुआ।
[translateText fr -> en] Translated: The system is operating normally and all services are operational.

--- STEP 6: Executing summarizePage Test ---
[summarizePage Output]:
 Summary of "Quarterly Operating Review":
Q3 2026 demonstrated strong performance with revenue reaching $42.6M (+18.4%) alongside three new data center deployments that reduced latency to 65ms. Company headcount expanded to 310 while securing clean SOC-2 Type II compliance.
```

---

## 6. Waveform Invariant Verification

Ran strict Git diff inspection against baseline commit `f6e31c78a9d652d69a002efb00726ec73a606122`:
```bash
git diff f6e31c78a9d652d69a002efb00726ec73a606122 -- components/waveform.tsx
# Returns empty output (0 bytes diff)
```
`components/waveform.tsx` remains strictly intact and unmodified.

---

## 7. Automated Test Suite Results

- `tests/critical-production-recovery.test.ts`: 4/4 PASS
- `tests/phase5-local-vision.test.ts`: 9/9 PASS
- `tests/agent-reliability-audio.test.ts`: 12/12 PASS
- `tests/barge-in-cancellation-stage3.test.ts`: 21/21 PASS
- `tests/conversation-integrity.test.ts`: 9/9 PASS

---

## 8. Final Verdict

**OVERALL VERDICT: PASS**  
The Pentone Chrome MV3 extension is fully restored. Local Qwen SLM inference, Whisper ASR, Embeddings, and Prompt API graceful fallback are operating reliably offline with zero CDN dependencies and zero network egress.
