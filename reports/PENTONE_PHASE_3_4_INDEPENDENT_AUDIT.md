# PENTONE PHASE 3.4 — INDEPENDENT VERIFICATION AUDIT

**Audit Date:** 2026-11-02  
**Target Branch:** `feature/local-ai-enablement`  
**Base Commit:** `a9eeedeb327e4b928d53dfd81bf34751a3ba9778`  
**Main Baseline SHA:** `f8930bbf809d640a16619667c6f6e2985fce640d`  
**Audit Mode:** Strictly Read-Only, Evidence-Based Verification  

---

## 1. Executive Verdict: CONDITIONAL PASS

The Phase 3.4 implementation successfully delivers user-controlled model provisioning, pinned immutable model resolution (`22942cb7d7ba4cc81bb4673549ca4d4614469b5e`), dual-key legacy cache migration with SHA-256 verification, Settings management controls, and sidepanel memory cleanup.

However, an evidence-based audit reveals **architectural limitations and plumbing defects** that must be resolved prior to release:

1. **CRITICAL — Main-Thread Inference & Audio Execution Collisions:**  
   ONNX Runtime Web is configured with `env.backends.onnx.wasm.proxy = false` and `numThreads = 1`. Inference executes synchronously/in-task on the renderer's main JavaScript thread. Because `PersistentAudioPipeline` uses `ScriptProcessorNode.onaudioprocess` (which dispatches events to the main thread) and PTT keydown/keyup listeners execute on the main thread, sustained WASM token generation blocks event processing, delaying PTT release and risking audio buffer dropouts.
2. **HIGH — Disconnected Provenance Badging Plumbing:**  
   `Message.provenance` was defined in `lib/messages.ts` and UI badges were implemented in `screens/chat-screen.tsx`, but `lib/chat-context.tsx` and `lib/ui-tools.ts` do not pass provenance when creating messages. Consequently, `msg.provenance` is `undefined` at runtime and badges are never displayed.
3. **HIGH — Unserialized In-Flight Memory Disposal:**  
   `generativeRuntime.unloadModel()` immediately destroys the ONNX session without awaiting `this.queue`, causing unhandled exceptions if memory is unloaded while inference is running.
4. **HIGH — Latent Scope & Parameter Regressions:**  
   - `lib/ui-tools.ts:268`: References undeclared `scope.LanguageModel`, causing `summarizePage` to throw `ReferenceError: scope is not defined` in `browser-tools-integration.test.ts`.
   - `lib/generative-runtime.ts:423`: `scope.Writer.create({ tone, length, format })` omits `outputLanguage`, failing Test 14 in `suite-k-ptt-lifecycle-and-writer-api.test.ts`.

---

## 2. Git State & Protected-File Verification

- **Active Branch:** `feature/local-ai-enablement` (Verified via `git rev-parse --abbrev-ref HEAD`)
- **HEAD Commit:** `a9eeedeb327e4b928d53dfd81bf34751a3ba9778` (Verified via `git rev-parse HEAD`)
- **Main SHA:** `f8930bbf809d640a16619667c6f6e2985fce640d`
- **Protected File Invariance:**
  ```powershell
  git diff main -- components/waveform.tsx
  # Output: strictly empty (0 diff)
  ```
- **Frozen Branch Preservation:** `feature/browser-tools-reliability` untouched.
- **Working Tree State:** Exactly 22 modified files preserved from previous phases, zero unstaged deletions, zero unauthorized commits or branch operations.

---

## 3. Findings Matrix

| ID | Severity | Category | Description | File & Line References | Status |
|---|---|---|---|---|---|
| **F-01** | **CRITICAL** | Audio / Inference Isolation | ONNX inference executes on the renderer main thread (`proxy: false`); delays PTT DOM events and `onaudioprocess`. | [`lib/generative-runtime.ts#L123`](file:///c:/project/New%20folder/Marionette/lib/generative-runtime.ts#L123), [`lib/audio/persistent-audio-pipeline.ts#L180-L192`](file:///c:/project/New%20folder/Marionette/lib/audio/persistent-audio-pipeline.ts#L180-L192) | Confirmed by Code & Architecture |
| **F-02** | **HIGH** | Provenance UX | `msg.provenance` is never populated by `chat-context.tsx`, causing provenance badges to never render in Chat UI. | [`lib/messages.ts#L12`](file:///c:/project/New%20folder/Marionette/lib/messages.ts#L12), [`screens/chat-screen.tsx#L201-L215`](file:///c:/project/New%20folder/Marionette/screens/chat-screen.tsx#L201-L215), [`lib/chat-context.tsx#L1437`](file:///c:/project/New%20folder/Marionette/lib/chat-context.tsx#L1437) | Confirmed by Code Trace |
| **F-03** | **HIGH** | Concurrency Safety | `unloadModel()` does not await `this.queue`, destroying sessions out from under running inferences. | [`lib/generative-runtime.ts#L175-L195`](file:///c:/project/New%20folder/Marionette/lib/generative-runtime.ts#L175-L195) | Confirmed by Code Trace |
| **F-04** | **HIGH** | Regression Defect | Undeclared `scope` variable in `lib/ui-tools.ts` causes `ReferenceError: scope is not defined` during page summarization. | [`lib/ui-tools.ts#L268`](file:///c:/project/New%20folder/Marionette/lib/ui-tools.ts#L268), [`tests/browser-tools-integration.test.ts#L952`](file:///c:/project/New%20folder/Marionette/tests/browser-tools-integration.test.ts#L952) | Verified by Unit Test Failure |
| **F-05** | **HIGH** | Regression Defect | `writeContent` fails to pass `outputLanguage` to `scope.Writer.create()`, breaking multilingual writer contract. | [`lib/generative-runtime.ts#L423`](file:///c:/project/New%20folder/Marionette/lib/generative-runtime.ts#L423), [`tests/suite-k-ptt-lifecycle-and-writer-api.test.ts#L429`](file:///c:/project/New%20folder/Marionette/tests/suite-k-ptt-lifecycle-and-writer-api.test.ts#L429) | Verified by Unit Test Failure |
| **F-06** | **MEDIUM** | Cache Hygiene | Dual-key migration copies verified assets from `main` to commit SHA key but does not delete legacy keys until `deleteModel()`. | [`lib/model-provisioning.ts#L236-L244`](file:///c:/project/New%20folder/Marionette/lib/model-provisioning.ts#L236-L244) | Verified by Code Inspection |
| **F-07** | **VERIFIED** | Model Pinning | Canonical URLs strictly use commit SHA `22942cb7d7ba4cc81bb4673549ca4d4614469b5e`. Never fetches `main` from network. | [`lib/model-provisioning.ts#L47-L50`](file:///c:/project/New%20folder/Marionette/lib/model-provisioning.ts#L47-L50), [`lib/generative-runtime.ts#L144`](file:///c:/project/New%20folder/Marionette/lib/generative-runtime.ts#L144) | Verified by Tests & Network Contracts |
| **F-08** | **VERIFIED** | SHA-256 Verification | Checksums are pre-declared constants; structural JSON and byte checks prevent caching corrupt or incomplete blobs. | [`lib/model-provisioning.ts#L63-L88`](file:///c:/project/New%20folder/Marionette/lib/model-provisioning.ts#L63-L88) | Verified by 7 Passing Tests |
| **F-09** | **VERIFIED** | Settings UI & Controls | Download, progress bar, cancel, unload, delete, and refresh controls render and synchronize across tabs. | [`screens/settings-screen.tsx#L420-L540`](file:///c:/project/New%20folder/Marionette/screens/settings-screen.tsx#L420-L540) | Verified by Build & Code Trace |
| **F-10** | **VERIFIED** | Memory Cleanup | Sidepanel `beforeunload` disposes of JavaScript pipeline references on close. | [`sidepanel.tsx#L44-L52`](file:///c:/project/New%20folder/Marionette/sidepanel.tsx#L44-L52) | Verified by Code Trace |

---

## 4. Deep-Dive Audit Investigations

### 4.1 Critical Audit: Inference and Audio Isolation (F-01)

#### 1. Execution Context of ONNX Runtime
- In [`lib/generative-runtime.ts#L122-L123`](file:///c:/project/New%20folder/Marionette/lib/generative-runtime.ts#L122-L123):
  ```typescript
  env.backends.onnx.wasm.numThreads = 1
  env.backends.onnx.wasm.proxy = false
  ```
- **Finding:** Setting `proxy: false` disables ONNX Runtime Web's background worker proxying.
- No Web Worker is spawned anywhere in `lib/generative-runtime.ts` or `lib/ui-tools.ts`.
- Inference executes **directly on the browser renderer main thread**.

#### 2. Does `enqueue()` Move Computation Off-Thread?
- In [`lib/generative-runtime.ts#L200-L204`](file:///c:/project/New%20folder/Marionette/lib/generative-runtime.ts#L200-L204):
  ```typescript
  private async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => {})
    return run
  }
  ```
- **Finding:** `enqueue()` is merely a Promise serialization chain on the JavaScript microtask queue. It **does NOT** offload work to a background thread or Worker.

#### 3. Main-Thread PTT & Audio Event Path
- `handleKeyDown` and `handleKeyUp` are registered on `window` in [`screens/main-screen.tsx#L254-L255`](file:///c:/project/New%20folder/Marionette/screens/main-screen.tsx#L254-L255).
- Every state transition in [`lib/audio/ptt-state-machine.ts`](file:///c:/project/New%20folder/Marionette/lib/audio/ptt-state-machine.ts) (`PRESS_PENDING`, `RECORDING`, `FINALIZING`) executes synchronously inside main-thread DOM handlers.
- **Audio Capture Mechanism:** [`lib/audio/persistent-audio-pipeline.ts#L180-L192`](file:///c:/project/New%20folder/Marionette/lib/audio/persistent-audio-pipeline.ts#L180-L192) uses `createScriptProcessor(4096, 1, 1)` with `onaudioprocess`.
- While Web Audio's internal audio hardware rendering executes on an OS-level audio thread, `ScriptProcessorNode.onaudioprocess` dispatches an `AudioProcessingEvent` **to the main JavaScript thread**.
- **Impact:** When ONNX WASM executes heavy matrix multiplications on the main thread:
  1. `onaudioprocess` callbacks are delayed, causing buffer underruns or lost audio samples.
  2. Spacebar keyup events are delayed, causing the PTT state machine to record past the moment the user released the key.
  3. UI waveform rendering via `requestAnimationFrame` freezes during sustained generation.

---

### 4.2 Immutable Model Revision and Cache Integrity (F-07, F-08)

#### 1. Commit SHA Enforcement
- `QWEN_MODEL_REVISION = '22942cb7d7ba4cc81bb4673549ca4d4614469b5e'` is pinned as a constant in `lib/model-provisioning.ts`.
- `downloadModel()` constructs download URLs using `this.getFileUrl(file, QWEN_MODEL_REVISION)`.
- It **never** fetches from `/resolve/main/` over the network.
- `generativeRuntime.initializeLocalModel()` passes `revision: '22942cb7d7ba4cc81bb4673549ca4d4614469b5e'` to `pipeline()`.

#### 2. Cryptographic Hashes Authenticity
- Hashes in `EXPECTED_ASSET_METADATA` are hardcoded, pre-computed constants matching the official commit assets:
  - `config.json`: `777e01f0fbb3346eb229cb6fb278ed6533c1e4dcb9ebf4bed0f6e94ef17fa1b5` (678 bytes)
  - `generation_config.json`: `f7e7ce458658b2d40d9eb213b91b77a8bf698845ab89360976722d7ac46928a3` (242 bytes)
  - `tokenizer.json`: `a8506e7111b80c6d8635951a02eab0f4e1a8e4e5772da83846579e97b16f61bf` (7,031,673 bytes)
  - `tokenizer_config.json`: `6a14243f0ae04884e597b3f032c05e15de9f417318fdcac24ab4e2680e691430` (7,849 bytes)
  - `special_tokens_map.json`: `76862e765266b85aa9459767e33cbaf13970f327a0e88d1c65846c2ddd3a1ecd` (613 bytes)
  - `onnx/model_quantized.onnx`: `41834041ab1b29eff9fc592f1a29a1844133aea35832ea9fa91682be13016100` (512,096,557 bytes)
- `verifyAssetBlob()` digests the actual response ArrayBuffer using `crypto.subtle.digest('SHA-256')` and compares it to the expected constant. It does NOT compute a self-referential hash.

#### 3. Legacy Migration Safety
- If a legacy `/resolve/main/` key is found in cache, `verifyAssetBlob()` runs on the legacy asset first.
- Only if SHA-256 matches is `cache.put(canonicalUrl, legacyRes.clone())` performed.
- If any asset fails verification, `checkModelCached()` returns `false` and `downloadModel()` throws `Model verification failed`. Partially migrated caches are never treated as ready.

---

### 4.3 Memory Lifecycle & Session Disposal (F-03)

1. **ONNX Runtime Web Version:** `@xenova/transformers@2.17.2` bundles `onnxruntime-web@1.14.0`.
2. **Session Disposal:** `Pipeline.prototype.dispose()` calls `this.model.dispose()`, which invokes `item.handler.dispose()` on each `InferenceSession`.
3. **WASM Memory Reclamation Reality:**
   - Calling `unloadModel()` invokes `pipeline.dispose()` and clears `this.pipelineInstance = null`.
   - In Chromium V8, `WebAssembly.Memory` linear pages **are not released back to the operating system** while the JavaScript context is alive.
   - Physical OS memory is only reclaimed when the sidepanel window is closed.
4. **Race Condition on Unload:**
   - `unloadModel()` does not check if `this.queue` has pending or in-flight promises.
   - Triggering "Unload from Memory" while `writeContent` or `translateText` is in progress immediately nullifies `pipelineInstance` and destroys ONNX sessions mid-inference.

---

### 4.4 Provenance Badging Plumbing Disconnect (F-02)

1. In [`lib/messages.ts#L12`](file:///c:/project/New%20folder/Marionette/lib/messages.ts#L12):
   `provenance?: 'native' | 'generative' | 'deterministic'` added to `Message`.
2. In [`screens/chat-screen.tsx#L201-L215`](file:///c:/project/New%20folder/Marionette/screens/chat-screen.tsx#L201-L215):
   Badge rendering inspects `msg.provenance`:
   - `msg.provenance === 'generative'` -> `Local Model · Qwen2.5`
   - `msg.provenance === 'native'` -> `Chrome AI · Gemini Nano`
   - `msg.provenance === 'deterministic'` -> `Offline Fallback`
3. **The Disconnect:**
   - In [`lib/chat-context.tsx#L1437`](file:///c:/project/New%20folder/Marionette/lib/chat-context.tsx#L1437) and line 1500+, `createAssistantMessage()` is called as:
     `createAssistantMessage(followupContent, 0)`
   - No `provenance` argument is passed.
   - In `lib/ui-tools.ts`, `executeUITool` returns `{ success: true, result: result }`, discarding the `res.tier` returned by `generativeRuntime`.
   - **Result:** `msg.provenance` is permanently `undefined` on all generated messages. The UI badges never display during live chat interaction.

---

## 5. Verification Commands & Actual Test Outputs

### 5.1 Unit Tests (`npm test`)
```powershell
npm test
# Result: 171 passed, 0 failed (duration: 850.7ms)
```
Covers voice lifecycle, barge-in, PTT state transitions, summarizer thresholds, and tool parsing.

### 5.2 Phase 3.3 & 3.4 Specific Suites
```powershell
npx tsx --test tests/phase3-3-model-provisioning.test.ts tests/provenance-and-fallbacks.test.ts
# Result: 13 passed, 0 failed (duration: 239.5ms)
```
Verified pinned revision URLs, corrupt payload rejection, and fallback provenance tags in `GenerativeRuntime`.

### 5.3 Full Regression Suite Discovery: Failures in Non-Default Test Files
When testing suites not included in the default `npm test` script:

#### Suite K Failure (`tests/suite-k-ptt-lifecycle-and-writer-api.test.ts`)
```powershell
npx tsx --test tests/suite-a-ptt-state-machine.test.ts tests/suite-k-ptt-lifecycle-and-writer-api.test.ts
# Result: 29 passed, 2 failed
```
- **Failing Test:** `14. Writer API creation always includes a supported outputLanguage`
- **Output:**
  ```
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  undefined !== 'de'
  at tests/suite-k-ptt-lifecycle-and-writer-api.test.ts:429:14
  ```
- **Root Cause:** [`lib/generative-runtime.ts#L423`](file:///c:/project/New%20folder/Marionette/lib/generative-runtime.ts#L423) calls `scope.Writer.create({ tone, length, format })` omitting `outputLanguage`.

#### Browser Integration Test Failure (`tests/browser-tools-integration.test.ts`)
```powershell
npx tsx --test tests/browser-tools-integration.test.ts
# Result: 60 passed, 2 failed
```
- **Failing Test:** `Workflow D: "Summarize the current page."`
- **Output:**
  ```
  Page summarization error: ReferenceError: scope is not defined
  at summarizePage (lib/ui-tools.ts:268:42)
  ```
- **Root Cause:** [`lib/ui-tools.ts#L268`](file:///c:/project/New%20folder/Marionette/lib/ui-tools.ts#L268) references `scope.LanguageModel` before `scope` is initialized.

### 5.4 Production Build Verification
```powershell
npm run build
# Output:
# 🟣 Plasmo v0.90.5
# 🟢 DONE | Finished in 6422ms!
```
TypeScript bundling and asset generation in `build/chrome-mv3-prod/` succeed with 0 compiler errors.

---

## 6. Recommended Remediations (Non-Destructive)

*Note: Per strict read-only audit instructions, no files were modified to apply these fixes.*

1. **Move ONNX WASM Inference to a Dedicated Web Worker:**  
   Configure Transformers.js with `env.backends.onnx.wasm.proxy = true` or encapsulate `GenerativeRuntime` inside a dedicated `Worker`. This isolates CPU-heavy matrix multiplications from the renderer thread, preventing PTT event and `onaudioprocess` latency.
2. **Upgrade `PersistentAudioPipeline` to `AudioWorkletNode`:**  
   Replace legacy `createScriptProcessor` with an `AudioWorkletNode` for audio capture. This moves PCM chunk gathering to the audio rendering thread.
3. **Plumb Provenance from Tool Result to Chat Messages:**  
   In `lib/ui-tools.ts`, return `{ text: res.text, provenance: res.tier }`. In `lib/chat-context.tsx`, pass `toolResult.provenance` into `createAssistantMessage(content, count, false, toolResult.provenance)`.
4. **Serialize `unloadModel()` on `this.queue`:**  
   Update `unloadModel()` to `return this.enqueue(async () => { ... dispose ... })` so it gracefully waits for active inference to finish before tearing down sessions.
5. **Fix Undeclared `scope` in `lib/ui-tools.ts:268`:**  
   Initialize `const scope: any = typeof self !== 'undefined' ? self : ...` before the backwards-compatibility check.
6. **Pass `outputLanguage` to `Writer.create` in `lib/generative-runtime.ts:423`:**  
   Update call to `scope.Writer.create({ tone, length, format, outputLanguage })`.

---

## 7. Final Acceptance Checklist

- [x] Branch confirmed: `feature/local-ai-enablement`
- [x] Base commit confirmed: `a9eeedeb327e4b928d53dfd81bf34751a3ba9778`
- [x] `components/waveform.tsx` strictly 0 diff against `main`
- [x] Zero unauthorized commits, pushes, merges, rebases, or stashes
- [x] Immutable commit SHA `22942cb7d7ba4cc81bb4673549ca4d4614469b5e` strictly pinned
- [x] Pre-declared SHA-256 asset verification verified
- [x] Settings Screen model card operational
- [x] Sidepanel `beforeunload` cleanup registered
- [ ] **BLOCKING:** Main-thread ONNX WASM execution isolated from audio/PTT (Worker required)
- [ ] **BLOCKING:** Provenance badging plumbed from tool results into Chat message state
- [ ] **BLOCKING:** `lib/ui-tools.ts:268` undeclared `scope` ReferenceError resolved
- [ ] **BLOCKING:** `lib/generative-runtime.ts:423` `outputLanguage` parameter restored
- [ ] **BLOCKING:** In-flight inference protected during `unloadModel()`
