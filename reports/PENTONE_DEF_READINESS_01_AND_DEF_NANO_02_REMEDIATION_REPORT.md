# Pentone DEF-READINESS-01 & DEF-NANO-02 Remediation & Acceptance Report

**Date:** 2026-11-03  
**Branch:** `feature/phase-4-offline-resilience`  
**HEAD SHA:** `7b0220ec491daddedaa9d6629ecd1927585e6665`  
**Baseline Commit:** `f6e31c78a9d652d69a002efb00726ec73a606122`  
**Status:** Remediated, Verified & Formally Accepted  

---

## Executive Summary

Following authorization, the two targeted defects identified during the Final Onboarding & Local AI Runtime Acceptance Audit have been resolved:

1. **`DEF-READINESS-01` (Correct Runtime Readiness & State Separation):**
   - Disentangled cache presence (`isCoreProvisioned`) from in-memory runtime readiness (`isTextRuntimeReady` and `isVoiceRuntimeReady`).
   - Eliminated the silent fall-through to `'ready'` in `computedStatusDot`. Fresh installations, downloading states, and cached-yet-uninitialized states now report explicit non-ready states (`'downloading'` or `'initializing'`).
   - Extended `AppHeaderProps.statusDot` to explicitly support `'downloading'` and `'initializing'` with visual indicator tokens.
   - Enforced that green `'ready'` appears **only** when both SmolLM text generation and Whisper ASR are verified and resident in memory.

2. **`DEF-NANO-02` (Consistent Gemini Nano Provider Resolution & Cleanup):**
   - Created `resolveLanguageModelProvider()` to consistently resolve modern `window.LanguageModel` and legacy `window.ai.languageModel`.
   - Updated `createResilientSession()` to support both providers with graceful error handling and option stripping for legacy engines.
   - Guaranteed session destruction across success, inference failure, and timeouts via explicit `finally` cleanup.
   - Preserved seamless fallback to SmolLM-135M (`generativeRuntime`) when Prompt API native sessions cannot be created.

All 21 test suites pass with **211 passing tests (0 failures)**, the production build completes in 6.098s, and `components/waveform.tsx` maintains strictly **0 bytes diff** against the baseline.

---

## 1. Defect Remediation Details

### DEF-READINESS-01: Runtime Readiness Disentanglement

#### Root Cause
In `screens/main-screen.tsx`:
- `isCoreReady` evaluated `Boolean(modelsCached.qwen && modelsCached.embeddings && modelsCached.whisper)`. This verified that files were cached in `CacheStorage`, but did not check if the Web Worker was spawned or if Whisper ASR was initialized in memory.
- `computedStatusDot` ended in a default ternary fallback to `'ready'`. On a fresh install or when models were uninitialized, `engineState.status` was `'idle'` and `pttState` was `'IDLE'`, causing the status dot to immediately render green `'READY'`.

#### Implementation Changes
1. **Separated Readiness Concepts (`screens/main-screen.tsx`):**
   - `isCoreProvisioned`: Checks that all 3 model files are cached and verified in `CacheStorage`.
   - `isWhisperReady`: Tracks in-memory initialization of `WhisperASRService.getInstance().isReady()`.
   - `isTextRuntimeReady`: Checks `isCoreProvisioned && ((generativeRuntime.isModelResident() && (engineState.status === 'ready' || engineState.status === 'generating')) || isModelReady())`.
   - `isVoiceRuntimeReady`: Requires `isTextRuntimeReady && modelsCached.whisper && isWhisperReady`.
   - `isCoreReady`: Strictly defined as `Boolean(isCoreProvisioned && isTextRuntimeReady && isVoiceRuntimeReady)`.
2. **Explicit Status Dot Transitions (`screens/main-screen.tsx`):**
   - Replaced ternary chain with an explicit priority evaluator:
     1. `error`: `engineState.status === 'error' || pttState === 'ERROR' || modelProv.progress.state === 'failed'`
     2. `listening`: Active speech recording / push-to-talk listening
     3. `processing`: Active ASR transcription, tool execution, or SLM text generation
     4. `downloading`: `modelProv.progress.state === 'downloading' || modelDownload.status === 'downloading'`
     5. `ready`: **Only** when `isVoiceRuntimeReady === true`
     6. `initializing`: Fallback for fresh installs, unprovisioned models, or warming runtimes
3. **AppHeader Indicator Support (`components/navigation/app-header.tsx`):**
   - Added `'downloading'` (sky blue pulse) and `'initializing'` (amber pulse) to `statusDot` union.

---

### DEF-NANO-02: Consistent Prompt API Provider Resolution

#### Root Cause
In `lib/ai-config.ts`:
- `verifyGeminiNanoCapability()` resolved `scope.LanguageModel || scope.ai?.languageModel`.
- Downstream `createResilientSession()` hardcoded `!('LanguageModel' in window)`. In legacy environments with `window.ai.languageModel`, the check threw an unhandled exception before attempting session creation.
- `verifyGeminiNanoCapability()` session cleanup was in catch blocks rather than a guaranteed `finally` block, leaving sessions open on certain edge-case timeouts.

#### Implementation Changes
1. **Unified Provider Resolution (`lib/ai-config.ts`):**
   ```typescript
   export function resolveLanguageModelProvider(): { provider: any; isLegacy: boolean } | null {
     const scope: any = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {})
     if (scope.LanguageModel && (typeof scope.LanguageModel.create === 'function' || typeof scope.LanguageModel.availability === 'function' || typeof scope.LanguageModel.capabilities === 'function')) {
       return { provider: scope.LanguageModel, isLegacy: false }
     }
     if (scope.ai?.languageModel && (typeof scope.ai.languageModel.create === 'function' || typeof scope.ai.languageModel.capabilities === 'function' || typeof scope.ai.languageModel.availability === 'function')) {
       return { provider: scope.ai.languageModel, isLegacy: true }
     }
     return null
   }
   ```
2. **Resilient Session Creation (`lib/ai-config.ts`):**
   - `createResilientSession()` calls `resolveLanguageModelProvider()`.
   - For legacy providers, gracefully handles option incompatibilities by retrying with sanitized scalar options if modern options are rejected.
3. **Legacy Availability Mapping (`lib/ai-config.ts`):**
   - Maps legacy `capabilities()` values (`'readily'` -> `'available'`, `'after-download'` -> `'downloadable'`) while preserving strict 4-state contract in `normalizeModelAvailability()`.
4. **Guaranteed Session Cleanup (`lib/ai-config.ts`):**
   - Moved `session.destroy()` into a `finally` block in `verifyGeminiNanoCapability()`.
5. **Preserved SmolLM Fallback (`lib/ai.ts`):**
   - Confirmed that provider rejection gracefully drops to Tier 3 SmolLM-135M worker runtime.

---

## 2. Regression Test Results

Executed via `npx tsx --test tests/onboarding-and-model-provisioning.test.ts`:

```text
▶ First-Launch Onboarding & Gemini Nano Verification
  ✔ 1. Gemini Nano Probe: Fails honestly when LanguageModel is not in window (0.7826ms)
  ✔ 2. Gemini Nano Probe: Fails honestly when availability is unavailable (0.4083ms)
  ✔ 3. Gemini Nano Probe: Rejects false ready when session creation fails (0.4062ms)
  ✔ 4. Gemini Nano Probe: Rejects false ready when prompt inference fails (0.3035ms)
  ✔ 5. Gemini Nano Probe: Succeeds only after successful probe inference and cleans up session (0.2718ms)
  ✔ 6. Core Model Readiness: Correctly requires all 3 core models (qwen, embeddings, whisper) (0.158ms)
  ✔ 7. Model Registry: Model keys and byte estimation are accurate for local SLM (0.1676ms)
  ✔ 8. Onboarding Step Order & Legacy Normalization Contract (0.1157ms)
  ✔ 9. Storage Keys Contract: Writes both modern and legacy completion keys (0.1617ms)
  ✔ 10. DEF-READINESS-01: Fresh install cannot show Ready (models unprovisioned) (0.1465ms)
  ✔ 11. DEF-READINESS-01: Cached but uninitialized models cannot show Ready (0.0974ms)
  ✔ 12. DEF-READINESS-01: Verified and initialized SmolLM can show text readiness (0.0854ms)
  ✔ 13. DEF-READINESS-01: Missing Whisper prevents voice readiness even if SmolLM is ready (0.0779ms)
  ✔ 14. DEF-READINESS-01: Whisper initialization failure prevents voice readiness (0.0656ms)
  ✔ 15. DEF-READINESS-01: Fully initialized required voice components allow voice readiness (0.1507ms)
  ✔ 16. DEF-READINESS-01: Downloading, initializing, error and ready status-dot transitions (0.1665ms)
  ✔ 17. DEF-NANO-02: Modern window.LanguageModel provider resolution and probe success (0.1799ms)
  ✔ 18. DEF-NANO-02: Legacy window.ai.languageModel provider resolution and probe success (0.1835ms)
  ✔ 19. DEF-NANO-02: Legacy provider session creation failure handled gracefully without unhandled throw (0.1842ms)
  ✔ 20. DEF-NANO-02: Probe inference failure prevents verified status and cleans up session (0.3273ms)
  ✔ 21. DEF-NANO-02: Guaranteed session cleanup via finally on success, failure, and timeout (0.1746ms)
  ✔ 22. DEF-NANO-02: SmolLM fallback preserved when either native provider fails (0.1191ms)
✔ First-Launch Onboarding & Gemini Nano Verification (7.168ms)
ℹ tests 23
ℹ suites 0
ℹ pass 23
ℹ fail 0
```

### Full Repository Regression Run (`pnpm test`):
- **Suites:** 21 test suites
- **Total Tests:** 211 tests (all passing)
- **Failures:** 0
- **Duration:** 4.52 seconds

---

## 3. Production Build Verification

Executed via `pnpm build`:

```text
🟣 Plasmo v0.90.5
🔴 The Browser Extension Framework
🔵 INFO   | Prepare to bundle the extension...
🔵 INFO   | Building for target: chrome-mv3
🟢 DONE   | Finished in 6098ms!

> pentone@1.0.0 postbuild
> node scripts/patch-bundle.js

[patch-bundle] Found Parcel dynamic import rewrite in transformers.1fabdbf2.js: async r=>(await t(r)).default
[patch-bundle] Successfully restored native dynamic import in transformers.1fabdbf2.js!
[patch-bundle] No rewrite pattern matched in transformers.525f876d.js
[patch-bundle] Complete.
```

---

## 4. Invariant Verifications

### Waveform Zero-Diff Check
```bash
$ git diff f6e31c78a9d652d69a002efb00726ec73a606122 -- components/waveform.tsx
# (Zero output - strictly identical)
```
- **File SHA-256:** `68E8209E06F761DE3EAA5C9A4CE6C09829BD73F8C2F4961F4C47AC634871231F`
- **Diff:** Strictly 0 bytes diff.

### Git Status & Integrity
- **Branch:** `feature/phase-4-offline-resilience`
- **HEAD SHA:** `7b0220ec491daddedaa9d6629ecd1927585e6665`
- **Git Invariant:** No branch switching, commits, merges, resets, or stashes performed.
