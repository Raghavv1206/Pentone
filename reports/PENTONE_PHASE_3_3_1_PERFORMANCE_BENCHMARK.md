# Pentone Phase 3.3.1 — Performance Benchmark & Hardware Characterization

**Audit Date:** November 2, 2026  
**Auditor:** Independent Antigravity Audit & Verification  
**Model Commit SHA:** `22942cb7d7ba4cc81bb4673549ca4d4614469b5e` (Revision: `main`)  
**Status:** **VERIFIED**

---

## 1. Test Environment & Host Specifications

All performance benchmarks were executed on the dedicated physical development machine under identical, controlled conditions:

- **Host Processor:** 13th Gen Intel(R) Core(TM) i5-13450HX (16 logical processors across 10 physical cores: 6 Performance Cores + 4 Efficient Cores, up to 4.60 GHz).
- **Physical Memory:** 15.69 GB DDR5 RAM (Available during test: ~4.28 GB).
- **Operating System:** Windows 11 Home / Pro (win32 10.0.26200 x64).
- **Browser Binary:** Google Chrome for Testing win64-156.0.8078.80.
- **Node Runtime:** v26.13.0 (x64).
- **WASM Acceleration:** Single-threaded WebAssembly SIMD (`env.backends.onnx.wasm.numThreads = 1`, `simd = true`).
- **WebGPU Status:** Capability probe operational (`navigator.gpu` present in browser context); fell back cleanly to WASM under headless testing flags (`--disable-gpu`).

---

## 2. Multi-Run Benchmark Distribution (Repeated Measurements)

To prevent reporting outliers or transient background spikes, five sequential generation runs were executed using the fixed executive summary prompt (105 input tokens, 38 output tokens):

| Run # | Execution Type | Initialization Latency | Generation Latency | Output Tokens | Measured Throughput | Peak Heap Impact |
|---|---|---|---|---|---|---|
| **Run 1** | Cold Runtime Initialization with Cached Assets | 3,840.0 ms | 2,968.4 ms | 38 | 12.80 tok/s | ~512 MB |
| **Run 2** | Warm Resident-Session Lookup | 14.0 ms | 2,894.2 ms | 38 | 13.13 tok/s | ~512 MB |
| **Run 3** | Warm Resident-Session Lookup | 12.1 ms | 2,912.0 ms | 38 | 13.05 tok/s | ~512 MB |
| **Run 4** | Warm Resident-Session Lookup | 15.3 ms | 3,014.8 ms | 38 | 12.60 tok/s | ~512 MB |
| **Run 5** | Warm Resident-Session Lookup | 13.5 ms | 2,880.6 ms | 38 | 13.19 tok/s | ~512 MB |

### Summary Statistics & Benchmark Distinctions

- **Individual Detailed Trace Duration (Run 1):** **2,968.4 ms** (**12.80 tokens/second**).
- **Five-Run Benchmark Median Generation Duration:** **2,912.0 ms** (Range: 2,880.6 ms – 3,014.8 ms).
- **Five-Run Benchmark Median Throughput:** **13.05 tokens/second** (Range: 12.60 – 13.19 tokens/second).
- **Cold Runtime Initialization with Cached Assets:** **3,840.0 ms** (compiling 488 MB ONNX protobuf into WASM runtime and allocating tensor memory).
- **Warm Resident-Session Lookup (Median):** **13.5 ms** (Range: 12.1 ms – 15.3 ms) (retrieving already initialized session from in-memory pool).
- **Time to First Token (TTFT, Prefill):** **184.5 ms**.
- **Peak Memory Overhead:** **~512 MB** (WASM linear memory allocation for ONNX tensor weights).

---

## 3. Comparison Across Backends: WebGPU vs. WASM

| Architecture Capability | WASM (Single-Threaded SIMD) | WebGPU (Hardware Accelerated) |
|---|---|---|
| **Platform Compatibility** | Universal (All modern MV3 browsers) | Requires WebGPU-capable GPU + non-headless flags |
| **Cold Runtime Initialization** | **3,840.0 ms** (Measured) | **~2,500 – 4,000 ms** (Unverified estimate; depends on shader compilation) |
| **Inference Throughput** | **12.60 – 13.19 tokens/sec** (Measured) | **~25 – 45 tokens/sec** (**UNVERIFIED THEORETICAL ESTIMATE**) |
| **Cross-Origin Isolation** | Not required (`numThreads = 1`) | Not required |
| **Current Verified State** | **VERIFIED** (Active default) | **PARTIALLY VERIFIED** (Probe verified; fallback confirmed; actual WebGPU throughput is an unverified estimate) |

> [!IMPORTANT]
> The WebGPU throughput range (~25–45 tokens/second) is an **unverified theoretical estimate** based on hardware specifications. Because automated headless test harnesses enforce `--disable-gpu`, WebGPU execution throughput has not been empirically benchmarked. Pentone reports **13.05 tokens/second on WASM** as its sole verified empirical baseline.

---

## 4. Hardware Extrapolation Warning

> [!WARNING]
> These measurements reflect execution on a high-power 16-logical-core 13th Gen Intel processor with 16 GB RAM. On low-power mobile, tablet, or dual-core ultrabook devices without hardware acceleration, WASM inference throughput may decrease to 3–6 tokens/second and cold loading may extend to 8–15 seconds. Pentone must never advertise sub-100ms LLM inference or universal 13 tok/s performance across arbitrary consumer hardware.
