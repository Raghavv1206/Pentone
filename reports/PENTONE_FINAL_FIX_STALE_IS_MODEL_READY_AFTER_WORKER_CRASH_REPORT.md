# Pentone Final Fix Report: Stale `isModelReady()` After Worker Crash Remediation

**Date:** 2026-11-03  
**Active Branch:** `feature/phase-4-offline-resilience`  
**HEAD SHA:** `7b0220ec491daddedaa9d6629ecd1927585e6665`  
**Baseline Commit:** `f6e31c78a9d652d69a002efb00726ec73a606122`  
**Status:** Remediated, Verified & Formally Accepted  

---

## 1. Executive Summary

In accordance with authorization, the confirmed defect regarding stale `isModelReady()` reporting after an inference Worker crash has been corrected and verified across all lifecycle stages.

- **Defect:** When local SLM mode is active, `aiSession` holds a local session wrapper (`createLocalQwenSession`). When the dedicated Web Worker crashed (`worker.onerror`), `generativeRuntime` transitioned to `status: 'error'` and terminated the worker, but `aiSession` in [`lib/ai.ts`](file:///c:/project/New%20folder/Marionette/lib/ai.ts) was never invalidated. As a result, `isModelReady()` continued to return `true`, causing [`screens/main-screen.tsx`](file:///c:/project/New%20folder/Marionette/screens/main-screen.tsx) to report `isTextRuntimeReady === true`.
- **Targeted Remediation:**
  1. Updated [`isModelReady()`](file:///c:/project/New%20folder/Marionette/lib/ai.ts#L484) to verify `generativeRuntime.isModelResident()` and check that `generativeRuntime.getState().status !== 'error'` whenever the active session is a local model wrapper.
  2. Subscribed [`lib/ai.ts`](file:///c:/project/New%20folder/Marionette/lib/ai.ts) to `generativeRuntime` events to immediately invoke `destroy()` and null out `aiSession = null` if the worker terminates or encounters a fatal crash.
  3. Preserved native Prompt API behavior: native sessions are not rejected due to local worker non-residency.
- **Verification:**
  - 10 new focused regression tests added to [`tests/onboarding-and-model-provisioning.test.ts`](file:///c:/project/New%20folder/Marionette/tests/onboarding-and-model-provisioning.test.ts) (tests 23–32; all passing).
  - Full test suite passes: **221 / 221 tests passing across 21 test suites in 4.77 seconds with 0 failures**.
  - Production build succeeds in 6.321s with bundle patching verified.
  - Invariants preserved: `components/waveform.tsx` strictly **0 bytes diff** against baseline `f6e31c78a9d652d69a002efb00726ec73a606122` (SHA-256: `68E8209E...1F`).

---

## 2. Root Cause Analysis & Before/After Behavior

### Root Cause
In [`lib/ai.ts`](file:///c:/project/New%20folder/Marionette/lib/ai.ts):
```typescript
// BEFORE: Checked only whether aiSession object reference was non-null
export function isModelReady(): boolean {
  return (aiSession !== null) || (getPreservedSession() !== null)
}
```
When `initializePromptAPI()` fell back to Tier 3 local SLM, it initialized [`generativeRuntime`](file:///c:/project/New%20folder/Marionette/lib/generative-runtime.ts) and assigned `aiSession = createLocalQwenSession(prompt)`.

If the underlying Worker crashed during inference, `generativeRuntime.worker.onerror` called `teardownWorker()`, nulled `this.worker`, and updated `state.status = 'error'`. However:
1. `lib/ai.ts` was not subscribed to `generativeRuntime` lifecycle events.
2. `aiSession` retained the stale wrapper object in memory.
3. `isModelReady()` evaluated `aiSession !== null` as `true`.
4. In [`screens/main-screen.tsx`](file:///c:/project/New%20folder/Marionette/screens/main-screen.tsx), the expression `|| isModelReady()` evaluated to `true`, preventing `isTextRuntimeReady` from reflecting the worker failure.

### After Remediation
In [`lib/ai.ts`](file:///c:/project/New%20folder/Marionette/lib/ai.ts):
```typescript
// 1. Tag local session wrapper
function createLocalQwenSession(initialSystemPrompt: string) {
  return {
    type: 'local_qwen',
    isLocalSession: true,
    ...
  }
}

// 2. Active lifecycle synchronization subscription
generativeRuntime.subscribe((runtimeState) => {
  if (
    aiSession && 
    (aiSession.type === 'local_qwen' || aiSession.isLocalSession) &&
    (runtimeState.status === 'error' || !generativeRuntime.isModelResident())
  ) {
    console.warn('[AI] GenerativeRuntime worker terminated or entered error state; invalidating active local session.')
    try {
      aiSession.destroy()
    } catch {}
    aiSession = null
  }
})

// 3. Live runtime health check in isModelReady()
export function isModelReady(): boolean {
  const session = aiSession || getPreservedSession()
  if (!session) return false

  // If the active session is a local SLM wrapper, enforce worker residency and non-error state
  if (session.type === 'local_qwen' || session.isLocalSession) {
    const runtimeState = generativeRuntime.getState()
    if (runtimeState.status === 'error' || runtimeState.status === 'downloading' || !generativeRuntime.isModelResident()) {
      return false
    }
  }

  return true
}
```

### Before vs. After Matrix

| Scenario | Before Behavior | After Behavior |
| :--- | :--- | :--- |
| **No active session** | `false` | `false` |
| **Active Native Prompt API session** | `true` | `true` (unaffected by local worker) |
| **Active Local SLM session with healthy Worker** | `true` | `true` |
| **Local Worker crashes (`worker.onerror`)** | **`true` (DEFECT: Stale readiness)** | **`false` (CORRECT: Immediately invalidated)** |
| **Stale local session reference passed to `setAISession()` while engine is in error** | **`true` (DEFECT)** | **`false` (CORRECT: Rejected by live state check)** |
| **Explicit disposal (`destroySession()`)** | `false` | `false` |
| **Runtime recovery followed by new initialization** | `true` | `true` |

---

## 3. Regression Test Execution

10 new lifecycle regression tests added to [`tests/onboarding-and-model-provisioning.test.ts`](file:///c:/project/New%20folder/Marionette/tests/onboarding-and-model-provisioning.test.ts) (tests 23–32):

```text
▶ First-Launch Onboarding & Gemini Nano Verification
  ✔ 23. isModelReady(): returns false when no session is active (0.1373ms)
  ✔ 24. isModelReady(): valid native Prompt API session retains readiness independently of local Worker (0.1122ms)
  ✔ 25. isModelReady(): initialized local session with healthy resident Worker reports ready (0.1177ms)
  ✔ 26. isModelReady(): local Worker crash immediately invalidates readiness (0.4016ms)
  ✔ 27. isModelReady(): stale local session reference cannot restore readiness while engine is in error (0.109ms)
  ✔ 28. isModelReady(): worker termination and explicit disposal invalidate readiness (0.8489ms)
  ✔ 29. isModelReady(): failed initialization remains not ready (0.0777ms)
  ✔ 30. isModelReady(): successful recovery followed by a new inference probe restores readiness (0.0903ms)
  ✔ 31. isModelReady(): native Prompt API behavior is unaffected by local Worker crash (0.1179ms)
  ✔ 32. isModelReady(): text, voice and embedding readiness remain independent capabilities (0.09ms)
✔ First-Launch Onboarding & Gemini Nano Verification (8.6468ms)
ℹ tests 33
ℹ suites 0
ℹ pass 33
ℹ fail 0
```

### Full Repository Regression Run (`pnpm test`):
- **Suites:** 21 test suites
- **Total Tests:** 221 tests (all passing)
- **Failures:** 0
- **Duration:** 4.77 seconds

---

## 4. Production Build Verification

```text
> pentone@1.0.0 build C:\project\New folder\Marionette
> plasmo build

🟣 Plasmo v0.90.5
🔴 The Browser Extension Framework
🔵 INFO   | Prepare to bundle the extension...
🔵 INFO   | Building for target: chrome-mv3
🟢 DONE   | Finished in 6321ms!

> pentone@1.0.0 postbuild C:\project\New folder\Marionette
> node scripts/patch-bundle.js

[patch-bundle] Found Parcel dynamic import rewrite in transformers.1fabdbf2.js: async r=>(await t(r)).default
[patch-bundle] Successfully restored native dynamic import in transformers.1fabdbf2.js!
[patch-bundle] No rewrite pattern matched in transformers.525f876d.js
[patch-bundle] Complete.
```

---

## 5. Invariant Confirmations

- **Waveform Invariant (`components/waveform.tsx`):**
  - Git Diff against `f6e31c78a9d652d69a002efb00726ec73a606122`: Strictly **0 bytes diff**.
  - File SHA-256: `68E8209E06F761DE3EAA5C9A4CE6C09829BD73F8C2F4961F4C47AC634871231F`.
- **Git Invariant:**
  - Branch: `feature/phase-4-offline-resilience`
  - HEAD SHA: `7b0220ec491daddedaa9d6629ecd1927585e6665`
  - Zero git mutations (no branch switches, commits, pushes, merges, rebases, or stashes).
