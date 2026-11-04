# Pentone Phase 3.4 — Risk Register & Mitigation Strategy

**Register Date:** November 2, 2026  
**Auditor:** Independent Antigravity Architecture Review  
**Focus:** Architectural, Runtime, Memory, and Regression Risks for Phase 3.4  
**Status:** **ACTIVE REFERENCE**

---

## 1. Executive Summary

Productizing local AI in a browser extension introduces concurrent resource contention between CPU-heavy WASM execution, WebAudio microphone capture, and Manifest V3 message passing. This register identifies eight critical risks and defines enforceable technical controls to guarantee zero regression.

---

## 2. Risk Matrix & Mitigation Actions

| Risk ID | Risk Category | Description | Severity | Probability | Detection Strategy | Mitigation Action |
|---|---|---|---|---|---|---|
| **R-01** | **Memory / Heap** | WASM heap allocation (~512 MB) causes tab / sidepanel crash on low-RAM machines. | **HIGH** | Medium | Chrome task manager memory monitoring (`performance.memory`). | Pre-check `navigator.storage.estimate()`; sequential queue prevents concurrent heaps; provide explicit "Unload from Memory" button. |
| **R-02** | **Audio / Voice** | Heavy CPU inference during token generation causes audio buffer dropouts in Whisper ASR or PTT. | **HIGH** | Low | Audio energy & dropout tests (`agent-reliability-audio.test.ts`). | WASM execution restricted to `numThreads = 1`; audio capture executes in dedicated `AudioWorklet` with highest audio thread priority. |
| **R-03** | **Cache Invalidation** | Pinning model revision to commit SHA `22942cb...` breaks existing cached assets stored under `/resolve/main/`. | **HIGH** | High | Cache key unit tests (`phase3-3-model-provisioning.test.ts`). | Implement dual-key lookup in `checkModelCached()`: auto-alias existing `/resolve/main/` assets to commit SHA keys without re-downloading. |
| **R-04** | **UI Responsiveness** | Synchronous JavaScript blocks sidepanel UI during 3.8s cold load or 2.9s generation. | **MEDIUM** | Low | User click latency inspection during generation. | All model initialization and token emission routed through asynchronous Promise queue (`this.enqueue`); state updates decoupled via pub-sub. |
| **R-05** | **Browser Tool Drift** | Tool dispatch changes destabilize the 27 registered browser navigation tools. | **CRITICAL** | Very Low | Main regression suite (`tests/browser-tools-integration.test.ts`). | Tool signatures and `executeUITool` contracts remain completely frozen; AI tools operate strictly as standard tool registry handlers. |
| **R-06** | **WebGPU Device Loss** | Faulty or overloaded GPU drivers trigger `device.lost` context failure in WebGPU. | **MEDIUM** | Medium | Catch block around `pipeline({ device: 'webgpu' })`. | Automated try-catch immediately degrades to `wasm` backend without terminating the active user turn. |
| **R-07** | **Hardware Variance** | Slower dual-core or mobile machines experience 10–15s generation latencies. | **MEDIUM** | High | Multi-hardware benchmarking suite. | Prominently display live generation progress and token throughput; never hardcode unrealistic sub-second timeouts. |
| **R-08** | **Waveform Invariance** | Accidental edits to `components/waveform.tsx` violate frozen Phase 2 baseline. | **CRITICAL** | Low | Automated pre-check `git diff main -- components/waveform.tsx`. | Continuous change-control gating; waveform file excluded from all Phase 3.4 touchlists. |

---

## 3. High-Priority Mitigation Protocols

### Protocol 1: Zero-Regression Audio Protection
- Audio capture ([`lib/use-voice-input.ts`](file:///c:/project/New%20folder/Marionette/lib/use-voice-input.ts)) and Whisper ASR must never share thread resources with Qwen inference.
- The `barge-in-cancellation` and `local-whisper-asr` test suites (171 tests) must be run continuously to verify that microphone buffer processing remains jitter-free during model loading.

### Protocol 2: Non-Destructive Model Pinning
- When switching `QWEN_MODEL_REVISION` from `'main'` to `'22942cb7d7ba4cc81bb4673549ca4d4614469b5e'`:
  ```typescript
  // Dual-lookup logic ensures backwards-compatible cache hit
  const shaUrl = this.getFileUrl(file);
  let match = await cache.match(shaUrl);
  if (!match) {
    const legacyUrl = shaUrl.replace(QWEN_MODEL_REVISION, 'main');
    match = await cache.match(legacyUrl);
    if (match) {
      await cache.put(shaUrl, match.clone()); // Migrate key atomically
    }
  }
  ```
- This prevents users who already downloaded 495 MB in Phase 3.3 from experiencing forced re-downloads.

### Protocol 3: Memory Compaction & Tab Disposal
- Since `WebAssembly.Memory` cannot be forced to return pages to the OS by user JavaScript alone, the UI must inform users that closing the sidepanel completely resets memory allocation.
