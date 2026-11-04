# Pentone — Final Runtime Readiness Verification: `isModelReady()`

**Audit Type:** Strictly Read-Only Verification Audit  
**Date:** 2026-11-03  
**Active Branch:** `feature/phase-4-offline-resilience`  
**HEAD SHA:** `7b0220ec491daddedaa9d6629ecd1927585e6665`  
**Baseline Commit:** `f6e31c78a9d652d69a002efb00726ec73a606122`  
**Current Test Status:** 211 / 211 tests passing across 21 suites  

---

## 1. Exact Source Implementation of `isModelReady()`

File: [`lib/ai.ts`](file:///c:/project/New%20folder/Marionette/lib/ai.ts#L484-L486)

```typescript
export function isModelReady(): boolean {
  return (aiSession !== null) || (getPreservedSession() !== null)
}
```

### Analysis of Conditions:
1. **Conditions Evaluated:** Checks solely whether the module-scoped variable `aiSession !== null` or `getPreservedSession() !== null`.
2. **Inference Session Initialization:** It checks whether a session object was assigned during `initializePromptAPI()`, `downloadOnDeviceModel()`, or `setAISession()`.
3. **Session Liveness & Worker Responsiveness:**
   - **Chrome Prompt API Sessions:** Checks only object presence. Does not ping or probe the Chromium utility process to determine if the underlying on-device AI process has crashed.
   - **Local SLM Sessions (`createLocalQwenSession`):** When Prompt API is unavailable, `initializePromptAPI()` initializes `generativeRuntime` and creates a local session wrapper (`aiSession = createLocalQwenSession(prompt)`). If `generativeRuntime.worker` later terminates or crashes (`worker.onerror`), `generativeRuntime` transitions to `status: 'error'` and nulls its worker, **but `aiSession` in `lib/ai.ts` is never nulled out**.
4. **Stale Readiness Survival:**
   - On explicit disposal (`destroySession()`), `aiSession` is set to `null` and `clearPreservedSession()` is called; readiness correctly resets to `false`.
   - On Worker termination or crash during active usage, `aiSession` remains populated. Consequently, **stale readiness survives Worker termination**.
5. **Concurrent Initialization:** Safely gated behind `sessionCreationPromise` deduplication in `initializePromptAPI()`.

---

## 2. All Relevant Call Sites

1. **[`screens/main-screen.tsx`](file:///c:/project/New%20folder/Marionette/screens/main-screen.tsx#L117-L125) (`isTextRuntimeReady`):**
   ```typescript
   const isTextRuntimeReady = Boolean(
     isCoreProvisioned &&
     (
       (generativeRuntime.isModelResident() && (engineState.status === 'ready' || engineState.status === 'generating')) ||
       isModelReady()
     )
   )
   ```
   *Impact:* If `isModelReady()` returns `true` while the Worker is crashed or in `'error'`, `isTextRuntimeReady` evaluates to `true` despite `generativeRuntime.isModelResident()` being `false`.
2. **[`tests/suite-j-onboarding-and-download-lifecycle.test.ts`](file:///c:/project/New%20folder/Marionette/tests/suite-j-onboarding-and-download-lifecycle.test.ts#L180):**
   - Asserts `isModelReady() === true` after `downloadOnDeviceModel()` attaches a preserved session.
   - Asserts `isModelReady() === false` before session creation and immediately after `destroySession()`.
   - Asserts `isModelReady() === false` when Prompt API availability reports `'downloadable'`, `'downloading'`, or `'unavailable'`.

---

## 3. Verification Scenarios & Semantics Matrix

| # | Scenario | Expected Result | Actual Behavior | Audit Finding |
|---|---|---|---|---|
| 1 | Fresh installation, no model files | Not ready (`false`) | `false` | **VERIFIED** (`aiSession === null`) |
| 2 | Model files downloaded but not verified | Not ready (`false`) | `false` | **VERIFIED** |
| 3 | Model files verified in CacheStorage | Not ready (`false`) | `false` | **VERIFIED** (Cache alone does not set `aiSession`) |
| 4 | Model initialized but Worker handshake incomplete | Not ready (`false`) | `false` | **VERIFIED** (`initializeLocalModel()` must resolve first) |
| 5 | Worker initialized and real inference probe succeeds | Ready (`true`) | `true` | **VERIFIED** |
| 6 | **Worker crashes after successful initialization** | **Not ready (`false`)** | **`true` (DEFECT)** | **CONFIRMED DEFECT: Stale `aiSession` retains `true`** |
| 7 | Session disposed or unloaded (`destroySession()`) | Not ready (`false`) | `false` | **VERIFIED** (`aiSession = null`) |
| 8 | Initialization throws an error | Not ready (`false`) | `false` | **VERIFIED** (No session assigned) |
| 9 | Inference probe fails | Not ready (`false`) | `false` | **VERIFIED** (Creation aborted) |
| 10 | Runtime successfully recovers and passes new probe | Ready (`true`) | `true` | **VERIFIED** |

---

## 4. Inspection of Related Readiness Calculations

1. **`isCoreProvisioned`:**
   - Evaluates: `Boolean(modelsCached.qwen && modelsCached.embeddings && modelsCached.whisper)`.
   - Confirms files exist in CacheStorage with matching SHA-256 hashes.
   - Does not imply runtime memory residency.
2. **`isWhisperReady`:**
   - Evaluates: `WhisperASRService.getInstance().isReady()`.
   - Strictly checks whether `this.asrPipeline !== null || sharedPipeline !== null`.
   - Independent of text generation and embeddings.
3. **`isTextRuntimeReady`:**
   - Evaluates: `Boolean(isCoreProvisioned && ((generativeRuntime.isModelResident() && (engineState.status === 'ready' || engineState.status === 'generating')) || isModelReady()))`.
   - Checks text generation capability independently of Whisper.
4. **`isVoiceRuntimeReady`:**
   - Evaluates: `Boolean(isTextRuntimeReady && modelsCached.whisper && isWhisperReady)`.
   - Strictly enforces that both speech recognition (Whisper) and text reasoning (SmolLM) are operational.
5. **`isCoreReady`:**
   - Evaluates: `Boolean(isCoreProvisioned && isTextRuntimeReady && isVoiceRuntimeReady)`.
   - True only when all files are cached AND all runtimes are resident and active.
6. **`computedStatusDot`:**
   - Prioritized: `error` → `listening` → `processing` → `downloading` → `ready` (only if `isVoiceRuntimeReady`) → `initializing`.
   - Never falls through to `'ready'`.
7. **Independence Verification:**
   - SmolLM readiness does not imply Whisper readiness.
   - Whisper readiness does not imply SmolLM readiness.
   - Embeddings are validated in CacheStorage but never conflated with active inference workers.

---

## 5. Confirmed Defect & Proposed Targeted Correction

### Defect Description
- **Location:** [`lib/ai.ts:484`](file:///c:/project/New%20folder/Marionette/lib/ai.ts#L484)
- **Root Cause:** When local SLM mode is active, `aiSession` is assigned a wrapper object that delegates to `generativeRuntime`. When the background Worker crashes or enters an error state, `generativeRuntime` transitions to `status: 'error'`, but `aiSession` remains non-null. Therefore, `isModelReady()` continues returning `true`, preventing `screens/main-screen.tsx` from recognizing the worker failure.

### Proposed Minimal Targeted Correction
In [`lib/ai.ts`](file:///c:/project/New%20folder/Marionette/lib/ai.ts):
```typescript
export function isModelReady(): boolean {
  const session = aiSession || getPreservedSession()
  if (!session) return false

  // If local engine is in error, local text inference is not ready
  if (generativeRuntime.getState().status === 'error') {
    return false
  }

  // If the active session is a local SLM wrapper, enforce worker residency
  if ((session as any).isLocalSession && !generativeRuntime.isModelResident()) {
    return false
  }

  return true
}
```
And in [`lib/ai.ts`](file:///c:/project/New%20folder/Marionette/lib/ai.ts#L290), add `isLocalSession: true` to the object returned by `createLocalQwenSession()`:
```typescript
function createLocalQwenSession(initialSystemPrompt?: string): any {
  return {
    isLocalSession: true,
    prompt: async (input: any) => { ... },
    ...
  }
}
```
And subscribe `lib/ai.ts` to clear `aiSession` when local engine enters error:
```typescript
generativeRuntime.subscribe((state) => {
  if (state.status === 'error' && (aiSession as any)?.isLocalSession) {
    aiSession = null
  }
})
```

---

## 6. Invariants Confirmation

- **Waveform Invariant (`components/waveform.tsx`):**
  - Git Diff against `f6e31c78a9d652d69a002efb00726ec73a606122`: Strictly **0 bytes diff**.
  - File SHA-256: `68E8209E06F761DE3EAA5C9A4CE6C09829BD73F8C2F4961F4C47AC634871231F`.
- **Git Invariant:**
  - Branch: `feature/phase-4-offline-resilience`
  - HEAD SHA: `7b0220ec491daddedaa9d6629ecd1927585e6665`
  - Zero branch switches, commits, pushes, merges, rebases, or stashes.
- **Read-Only Protocol:**
  - No source code modifications applied. Awaiting explicit user authorization before applying the proposed targeted correction.
