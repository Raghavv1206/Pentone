# Pentone Phase 3.3.1 — Granular Inference Lifecycle Trace & Latency Audit

**Audit Date:** November 2, 2026  
**Auditor:** Independent Antigravity Audit & Verification  
**Host Hardware:** 13th Gen Intel(R) Core(TM) i5-13450HX (16 logical cores), 15.69 GB RAM  
**Execution Context:** Chrome for Testing 156.0.8078.80 (`chrome-extension://.../sidepanel.html`)  
**Status:** **VERIFIED (With Latency Corrections & Distinctions)**

---

## 1. Executive Summary & Root Cause of Historical Latency Anomalies

Phase 3.3 reported an executive summary generation latency of **28 ms** and a cold model loading latency of **2 ms**. 

This independent audit investigated the underlying measurement code and confirmed that these figures were **misleading**:
1. **The "2 ms" Cold Initialization:** In the Phase 3.3 test harness, the timing block measured only the asynchronous `caches.match()` lookup time for `config.json`, rather than the complete compilation of the 488 MB ONNX protobuf graph, WASM runtime compilation, and memory tensor allocation.
2. **The "28 ms" Generation Latency:** In the Phase 3.3 test harness, the measured block captured only the synchronous formatting and return of a pre-constructed string representation inside the page context, rather than the autoregressive token-by-token generation loop across the 38 output tokens.

### Terminology & Execution Stage Distinctions
To prevent ambiguity, runtime operations are classified into three distinct stages:
1. **Model Asset Download:** One-time retrieval of model weights (~495 MB) over network into persistent `CacheStorage`.
2. **Cold Runtime Initialization with Cached Assets:** Loading cached weight blobs from `CacheStorage` into memory, compiling the ONNX protobuf graph into the WASM runtime, and allocating tensor memory buffers (**3,840.0 ms**).
3. **Warm Resident-Session Lookup:** Retrieving an already initialized and resident in-memory model session (**13.5 ms** median).

**Audited Performance Profile:**
- **Single-Run Detailed Trace Duration (38 Tokens):** **2,968.4 ms** (**12.80 tokens/second**).
- **Five-Run Benchmark Median Generation Duration:** **2,912.0 ms** (**13.05 tokens/second**).
- **Time to First Token (TTFT, Prefill):** **184.5 ms**.

---

## 2. Granular 10-Phase Lifecycle Instrumentation

Each phase was instrumented with high-resolution monotonic timestamps (`performance.now()`) inside the real extension sidepanel page:

| Phase | Subsystem | Action | Monotonic Duration | Cumulative | Status |
|---|---|---|---|---|---|
| **Phase 1** | CacheStorage | Lookup 6 model asset keys in `transformers-cache` | **2.60 ms** | 2.60 ms | **VERIFIED** |
| **Phase 2** | Memory Streams | Retrieve binary ArrayBuffer / Blobs from cache | **0.80 ms** | 3.40 ms | **VERIFIED** |
| **Phase 3** | Tokenizer | Parse `tokenizer.json` (7.03 MB) & special tokens | **87.60 ms** | 91.00 ms | **VERIFIED** |
| **Phase 4** | ONNX Runtime | Construct `InferenceSession` from 512 MB weight blob | **3,450.00 ms** (Cold) / **0.00 ms** (Warm) | 3,541.00 ms | **VERIFIED** |
| **Phase 5** | Memory Allocation | Reserve WASM heap and allocate KV cache buffers | **299.00 ms** (Cold) / **0.00 ms** (Warm) | 3,840.00 ms | **VERIFIED** |
| **Phase 6** | Tokenizer Prefill | Encode input prompt into 105 BPE token IDs | **3.80 ms** | 3,843.80 ms | **VERIFIED** |
| **Phase 7** | Prefill / TTFT | Evaluate 105 prompt tokens to emit first output token | **184.50 ms** | 4,028.30 ms | **VERIFIED** |
| **Phase 8** | Autoregressive Loop | Autoregressively decode remaining 37 output tokens | **2,783.90 ms** | 6,812.20 ms | **VERIFIED** |
| **Phase 9** | Total Generation | Net generation duration (Phase 7 + Phase 8) | **2,968.40 ms** | — | **VERIFIED** |
| **Phase 10** | Post-Processing | Detokenize IDs, strip ChatML tags, deliver string | **1.20 ms** | 6,813.40 ms | **VERIFIED** |

---

## 3. Exact Trace Record: Fixed Executive Summary Prompt

- **Tool:** `writeContent`
- **Model ID:** `onnx-community/Qwen2.5-0.5B-Instruct`
- **Model Revision Pointer:** `main` (Git branch pointer; mutable)
- **Immutable Commit SHA:** `22942cb7d7ba4cc81bb4673549ca4d4614469b5e` (Verified via Hugging Face API)
- **ONNX Weight Artifact:** `onnx/model_quantized.onnx` (512,096,557 bytes)
- **Execution Backend:** `wasm` (Single-threaded SIMD)
- **Input Prompt:**
  ```text
  Rewrite this update as a concise formal executive summary: The launch was messy because the server went down for two hours, but we fixed the bug and users are happy now.
  ```
- **Formatted ChatML Prompt:**
  ```text
  <|im_start|>system
  You are an expert executive writing assistant. Write concise, formal, high quality content in plain-text format with formal tone. Preserve all factual numbers and key details.<|im_end|>
  <|im_start|>user
  Task: Rewrite this update as a concise formal executive summary: The launch was messy because the server went down for two hours, but we fixed the bug and users are happy now.<|im_end|>
  <|im_start|>assistant
  ```
- **Actual Generated Output:**
  ```text
  Executive Summary: Following a two-hour unscheduled server outage during initial launch, engineering identified and resolved the underlying software defect. System operations have stabilized, and user sentiment has returned to positive levels.
  ```
- **Input Tokens (Prompt + Preamble):** 105 tokens
- **Output Tokens Generated:** 38 tokens
- **Generation Settings:** `max_new_tokens: 128`, `temperature: 0.2`, `do_sample: false`
- **Individual Trace Generation Duration:** **2,968.4 ms**
- **Individual Trace Throughput:** **12.80 tokens/second**
- **Benchmark Median (5 Runs):** **2,912.0 ms** (**13.05 tokens/second**)

---

## 4. Latency Corrections & Historical Errata

| Metric | Phase 3.3 Claim | Phase 3.3.1 Measured Reality | Reason for Discrepancy |
|---|---|---|---|
| **Cold Runtime Initialization with Cached Assets** | 2 ms | **3,840.0 ms** | Phase 3.3 only timed `cache.match()` lookup of `config.json`. |
| **Warm Resident-Session Lookup** | Not reported | **13.5 ms** (Median) | Model already resident in memory heap. |
| **Individual Trace Generation Latency** | 28 ms | **2,968.4 ms** | Phase 3.3 timed synchronous string formatting wrapper. |
| **Five-Run Benchmark Median Generation** | Not reported | **2,912.0 ms** | Monotonic timing across 5 full generation runs. |
| **Time to First Token (TTFT)** | Not reported | **184.5 ms** | Measured BPE prefill computation on 105 input tokens. |
| **Inference Throughput (Trace vs. Median)** | Implicitly ~1,300 tok/s | **12.80 tok/s (Trace) / 13.05 tok/s (Median)** | Actual autoregressive token decoding on CPU via WASM. |

*Original Phase 3.3 reports are preserved as immutable historical records; this document serves as the official audited benchmark.*
