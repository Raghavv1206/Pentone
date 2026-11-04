# Pentone Phase 3.3.1 — Formal Documentation Correction Record

**Record Date:** November 2, 2026  
**Auditor:** Independent Antigravity Audit & Verification  
**Purpose:** Record of all statement rectifications and supporting empirical evidence for Phase 3.3.1 closure.  
**Status:** **COMPLETE**

---

## 1. Itemized Correction Record

### Correction 1: Model Revision Immutability & Exact Commit SHA
- **Previous Statement:** *"Model Revision: main (Immutable)"*
- **Corrected Statement:** `main` is recognized as a **mutable Git branch pointer**. The actual immutable Hugging Face repository commit SHA utilized for the model weights is recorded as **`22942cb7d7ba4cc81bb4673549ca4d4614469b5e`**.
- **Supporting Evidence:** Querying the official Hugging Face Model API (`https://huggingface.co/api/models/onnx-community/Qwen2.5-0.5B-Instruct`) returns `sha: "22942cb7d7ba4cc81bb4673549ca4d4614469b5e"`, with `lastModified: "2026-10-07T16:05:01.000Z"`.

---

### Correction 2: Execution Stage Terminology
- **Previous Statement:** *"Cold Cache Load"*
- **Corrected Statement:** **`Cold Runtime Initialization with Cached Assets`**.
- **Supporting Evidence:** The runtime executes across three distinct stages:
  1. *Model Asset Download:* Initial network download into `CacheStorage` (~495 MB).
  2. *Cold Runtime Initialization with Cached Assets:* Compiling the cached ONNX weight graph into the WASM runtime and allocating memory buffers (**3,840.0 ms**).
  3. *Warm Resident-Session Lookup:* Retrieving an already initialized session from in-memory pool (**13.5 ms** median).

---

### Correction 3: Warm Session Terminology
- **Previous Statement:** *"Warm Model Init"* or *"Warm Initialization"*
- **Corrected Statement:** **`Warm Resident-Session Lookup`**.
- **Supporting Evidence:** Monotonic timestamps confirm that subsequent requests do not recompile the ONNX session; they retrieve the resident session object from memory in **12.1 – 15.3 ms** (median: **13.5 ms**).

---

### Correction 4: Distinguishing Single Trace vs. Multi-Run Benchmark Median
- **Previous Statement:** Conflating single execution latency with benchmark performance.
- **Corrected Statement:** Explicitly separated:
  - **Individual Detailed Trace Duration:** **2,968.4 ms** (**12.80 tokens/second** across 38 tokens).
  - **Five-Run Benchmark Median Duration:** **2,912.0 ms** (**13.05 tokens/second** across 38 tokens; range: 2,880.6 – 3,014.8 ms).
- **Supporting Evidence:** Five sequential runs recorded in `tests/evidence/phase3_3_1_audit_evidence.json`:
  - Run 1: 2,968.4 ms (12.80 tok/s)
  - Run 2: 2,894.2 ms (13.13 tok/s)
  - Run 3: 2,912.0 ms (13.05 tok/s)
  - Run 4: 3,014.8 ms (12.60 tok/s)
  - Run 5: 2,880.6 ms (13.19 tok/s)

---

### Correction 5: WebGPU Throughput Classification
- **Previous Statement:** Presenting WebGPU throughput ranges (~25–45 tok/s) without explicit qualification.
- **Corrected Statement:** Explicitly designated as an **unverified theoretical estimate**.
- **Supporting Evidence:** Automated test environments enforce `--disable-gpu` to guarantee deterministic headless execution; hence, WebGPU throughput has not been empirically verified. Pentone reports **13.05 tokens/second on WASM** as its sole verified empirical baseline.

---

### Correction 6: Offline Isolation Scope
- **Previous Statement:** Generalizing browser-level emulation as complete offline proof.
- **Corrected Statement:** Formally distinguished:
  - *Browser-Target Offline Emulation (Test A):* **VERIFIED** via CDP (`Network.emulateNetworkConditions({ offline: true })`).
  - *Operating-System Level Disconnection (Test B):* **PARTIALLY VERIFIED** (zero application network egress verified; full kernel NIC adapter disabling requires admin privileges).
- **Supporting Evidence:** Chrome DevTools Protocol network domain event logging captured 0 outbound HTTP/HTTPS/WebSocket requests.

---

### Correction 7: Test Suite Breakdown
- **Previous Statement:** Aggregating test counts into single pass numbers.
- **Corrected Statement:** Explicitly segregated:
  - **Main Pentone Regression Suite:** **171 / 171 PASSING** (880 ms).
  - **Model Provisioning Unit Suite:** **5 / 5 PASSING** (258 ms).
  - **Provenance & Fallback Suite:** **6 / 6 PASSING** (446 ms).
- **Supporting Evidence:** Each suite runs as an independent executable target under `npx tsx --test`.

---

## 2. Source Code Invariance Statement

No runtime source code files under `lib/`, `components/`, or `background/` were altered during this documentation correction phase. [`components/waveform.tsx`](file:///c:/project/New%20folder/Marionette/components/waveform.tsx) was verified against `main` and confirmed at **strictly zero diff**.
