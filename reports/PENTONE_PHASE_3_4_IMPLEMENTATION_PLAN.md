# Pentone Phase 3.4 — Implementation Plan: Local AI Productization & UX Integration

**Plan Date:** November 2, 2026  
**Auditor:** Independent Antigravity Architecture Review  
**Execution Target:** Sequential Engineering Execution for Phase 3.4  
**Target Branch:** `feature/local-ai-enablement`  
**Status:** **READY FOR AUTHORIZATION**

---

## 1. Existing Architecture & Source Inventory

The implementation strictly reuses existing tested modules without introducing external dependencies:

| Component / Subsystem | Primary Source File | Existing Capabilities Reused |
|---|---|---|
| **Model Provisioning** | [`lib/model-provisioning.ts`](file:///c:/project/New%20folder/Marionette/lib/model-provisioning.ts) | 8-state machine, streaming fetch, CacheStorage storage, quota check, cancellation |
| **Generative Runtime** | [`lib/generative-runtime.ts`](file:///c:/project/New%20folder/Marionette/lib/generative-runtime.ts) | 4-tier hierarchy, sequential execution queue, ChatML formatting, WebGPU/WASM probe |
| **Tool Dispatch** | [`lib/ui-tools.ts`](file:///c:/project/New%20folder/Marionette/lib/ui-tools.ts) | Voice authorization token gating, execution error wrapping, tool registry |
| **Settings UI** | [`screens/settings-screen.tsx`](file:///c:/project/New%20folder/Marionette/screens/settings-screen.tsx) | "AI & Models" tab layout, Whisper configuration, storage settings |
| **Chat & Provenance UI** | [`screens/chat-screen.tsx`](file:///c:/project/New%20folder/Marionette/screens/chat-screen.tsx) | Message rendering, tool activity badges, copy/rating buttons |
| **Context Management** | `lib/chat-context.tsx` | Message dispatch, turn lifecycle, active conversation store |

---

## 2. Minimal Implementation Sequence

The productization of Phase 3.4 must follow an incremental, strictly ordered 5-step sequence:

```
[Step 1: Model Revision Pinning & Cache Migration]
                      │
                      ▼
[Step 2: Model Provisioning React Hook & Context]
                      │
                      ▼
[Step 3: Settings UI Card: Download & Lifecycle Controls]
                      │
                      ▼
[Step 4: Chat Screen Provenance Badges & Generation Status]
                      │
                      ▼
[Step 5: Memory Unload Controls & Cleanup Listeners]
```

### Detailed Step Specifications

#### Step 1: Immutable Model Revision Pinning & Dual-Cache Lookup
- **Files:** `lib/model-provisioning.ts`, `lib/generative-runtime.ts`
- **Action:**
  - Update `QWEN_MODEL_REVISION = '22942cb7d7ba4cc81bb4673549ca4d4614469b5e'`.
  - Add dual-lookup logic in `checkModelCached()`: check if assets exist under the commit SHA URL; if only found under `/resolve/main/`, copy/alias them into the commit SHA key so existing users do not have to re-download 495 MB.
- **Risk Mitigation:** Guarantees zero regression for already-provisioned installations.

#### Step 2: Model Provisioning Hook (`useModelProvisioning`)
- **Files:** `lib/model-provisioning-context.tsx` (new lightweight hook/context)
- **Action:**
  - Wrap `ModelProvisioningService.getInstance().subscribe(callback)`.
  - Expose `{ state, progress, downloadModel, cancelDownload, deleteModel, checkStorageQuota }`.
- **Dependency Impact:** 0 new dependencies; pure React 18 `useState` + `useEffect`.

#### Step 3: Settings Screen Model Management Card
- **Files:** `screens/settings-screen.tsx`
- **Action:**
  - Insert a new Card in Tab 3 ("AI & Models") above the Whisper card:
    - Displays: Model Name (`Qwen2.5-0.5B-Instruct`), Status Badge (`Not Downloaded`, `Downloading`, `Ready`, `Error`).
    - Action Buttons: `[Download Model (495 MB)]`, `[Cancel]`, `[Unload Memory]`, `[Delete from Disk]`.
    - Progress Bar: Appears during `downloading` showing MB downloaded and %.
- **Visual Safety:** Matches existing Radix / Tailwind dark & light theme tokens.

#### Step 4: Chat Screen Provenance Badges & Live Status Line
- **Files:** `screens/chat-screen.tsx`, `components/ui/tool-activity.tsx`
- **Action:**
  - In `screens/chat-screen.tsx`, next to `Pentone` message headers, render an execution tier badge:
    - Generative: `Local Model (Qwen2.5)`
    - Native: `Chrome AI (Nano)`
    - Deterministic: `Offline Fallback`
  - When `state.isProcessing === true`, differentiate status line:
    - `"Compiling local model..."` during cold initialization.
    - `"Generating response..."` during token emission.

#### Step 5: Memory Unload Architecture
- **Files:** `lib/generative-runtime.ts`
- **Action:**
  - Implement `unloadModel()`: clears `pipelineInstance`, resets `backend` to `'deterministic'`, and updates `status` to `'idle'`.
  - Register `window.addEventListener('beforeunload', () => generativeRuntime.unloadModel())` in `sidepanel.tsx`.

---

## 3. Test Strategy & Verification Gate

1. **Automated Regression Suite:**
   - Run `npm test` after each step to guarantee all 171 core unit tests remain 100% passing.
   - Run `tests/phase3-3-model-provisioning.test.ts` (5/5) and `tests/provenance-and-fallbacks.test.ts` (6/6).
2. **Interactive UI Verification in Chrome for Testing:**
   - Launch Chrome with unpacked extension.
   - Open Settings screen ➔ AI tab: verify model card renders, shows correct status.
   - Trigger download cancellation: confirm clean state return without corrupt cache.
   - Trigger writing/translation tool in chat: verify provenance badge matches returned `tier`.
3. **Waveform Invariance:**
   - `git diff main -- components/waveform.tsx` must remain strictly **0 diff**.

---

## 4. Acceptance Criteria for Phase 3.4

- [ ] Immutable commit SHA `22942cb...` pinned without breaking existing cached models.
- [ ] User can initiate, pause, cancel, and delete model from Settings UI.
- [ ] Storage quota (>550MB) validated before download starts.
- [ ] Chat UI displays honest provenance badges for every response.
- [ ] Sidepanel remains interactive and non-blocking during inference.
- [ ] Memory unload button frees JS session references cleanly.
- [ ] All 171 regression tests pass.
- [ ] Production build (`npm run build`) bundles cleanly.
- [ ] Waveform diff against `main` is strictly 0.

---

## 5. Explicitly Deferred Work

The following items are outside the scope of Phase 3.4 and explicitly deferred to Phase 4:
1. **Multi-Model Support:** Adding Llama-3.2-1B or Phi-3.5 is deferred; Pentone remains focused exclusively on `Qwen2.5-0.5B-Instruct`.
2. **Dynamic WebGPU Shader Tuning:** Fine-tuning custom WebGPU WGSL compute shaders is deferred; the runtime uses Transformers.js standard execution providers.
3. **Cloud Synchronization:** Cloud model sync is permanently out of scope (violates privacy mandate).
