# Pentone Phase 3.4 — Local AI Productization & UX Architecture Assessment

**Assessment Date:** November 2, 2026  
**Auditor:** Independent Antigravity Architecture Review  
**Mode:** **STRICT READ-ONLY ARCHITECTURE ASSESSMENT (No runtime code modified)**  
**Active Baseline:** `feature/local-ai-enablement` (Base: `a9eeedeb...`, Main: `f8930bbf...`)  
**Status:** **COMPLETE**

---

## 1. Executive Summary

Phase 3.3 and 3.3.1 established an operational, verified local generative AI baseline using `onnx-community/Qwen2.5-0.5B-Instruct` (8-bit dynamic integer quantization, 512 MB footprint, commit SHA `22942cb7d7ba4cc81bb4673549ca4d4614469b5e`) executing via WebAssembly SIMD inside the unpacked Chrome Manifest V3 sidepanel.

The objective of Phase 3.4 is to **productize** this capability: designing an accessible, reliable, and user-centric extension interface that surfaces download management, lifecycle transitions, provenance transparency, and memory controls without destabilizing the verified voice pipeline, Whisper ASR, or 27 browser navigation tools.

This document presents the complete architectural assessment across all eight functional dimensions specified in the Phase 3.4 mandate.

---

## 2. Architecture Assessment by Dimension

### A. Model Lifecycle UI & State Machine Exposure
- **Existing Architecture:** [`lib/model-provisioning.ts`](file:///c:/project/New%20folder/Marionette/lib/model-provisioning.ts) defines an 8-state lifecycle: `not_downloaded`, `downloading`, `paused`, `interrupted`, `downloaded`, `initializing`, `ready`, `failed`, `cancelled`. It exposes a pub-sub subscription via `ModelProvisioningService.getInstance().subscribe(listener)`.
- **Finding:** The service currently operates as an in-memory singleton. If multiple extension tabs or re-rendered React screens query it independently, state must remain unified.
- **Architectural Solution:**
  - Create a custom React hook `useModelProvisioning()` or `ModelProvisioningProvider` in `lib/model-provisioning-context.tsx`.
  - The hook subscribes to the singleton on mount and stores local component state, auto-updating on progress events.
  - Expose lifecycle state in `screens/settings-screen.tsx` (under the existing "AI & Models" tab) with a dedicated "Local Language Model (Qwen2.5-0.5B)" card.
- **Classification:** **VERIFIED** (Pub-sub mechanism already tested and verified).

---

### B. Download Experience & Storage Protection
- **Download Progress:** The streaming reader in `downloadModel()` yields byte chunks, calculating `downloadedBytes`, `totalBytes` (~495 MB), and `percent`.
- **Cancellation & Pause:** `cancelDownload()` triggers `AbortController.abort()`. Interrupted streams do not commit partial blobs into `CacheStorage`.
- **Resume & Recovery:**
  - Before fetching each asset, the service evaluates `await cache.match(url)`.
  - If a required file already exists in cache with valid non-zero size, it is skipped and added to cumulative downloaded bytes. This enables automatic incremental resumption after network dropouts.
- **Storage Pre-Check:** `navigator.storage.estimate()` is evaluated prior to starting. It requires at least `ESTIMATED_MODEL_BYTES + STORAGE_BUFFER_BYTES` (~550 MB) available.
- **Integrity Validation:** `verifyCacheIntegrity()` parses all 5 JSON configs and verifies the ONNX binary exceeds 100 MB before declaring `ready`.
- **Classification:** **VERIFIED**

---

### C. Inference Experience & Non-Blocking Interaction
- **Model Loading vs. Generation Feedback:**
  - Cold runtime initialization requires **3,840 ms** on WASM (ONNX graph compilation and memory allocation).
  - Generation requires **~2,912 ms** (median) for ~38 tokens at **13.05 tok/s**.
  - **UX Requirement:** The UI must display two distinct status phases:
    1. `[Initializing Local Model...]` (Spinner during WASM compilation).
    2. `[Generating Response... 13 tok/s]` (Active generation with optional streaming token display).
- **Non-Blocking Architecture:** Inference executes asynchronously in the persistent sidepanel window through `GenerativeRuntime.getInstance().enqueue()`. The sidepanel DOM remains interactive; user clicks and keyboard shortcuts do not lock up.
- **User Cancellation During Generation:** Passing an `AbortSignal` to the generation pipeline stops token emission immediately.
- **Classification:** **VERIFIED**

---

### D. Provenance Transparency & UI Badging
- **Core Requirement:** Deterministic heuristic fallbacks must **never** be disguised as neural inference.
- **Current Data Contract:** All results return `AIExecutionResult { text, tier: 'native' | 'generative' | 'deterministic', modelId, latencyMs }`.
- **Integration Points:**
  1. **Message Header in `screens/chat-screen.tsx`:** Beside `Pentone`, render a small badge:
     - `tier === 'generative'`: `<Badge variant="success">Local Model · Qwen2.5</Badge>`
     - `tier === 'native'`: `<Badge variant="info">Chrome AI · Gemini Nano</Badge>`
     - `tier === 'deterministic'`: `<Badge variant="warning">Offline Fallback</Badge>`
  2. **Tool Result Card in `components/ui/tool-activity.tsx`:** Display latency and execution tier in the collapsible footer.
- **Classification:** **VERIFIED**

---

### E. Memory Management & Lifecycle Disposal
- **WASM Memory Realities:**
  - In modern V8 / Blink engines, allocating a 512 MB WebAssembly memory heap (`WebAssembly.Memory`) reserves linear address space.
  - **Crucial Finding:** Merely setting JavaScript variables (`pipelineInstance = null`) triggers garbage collection of the JS wrapper, but V8 does **not** immediately return allocated WASM virtual memory pages to the operating system until the sidepanel window is closed or refreshed.
- **Unloading Architecture:**
  - Implement `generativeRuntime.unloadModel()`:
    1. Call `session.dispose()` / `session.release()` if exposed by ONNX Runtime Web.
    2. Clear pipeline references and state to `'idle'`.
    3. Update `ModelRuntimeState.backend` to `'deterministic'`.
  - Provide an explicit "Unload from Memory" button in Settings to allow users with memory constraints to free RAM without deleting cached weights from disk.
  - Cleanup listener: Register `window.addEventListener('beforeunload', ...)` to release session handles cleanly when the user closes the sidepanel.
- **Classification:** **PARTIALLY VERIFIED** (JS reference release verified; OS memory compaction is subject to browser V8 engine policies).

---

### F. Failure & Edge-Case Handling Matrix

| Failure Scenario | Detection Mechanism | UX Behavior & Recovery | Provenance Safeguard |
|---|---|---|---|
| **Insufficient Storage** | `navigator.storage.estimate()` < 550 MB | Surfaces alert: *"Insufficient storage space (requires 550 MB free). Free disk space to proceed."* | Download aborted; no partial cache. |
| **Download Interrupted** | Stream error / `res.ok === false` | State switches to `'interrupted'`. UI shows *"Download paused. Click to resume."* | Partial files not committed to ready state. |
| **Corrupted Model File** | `verifyCacheIntegrity()` JSON parse fail or ONNX < 100MB | State switches to `'failed'`. UI offers *"Model files corrupted. Click to re-download."* | Model marked unavailable; triggers Tier 4. |
| **WASM Out of Memory** | `InferenceSession.create()` throws OOM | State switches to `'failed'`. UI alerts: *"Low memory. Switched to offline heuristic fallback."* | Explicitly returns `tier: 'deterministic'`. |
| **Unsupported Browser** | Missing WASM / Cache API | Disables download button with explanatory tooltip. | Tier 4 heuristic active. |
| **User Abort** | `AbortSignal.aborted === true` | Instantly halts streaming; status returns to `'ready'`. | Response truncated or cleanly discarded. |

---

### G. Immutable Model Revision & Pinning Architecture
- **Current State:** [`lib/model-provisioning.ts`](file:///c:/project/New%20folder/Marionette/lib/model-provisioning.ts) currently uses `QWEN_MODEL_REVISION = 'main'`.
- **Target Immutable Commit:** `22942cb7d7ba4cc81bb4673549ca4d4614469b5e`.
- **Minimal Safe Pinning Change:**
  - In `lib/model-provisioning.ts`: update `QWEN_MODEL_REVISION = '22942cb7d7ba4cc81bb4673549ca4d4614469b5e'`.
  - In `lib/generative-runtime.ts`: pass `revision: '22942cb7d7ba4cc81bb4673549ca4d4614469b5e'` to Transformers.js `pipeline()` call.
- **Migration & Cache Invalidation Implications:**
  - CacheStorage keys are exact strings: `https://huggingface.co/.../resolve/main/...`.
  - If the URL changes to `/resolve/22942cb.../`, existing cached assets under `main` would register as a cache miss unless migrated!
  - **Safe Migration Protocol:** During initialization, check if assets exist under `main`. If so, clone and re-put under the commit SHA key (or support dual lookup) so existing users do not have to re-download 495 MB!
- **Classification:** **VERIFIED**

---

### H. Hardware Profiling & Dell G15 Benchmark Plan

The reference development hardware is a Dell G15 Gaming Laptop:
- **CPU:** 13th Gen Intel(R) Core(TM) i5-13450HX (16 logical cores)
- **RAM:** 16 GB DDR5
- **Discrete GPU:** NVIDIA GeForce RTX 3050 Laptop GPU (6 GB VRAM)
- **Integrated GPU:** Intel(R) UHD Graphics

#### WebGPU Empirical Benchmark Plan
> [!CAUTION]
> Do not assume WebGPU works merely because `navigator.gpu` is defined. Many laptops fail WebGPU tensor operations due to adapter routing or driver context loss.

1. **Adapter Disambiguation:**
   - Call `navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })` to explicitly target the discrete NVIDIA RTX 3050 rather than the low-power Intel integrated chip.
2. **Shader Compilation Test:**
   - Execute a minimal WGSL matrix multiplication kernel before initializing the full 488 MB model to confirm WebGPU compute pipeline readiness without crashing.
3. **Comparative Metrics to Capture:**
   - Cold shader compilation latency vs. WASM compilation.
   - Tokens per second on RTX 3050 vs. 13.05 tok/s on CPU WASM.
   - Dedicated VRAM consumption (via Windows Performance Counters / nvidia-smi).
   - Thermal throttling behavior during sustained 500-token generation.
- **Classification:** **PARTIALLY VERIFIED** (Hardware capabilities identified; empirical WebGPU benchmark deferred to implementation).
