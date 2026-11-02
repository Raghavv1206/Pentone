# Pentone Phase 4 — Discovery, Architectural Assessment & Roadmap Proposal

**Project:** Pentone (formerly Marionette)  
**Publication Target:** GitHub (`Raghavv1206/Pentone`)  
**Base Commit (Phase 3.5 Final):** `f6e31c78a9d652d69a002efb00726ec73a606122`  
**Date:** November 2, 2026  
**Status:** Read-Only Discovery & Proposal (Pre-Implementation)  

---

## 1. Current Architecture Assessment

Following the successful merge of Phase 3.5, Pentone has transitioned from an experimental Chrome-native prototype to a production-hardened hybrid on-device assistant.

### 1.1 Core Architecture Components
1. **Dedicated Inference Worker:**
   [`lib/workers/inference-worker.ts`](file:///c:/project/New%20folder/Marionette/lib/workers/inference-worker.ts) runs Transformers.js 2.17.2 and ONNX Runtime Web on an isolated Web Worker thread, executing `onnx-community/Qwen2.5-0.5B-Instruct` (INT8 dynamic quantization). All WASM allocations and token generation loops run outside the renderer main thread.
2. **Model Provisioning & Cache Management:**
   [`lib/model-provisioning.ts`](file:///c:/project/New%20folder/Marionette/lib/model-provisioning.ts) resolves model assets against immutable commit SHA `22942cb7d7ba4cc81bb4673549ca4d4614469b5e` and populates the browser `CacheStorage` (`transformers-cache`) with verified SHA-256 digests.
3. **Voice Authorization & Capability Gate:**
   [`lib/audio/voice-authorization-manager.ts`](file:///c:/project/New%20folder/Marionette/lib/audio/voice-authorization-manager.ts) enforces a two-tier capability model:
   - **Tier A (Voice Turn Grant):** Issued only upon physical PTT or verified wake-word input (30s hard deadline).
   - **Tier B (Voice Authorization Token):** Ephemeral single-use token (10s TTL) consumed atomically at tool execution boundaries. Model outputs cannot synthesize, forge, or replay tokens.
4. **Resilient Audio Pipeline:**
   [`lib/audio/persistent-audio-pipeline.ts`](file:///c:/project/New%20folder/Marionette/lib/audio/persistent-audio-pipeline.ts) and [`lib/audio/audio-resampler.ts`](file:///c:/project/New%20folder/Marionette/lib/audio/audio-resampler.ts) decouple hardware DAC sample rates (44.1 kHz / 48 kHz) from Whisper ASR input requirements by resampling to 16 kHz Float32 PCM.
5. **Deterministic Fallbacks & Provenance:**
   Tools and assistant messages carry explicit provenance tags (`'native'`, `'local-worker'`, or `'deterministic'`) to guarantee that algorithmic fallbacks (e.g. TextRank summarizer, dictionary translator) are never represented to users as neural generation.

---

## 2. Phase 3.5 Completion Baseline

The Phase 3.5 release has been verified and published to GitHub `main` at commit `f6e31c7`:
- **Repository URL:** `https://github.com/Raghavv1206/Pentone.git`
- **Tracked Commits:**
  - `a9eeede`: Phase 2 session lifecycle and multimodal separation.
  - `f6e31c7`: Phases 3.0–3.5 Web Worker isolation, cache verification, and hardening.
- **Waveform Invariant:** [`components/waveform.tsx`](file:///c:/project/New%20folder/Marionette/components/waveform.tsx) remains at **0 diff against `main`**.
- **Automated Regression Census:**
  - `npm test` (15 files): 171 passed (100%).
  - Phase 3–3.5 Standalone (7 files): 113 passed (100%).
  - Additional Unit Suites (3 files): 21 passed (100%).
  - Total verified automated tests: **305 / 305 passing (0 failures, 0 skipped)**.
- **Production Build:** Clean compile via `plasmo build` for `chrome-mv3` in 6,814 ms.

---

## 3. Critical Issues & Architectural Inconsistencies Discovered

During this read-only discovery, three critical architectural gaps and discrepancies were identified:

### Finding 1 (High Severity): Missing `env.allowRemoteModels = false` in Worker Runtime
- **Observation:** In [`lib/workers/inference-worker.ts`](file:///c:/project/New%20folder/Marionette/lib/workers/inference-worker.ts) lines 75–76:
  ```typescript
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  ```
  `env.allowRemoteModels` is **not set to `false`**.
- **Impact:** While `env.allowLocalModels = false` disables Node filesystem paths, Transformers.js defaults `allowRemoteModels` to `true`. If an asset blob lookup fails or is evicted from `CacheStorage`, the worker will silently initiate a remote network request to Hugging Face CDN (`huggingface.co`), violating the post-provisioning zero-egress privacy guarantee.
- **Remediation Required:** Explicitly set `env.allowRemoteModels = false` inside the worker initialization path after CacheStorage provisioning.

### Finding 2 (High Severity): Complete Documentation Desynchronization in `README.md`
- **Observation:** The root [`README.md`](file:///c:/project/New%20folder/Marionette/README.md) is entirely out of date:
  - It describes Pentone as exclusively powered by Chrome's built-in Gemini Nano (`#prompt-api-for-gemini-nano-multimodal-input`).
  - It does not document the local Qwen2.5-0.5B ONNX Web Worker architecture, CacheStorage provisioning, or the offline worker runtime.
  - It claims 22 tools when 27 tools are actively registered in [`lib/ui-tools.ts`](file:///c:/project/New%20folder/Marionette/lib/ui-tools.ts).
  - It instructs users to join the Chrome AI Early Preview Program, which is no longer a prerequisite for on-device operation.
- **Impact:** Misleads developers, reviewers, and users regarding system architecture, privacy boundaries, and setup requirements.

### Finding 3 (Medium Severity): Worker Crash State Leaves Model Unusable Without Reload
- **Observation:** In [`lib/generative-runtime.ts`](file:///c:/project/New%20folder/Marionette/lib/generative-runtime.ts), an unhandled worker crash or WASM OOM cleanly terminates the worker instance and rejects pending calls. However, subsequent inference requests fail permanently because the worker reference is null and no automatic respawn or user-friendly "Restart Engine" recovery button exists in the chat UI.

---

## 4. Prioritized Phase 4 Roadmap

### 4.1 High-Priority Improvements (P0 — Reliability, Privacy & Truthfulness)

#### Task P4-01: Enforcement of Strict Offline Invariant in Inference Worker
- **Objective:** Guarantee zero network egress during model inference.
- **Implementation:** Explicitly configure `env.allowRemoteModels = false` in [`lib/workers/inference-worker.ts`](file:///c:/project/New%20folder/Marionette/lib/workers/inference-worker.ts). Ensure runtime falls back immediately to deterministic engines if a cached asset is corrupt or missing, with zero network fallback.
- **Acceptance Criteria:** Unit tests verify that missing cache entries trigger explicit `ModelNotProvisionedError` and never execute remote `fetch`.

#### Task P4-02: Comprehensive Documentation & Whitepaper Overhaul
- **Objective:** Synchronize `README.md` and public documentation with Phase 3.5 architecture.
- **Implementation:**
  - Rewrite [`README.md`](file:///c:/project/New%20folder/Marionette/README.md) to accurately document the hybrid architecture: primary Qwen2.5-0.5B ONNX Web Worker, optional Chrome built-in Gemini Nano APIs, and deterministic fallbacks.
  - Update tool count to 27 active tools.
  - Document one-time model provisioning (~488 MB INT8 ONNX) and storage requirements.
  - Detail the VoiceAuthorizationToken security model and prompt-injection defense.
- **Acceptance Criteria:** `README.md` matches codebase reality 100%.

#### Task P4-03: Graceful Worker Crash Recovery & Auto-Respawn
- **Objective:** Prevent dead-end error states following WebAssembly isolate OOM or tab suspension.
- **Implementation:** Add an automatic exponential backoff respawn mechanism (up to 2 retries) in `GenerativeRuntime`. If crash persists, display a one-click "Restart Local AI Engine" recovery pill in the Chat UI.
- **Acceptance Criteria:** Simulated worker crashes recover automatically on subsequent user requests without requiring extension reload.

---

### 4.2 Medium-Priority Improvements (P1 — Performance & Agent Quality)

#### Task P4-04: Optional WebGPU Execution Provider Evaluation
- **Objective:** Accelerate generation throughput on hardware with WebGPU support.
- **Implementation:** Probe `navigator.gpu` capability in `inference-worker.ts`. If available and enabled by user setting, initialize ONNX Runtime Web with the `webgpu` execution provider; fall back to `wasm` if unsupported or on memory pressure.
- **Target Baseline:** Increase token generation throughput from ~13 tokens/s (CPU WASM) to 25–40 tokens/s on supported GPUs.
- **Acceptance Criteria:** Verified WebGPU fallback to WASM when WebGPU context fails.

#### Task P4-05: Agentic Multi-Step Loop Optimization & Repetition Deterrence
- **Objective:** Eliminate redundant tool executions during complex multi-step workflows.
- **Implementation:** Introduce strict tool deduplication and loop termination in `lib/ui-tools.ts` to detect cyclic tool calls (e.g. repeated scroll/findElement disjunctions) and force an immediate clarification prompt.
- **Acceptance Criteria:** Agent loop aborts gracefully on 3 consecutive identical actions.

#### Task P4-06: Pre-Warming & Idle Memory Management Policy
- **Objective:** Balance cold-start latency against background memory footprint.
- **Implementation:** Introduce an optional "Pre-warm on Sidepanel Open" preference in Settings. If enabled, the Worker compiles WASM during sidepanel launch rather than on first chat prompt. Add an explicit idle timeout (e.g. 15 minutes of inactivity) to release WASM heap memory if configured by the user.
- **Acceptance Criteria:** Cold start to first token reduced from ~3.8s to <500ms when pre-warmed.

---

### 4.3 Low-Priority Improvements (P2 — Polishing & Ecosystem)

#### Task P4-07: First-Run Onboarding Wizard for Model Provisioning
- **Objective:** Provide a seamless first-run setup experience for non-technical users.
- **Implementation:** A simple, elegant 2-step setup card explaining storage requirements, downloading the model, and verifying offline readiness with a progress bar and integrity badge.

#### Task P4-08: Chrome Web Store Package Optimization
- **Objective:** Minimize extension ZIP package footprint and remove unused assets.
- **Implementation:** Audit `assets/` directory to remove orphaned weights or redundant test models while preserving core Silero VAD, Porcupine, and ONNX runtime assets.

---

## 5. Recommended Phase 4 Objective & Implementation Scope

### Objective:
**"Phase 4 — Offline Integrity Enforcement, Documentation Realignment & UX Resilience"**

Focus strictly on making the existing Qwen2.5 Web Worker and browser tool architecture completely self-consistent, truthful in documentation, resilient against worker crashes, and strictly offline.

### Explicitly Out-of-Scope for Phase 4:
- Do not migrate to a larger model (e.g. 1.5B or 7B), which would exceed extension memory limits.
- Do not rewrite the browser tool registry.
- Do not touch `components/waveform.tsx` (remains strictly protected).
- Do not add remote cloud LLM endpoints or paid API keys.

---

## 6. Test Strategy & Acceptance Gates

1. **Regression Gate:** Must maintain all 305 automated tests passing with 0 failures.
2. **Offline Network Gate:** Physical network capture test confirming zero HTTP requests emitted by `inference-worker.ts` during token generation with cache pre-populated.
3. **Build Gate:** `npm run build` must compile cleanly under 7 seconds with zero new warnings.
4. **Waveform Invariant:** Zero diff against `main` for `components/waveform.tsx`.

---

*(Report compiled and saved to `reports/PENTONE_PHASE_4_DISCOVERY_AND_PROPOSAL.md`. Standing by for Phase 4 authorization).*
