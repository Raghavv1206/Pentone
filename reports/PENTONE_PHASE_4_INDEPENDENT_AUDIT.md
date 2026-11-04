# Pentone Phase 4 — Independent Read-Only Audit Report
## Offline Integrity Enforcement, Documentation Realignment & Worker Recovery

**Audited Commit:** `7b0220ec491daddedaa9d6629ecd1927585e6665` (`7b0220e`)  
**Parent / Baseline SHA:** `f6e31c78a9d652d69a002efb00726ec73a606122` (`origin/main`, `main`)  
**Branch:** `feature/phase-4-offline-resilience`  
**Date:** November 2, 2026  
**Auditor Mode:** Strictly Read-Only Independent Verification  

---

## 1. Executive Verdict

### **Verdict: `CONDITIONAL PASS — SPECIFIC VERIFICATION REMAINS`**

Phase 4 successfully implements the core requirements authorized in the Phase 4 proposal:
1. Strict `env.allowRemoteModels = false` enforcement in the primary inference worker and generative runtime.
2. Comprehensive realignment of [`README.md`](file:///c:/project/New%20folder/Marionette/README.md) to document the hybrid 4-tier architecture, 27 browser automation tools, and the capability gate.
3. Bounded exponential backoff worker recovery (1s, 2s, 4s backoff up to 3 attempts), with manual UI controls in [`screens/chat-screen.tsx`](file:///c:/project/New%20folder/Marionette/screens/chat-screen.tsx).
4. Preservation of the protected baseline invariant: [`components/waveform.tsx`](file:///c:/project/New%20folder/Marionette/components/waveform.tsx) has **strictly 0 diff** against commit `f6e31c7`.

**Why Conditional:**
Per audit mandate, `allowRemoteModels = false` cannot be equated with complete physical network isolation without live packet capture. The repository currently lacks an automated real-browser test capturing CDP `Network.requestWillBeSent` events during cache-miss and inference cycles in Chrome MV3. Furthermore, two secondary neural pipelines ([`lib/embeddings.ts`](file:///c:/project/New%20folder/Marionette/lib/embeddings.ts) and [`lib/audio/whisper-asr-service.ts`](file:///c:/project/New%20folder/Marionette/lib/audio/whisper-asr-service.ts)) do not yet set `env.allowRemoteModels = false`. The offline network gate is therefore classified as **NOT VERIFIED at the browser packet level**.

---

## 2. Git State & Invariant Verification

### 2.1 Branch & Baseline Shas
- **Current Branch:** `feature/phase-4-offline-resilience`
- **Current HEAD SHA:** `7b0220ec491daddedaa9d6629ecd1927585e6665`
- **Main Branch SHA:** `f6e31c78a9d652d69a002efb00726ec73a606122` (Identical to `origin/main`)
- **Parent Relationship:** Commit `7b0220e` is a direct child of `f6e31c7`.

### 2.2 Change Scope (`git diff --stat f6e31c7..HEAD`)
```text
 README.md                                         | 1292 ++++-----------------
 lib/errors.ts                                     |   28 +
 lib/generative-runtime.ts                         |  110 +-
 lib/workers/inference-worker.ts                   |   56 +-
 reports/PENTONE_PHASE_4_DISCOVERY_AND_PROPOSAL.md |  156 +++
 reports/PENTONE_PHASE_4_IMPLEMENTATION_REPORT.md  |   98 ++
 screens/chat-screen.tsx                           |   38 +-
 tests/phase4-offline-resilience.test.ts           |  194 ++++
 8 files changed, 873 insertions(+), 1099 deletions(-)
```

### 2.3 Waveform Invariant
- Command: `git diff f6e31c78a9d652d69a002efb00726ec73a606122..HEAD -- components/waveform.tsx`
- Output: **Empty (0 bytes diff)**. [`components/waveform.tsx`](file:///c:/project/New%20folder/Marionette/components/waveform.tsx) is completely untouched.

---

## 3. P4-01: Offline Enforcement Audit

### 3.1 Verification of `env.allowRemoteModels = false`
- **Inference Worker:** In [`lib/workers/inference-worker.ts`](file:///c:/project/New%20folder/Marionette/lib/workers/inference-worker.ts) lines 78–80:
  ```typescript
  env.allowLocalModels = false;
  env.allowRemoteModels = false;
  env.useBrowserCache = true;
  ```
  This is executed prior to calling `pipeline('text-generation', modelId, ...)`.
- **Generative Runtime:** In [`lib/generative-runtime.ts`](file:///c:/project/New%20folder/Marionette/lib/generative-runtime.ts) line 202:
  ```typescript
  env.allowLocalModels = false;
  env.allowRemoteModels = false;
  env.useBrowserCache = true;
  ```
- **WASM Asset Locality:** In both files, `env.backends.onnx.wasm.wasmPaths` resolves to `chrome.runtime.getURL('assets/')`. Build inspection confirms that `ort-wasm-simd.wasm` (10 MB), `ort-wasm.wasm` (9.2 MB), and `ort-wasm-threaded.wasm` (9.1 MB) are bundled locally in `build/chrome-mv3-prod/assets/`.

### 3.2 Cache Miss Detection & Typed Error Propagation
- In [`lib/workers/inference-worker.ts`](file:///c:/project/New%20folder/Marionette/lib/workers/inference-worker.ts) lines 110–127, model loading errors are caught. If the failure message contains `Could not locate file`, `trying to fetch the file`, `Failed to fetch`, `404`, or `not provisioned`, the worker emits:
  ```text
  ModelNotProvisionedError: Model assets are not provisioned in local cache. Please download the model in Settings.
  ```
- In [`lib/errors.ts`](file:///c:/project/New%20folder/Marionette/lib/errors.ts), [`ModelNotProvisionedError`](file:///c:/project/New%20folder/Marionette/lib/errors.ts#L31) is defined with code `'MODEL_NOT_PROVISIONED'`, `modelId`, and `missingAsset` properties.
- Type guard [`isModelNotProvisionedError`](file:///c:/project/New%20folder/Marionette/lib/errors.ts#L64) returns a boolean strictly checking `error.code`, `error.name`, or message patterns.

### 3.3 Deterministic Fallback Integrity
- If the Worker fails to initialize or encounters a cache miss, [`GenerativeRuntime.initializeLocalModel()`](file:///c:/project/New%20folder/Marionette/lib/generative-runtime.ts) marks state as `error` and returns `false`.
- Calls to [`detectLanguage`](file:///c:/project/New%20folder/Marionette/lib/generative-runtime.ts#L618), [`translateText`](file:///c:/project/New%20folder/Marionette/lib/generative-runtime.ts#L702), [`writeContent`](file:///c:/project/New%20folder/Marionette/lib/generative-runtime.ts#L805), and [`summarizePage`](file:///c:/project/New%20folder/Marionette/lib/generative-runtime.ts#L903) cleanly drop through to Tier 4 deterministic algorithms (`detectLanguageLocal`, `translateTextLocal`, `writeContentLocal`, `summarizePageLocal`).
- Provenance tagging strictly returns `provenance: 'deterministic'` and `modelId: 'pentone-*-fallback'`. No remote model fallback is attempted.

### 3.4 Critical Finding: Unprotected Secondary Neural Pipelines (High Severity)
While Phase 4 hardened the primary text-generation pipeline (`Qwen2.5-0.5B`), inspection revealed that other Transformers.js consumers in the codebase do **not** enforce `allowRemoteModels = false`:
1. **[`lib/embeddings.ts`](file:///c:/project/New%20folder/Marionette/lib/embeddings.ts#L24):** Only sets `env.allowLocalModels = false`. If a call to `generateEmbedding()` occurs when `Xenova/all-MiniLM-L6-v2` is not cached, Transformers.js will attempt remote fetch to Hugging Face CDN.
2. **[`lib/audio/whisper-asr-service.ts`](file:///c:/project/New%20folder/Marionette/lib/audio/whisper-asr-service.ts#L42):** Only sets `env.allowLocalModels = false`. If Whisper is not cached, it may attempt remote egress.

---

## 4. Offline Network Evidence & Limitations

### 4.1 Evaluation of Real-Browser Network Evidence
- **Status: NOT VERIFIED at packet level.**
- Inspection of `tests/` revealed no automated browser test capturing Chrome DevTools Protocol `Network.requestWillBeSent` or `Network.responseReceived` events during live Qwen2.5 initialization, missing asset lookup, or WASM loading.
- Existing verification scripts (e.g. `tests/real-qwen-inference-verification.ts`) simulated cache evaluation with mocked data rather than capturing live network packet logs during worker execution.
- While `env.allowRemoteModels = false` in Transformers.js sets the library's internal flag to reject remote URLs, browser extension service workers and Web Workers possess global `fetch()` capabilities that are not structurally restricted by a `connect-src 'none'` CSP in `manifest.json`.

---

## 5. P4-02: README & Architecture Accuracy Audit

Every architectural claim in [`README.md`](file:///c:/project/New%20folder/Marionette/README.md) was checked against the codebase:

| Claim in README | Codebase Implementation | Audit Assessment |
|---|---|---|
| **4-Tier Execution Hierarchy** | Implemented in [`lib/generative-runtime.ts`](file:///c:/project/New%20folder/Marionette/lib/generative-runtime.ts): Tier 1 Specialist APIs, Tier 2 Prompt API / Nano, Tier 3 Qwen Worker, Tier 4 Deterministic. | **ACCURATE** |
| **27 Registered Tools** | Exactly 27 tools registered in `TOOL_REGISTRY` in [`lib/tool-registry.ts`](file:///c:/project/New%20folder/Marionette/lib/tool-registry.ts). Table in README lists all 27 with names, scopes, and descriptions. | **ACCURATE** |
| **Immutable Revision** | Revision `22942cb7d7ba4cc81bb4673549ca4d4614469b5e` pinned in [`lib/model-provisioning.ts`](file:///c:/project/New%20folder/Marionette/lib/model-provisioning.ts) and [`lib/workers/inference-worker.ts`](file:///c:/project/New%20folder/Marionette/lib/workers/inference-worker.ts). | **ACCURATE** |
| **CacheStorage Provisioning** | Caches to `transformers-cache` with SHA-256 integrity validation in [`lib/model-provisioning.ts`](file:///c:/project/New%20folder/Marionette/lib/model-provisioning.ts). | **ACCURATE** |
| **Voice Capability Gate** | Two-tier gate in [`lib/audio/voice-authorization-manager.ts`](file:///c:/project/New%20folder/Marionette/lib/audio/voice-authorization-manager.ts): Tier A (Voice Turn Grant, 30s) and Tier B (Token, 10s TTL) consumed in [`lib/ui-tools.ts`](file:///c:/project/New%20folder/Marionette/lib/ui-tools.ts). | **ACCURATE** |
| **Dedicated Web Worker Isolation** | [`lib/workers/inference-worker.ts`](file:///c:/project/New%20folder/Marionette/lib/workers/inference-worker.ts) runs Transformers.js off the renderer main thread. | **ACCURATE** |
| **Chrome AI Early Preview Not Required** | Removed requirement; clearly documented as optional acceleration. | **ACCURATE** |
| **Unified Model Download Scope** | README states: *“one-time model provisioning during setup (~488 MB INT8 ONNX Qwen2.5-0.5B + 23 MB embeddings model + 39 MB Whisper ASR)”*. In reality, [`ModelProvisioningService`](file:///c:/project/New%20folder/Marionette/lib/model-provisioning.ts) only downloads Qwen2.5-0.5B. Embeddings and Whisper are downloaded lazily on first use. | **MINOR INACCURACY (Medium Finding)** |

---

## 6. P4-03: Worker Recovery Audit

### 6.1 Lifecycle & State Transitions
- **Max Retries:** `maxRecoveryAttempts = 3`.
- **Backoff Calculations:**
  - Attempt 1: $2^{1-1} \times 1000\text{ ms} = 1000\text{ ms}$ (1s)
  - Attempt 2: $2^{2-1} \times 1000\text{ ms} = 2000\text{ ms}$ (2s)
  - Attempt 3: $2^{3-1} \times 1000\text{ ms} = 4000\text{ ms}$ (4s)
- **Concurrency Guard:** `initializeLocalModel()` deduplicates concurrent callers via `this.activeInitPromise`.
- **`worker.onerror` Handling:**
  1. Rejects all entries in `pendingWorkerRequests` immediately with descriptive error.
  2. Clears `pendingWorkerRequests`.
  3. Invokes `teardownWorker()`, terminating the dead worker instance.
  4. Calls `scheduleWorkerRecovery(errorMsg)`, updating state to `error` with `recoveryAttempt: n`, then transitioning to `recovering` upon timer firing.
- **`worker.onmessageerror` Handling:** Settle pending requests with deserialization failure error. Worker thread remains intact.
- **Single-Settlement Rejection:** `sendWorkerRequest()` contains `let settled = false` and `resolveOnce`/`rejectOnce` guards, ensuring promises settle exactly once.
- **Cancellation & Unload:**
  - `cancelRecovery()` clears `this.recoveryTimer` and transitions status to `error`.
  - `unloadModel()` invokes `cancelRecoveryTimer()` and resets `this.recoveryAttempts = 0`.
- **Manual "Restart Engine":** `restartEngine()` in [`lib/generative-runtime.ts`](file:///c:/project/New%20folder/Marionette/lib/generative-runtime.ts) resets attempts, unloads any remaining state, and executes clean `initializeLocalModel()`.
- **UI Reflection:** [`screens/chat-screen.tsx`](file:///c:/project/New%20folder/Marionette/screens/chat-screen.tsx) displays an amber recovery banner when `status === 'recovering'` (with spinning `RefreshCw` icon and Cancel button) or `status === 'error'` (with "Restart Engine" button).

### 6.2 Protection Against Double-Execution of Tool Actions
- **Invariant Verified:** Inference generation is strictly separated from tool execution. A tool execution consumes the `VoiceAuthorizationToken` atomically in [`lib/ui-tools.ts`](file:///c:/project/New%20folder/Marionette/lib/ui-tools.ts) before handler dispatch.
- If a worker crash occurs during subsequent token generation or reasoning, the already-executed tool action is not replayed, and the consumed token cannot be reused (`TOKEN_ALREADY_CONSUMED`).

---

## 7. Voice Authorization Audit

Inspection of [`lib/audio/voice-authorization-manager.ts`](file:///c:/project/New%20folder/Marionette/lib/audio/voice-authorization-manager.ts) and [`lib/ui-tools.ts`](file:///c:/project/New%20folder/Marionette/lib/ui-tools.ts):

1. **Single-Use Semantics:** `validateAndConsume()` checks `this.consumedTokens.has(tokenId)`. If present, it returns `{ authorized: false, reason: 'TOKEN_ALREADY_CONSUMED' }`. Replay attempts fail closed.
2. **10-Second Expiry:** Checked against `candidateToken.expiresAt`. If `currentTime > candidateToken.expiresAt`, returns `TOKEN_EXPIRED`.
3. **Turn Grant 30s Deadline:** Level B tokens check `grant.absoluteDeadlineMs`. If exceeded, returns `DEADLINE_EXCEEDED`.
4. **Context Binding:** Validates `turnId`, `sessionId`, `userId`, and `targetToolName`.
5. **Confirmation Enforcement:** High-impact tools (`clickElement` on checkout, `openTab` on financial endpoints, `fillInput` with credentials) require `confirmationApproved: true`.
6. **No Token Reuse After Recovery:** Because tokens are consumed atomically prior to tool invocation, worker crashes and subsequent auto-recoveries do not restore consumed tokens or re-authorize pending actions.

---

## 8. Test Suite & Census Audit

### 8.1 Inspection of `tests/phase4-offline-resilience.test.ts`
1. `ModelNotProvisionedError type and type guard` (PASS): Verifies `code`, `name`, `modelId`, `missingAsset`, and `isModelNotProvisionedError` boolean guard. Tests production code directly.
2. `Strict offline invariant configuration in worker and generative runtime source` (PASS): Verifies source strings for `env.allowRemoteModels = false` in worker and runtime. (Static inspection).
3. `GenerativeRuntime worker crash rejects in-flight requests cleanly and schedules recovery` (PASS): Verifies mock worker crash settles in-flight generation to `null`, increments `recoveryAttempt`, tests `cancelRecovery()`, and tests `restartEngine()`.
4. `Maximum auto-recovery threshold transitions to persistent error state` (PASS): Simulates 3 failed attempts; verifies transition to persistent error.
5. `Strict safety invariant: crashed tool action is rejected and token cannot be reused` (PASS): Verifies single-use token consumption and replay rejection (`TOKEN_ALREADY_CONSUMED`).

### 8.2 Test Census Reconciliation
Earlier reports claimed "305 passed" (Phase 3.5) and "310 passed" (Phase 4). Independent audit of the test files revealed:
- Several test file names cited in earlier reports (`voice-authorization-boundary.test.ts`, `voice-noise-prewarm-hardening.test.ts`, `phase3-2-runtime-evidence.test.ts`, `writer-api-normalization.test.ts`, `chrome-version-compat.test.ts`, `first-run-setup-state.test.ts`) **do not exist on disk**; they were conflated or hallucinated in earlier documentation.
- The repository actually contains **57 test files** in `tests/`.
- **Actual Verified Test Counts on Disk:**
  - `npm test` (15 core integration files): **171 / 171 passed** (100%).
  - Active Phase 3, 3.5, and 4 standalone test suites (8 files):
    - `phase3-3-model-provisioning.test.ts`: 7 passed
    - `phase3-4-targeted-remediation.test.ts`: 7 passed
    - `phase3-5-production-hardening.test.ts`: 7 passed
    - `phase3-local-ai-features.test.ts`: 6 passed
    - `provenance-and-fallbacks.test.ts`: 6 passed
    - `suite-j-onboarding-and-download-lifecycle.test.ts`: 22 passed
    - `suite-k-ptt-lifecycle-and-writer-api.test.ts`: 17 passed
    - `phase4-offline-resilience.test.ts`: 5 passed
    - *Subtotal:* **77 / 77 passed** (100%).
  - Core Voice Security & Authorization suites (3 files):
    - `voice-tool-authorization-gate.test.ts`: 23 passed
    - `universal-voice-authorization-p0.test.ts`: 13 passed
    - `adversarial-prompt-injection.test.ts`: 6 passed
    - *Subtotal:* **42 / 42 passed** (100%).
- **Reconciled Total:** **290 verified passing automated tests** across these 26 active files (0 failures, 0 skipped).

---

## 9. Build Verification

- **Command:** `npm run build` (`plasmo build --target=chrome-mv3`)
- **Duration:** 6,126 ms
- **Output Directory:** `build/chrome-mv3-prod/`
- **Output Artifacts:**
  - `manifest.json` (MV3)
  - `sidepanel.html`, `sidepanel.b7741352.js`, `sidepanel.850787d0.css`
  - `content.06af5f40.js`
  - `inference-worker.e35c64d8.js` (isolated worker bundle)
  - `onnx.39a9f57f.js`
  - `assets/` containing local WASM binaries (`ort-wasm-simd.wasm`, `ort-wasm.wasm`, `ort-wasm-threaded.wasm`) and Silero VAD / CAM++ models.

---

## 10. Audit Findings Log

### High Severity
* **FINDING-01: Secondary Neural Pipelines Missing `allowRemoteModels = false`**  
  *Locations:* [`lib/embeddings.ts#L24`](file:///c:/project/New%20folder/Marionette/lib/embeddings.ts#L24), [`lib/audio/whisper-asr-service.ts#L42`](file:///c:/project/New%20folder/Marionette/lib/audio/whisper-asr-service.ts#L42)  
  *Detail:* While Phase 4 set `env.allowRemoteModels = false` in `inference-worker.ts` and `generative-runtime.ts`, `embeddings.ts` and `whisper-asr-service.ts` only configure `env.allowLocalModels = false`. If an embedding or Whisper asset is evicted or missing, Transformers.js defaults `allowRemoteModels` to `true` and may initiate an outbound CDN fetch.

### Medium Severity
* **FINDING-02: Absence of Automated Real-Browser Packet Capture Test**  
  *Locations:* `tests/`  
  *Detail:* The offline gate relies on static code inspection and unit tests with mocked workers. There is no automated Puppeteer/CDP test capturing `Network.requestWillBeSent` events during live Chrome execution to prove 0 egress on cache-miss and inference cycles.
* **FINDING-03: `README.md` Implies Unified Model Provisioning for All Models**  
  *Locations:* [`README.md`](file:///c:/project/New%20folder/Marionette/README.md)  
  *Detail:* The README mentions one-time model provisioning for Qwen + embeddings + Whisper. However, [`ModelProvisioningService`](file:///c:/project/New%20folder/Marionette/lib/model-provisioning.ts) only provisions the Qwen model files. Embeddings and Whisper download on-demand on first use.

### Low Severity
* **FINDING-04: Test Census Documentation Inconsistencies**  
  *Locations:* `reports/`  
  *Detail:* Prior reports cited non-existent test file paths (`voice-authorization-boundary.test.ts`, etc.) and claimed 305/310 tests. The reconciled active test census is 290 verified tests across real files.

---

## 11. Recommendations for Remediation (Post-Audit)

1. **Remediate FINDING-01:** Add `env.allowRemoteModels = false` to [`lib/embeddings.ts`](file:///c:/project/New%20folder/Marionette/lib/embeddings.ts) and [`lib/audio/whisper-asr-service.ts`](file:///c:/project/New%20folder/Marionette/lib/audio/whisper-asr-service.ts).
2. **Remediate FINDING-02:** Implement a CDP test capturing Chrome `Network.requestWillBeSent` events to prove zero egress in a live browser session.
3. **Remediate FINDING-03:** Clarify in `README.md` that Settings provisions the Qwen2.5-0.5B model, while embeddings and Whisper initialize on first access.
4. **Merge Decision:** Safe for fast-forward merge once the user approves the conditional findings, or proceed with immediate remediation of FINDING-01 and FINDING-03.
