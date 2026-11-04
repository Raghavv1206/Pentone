# Pentone — SmolLM Tokenizer Integrity & Model Provisioning Fix Report

**Date:** November 3, 2026  
**Branch:** `feature/phase-4-offline-resilience`  
**HEAD SHA:** `7b0220ec491daddedaa9d6629ecd1927585e6665`  
**Baseline Commit:** `f6e31c78a9d652d69a002efb00726ec73a606122`  
**Status:** **REMEDIATED & VERIFIED** (246 / 246 tests passing, Production Build clean)

---

## 1. Executive Summary & Root Cause Analysis

### The Reported Failure
During the first-launch onboarding flow (`Pentone Step 3 of 4: Local AI`), initiating `downloadAllModels()` resulted in an interrupted provisioning state:
- `all-MiniLM-L6-v2`: **Cached** (verified)
- `Whisper Tiny`: **Cached** (verified)
- `SmolLM-135M-Instruct`: **Not Cached**
- Error Banner: `Download interrupted: Provisioning incomplete. Failed mod... [Retry]`
- Runtime Log:
  ```
  [ModelProvisioning] Error provisioning qwen: Integrity verification failed for newly downloaded tokenizer.json (SmolLM-135M-Instruct (INT8))
  ```

### Proven Root Cause
1. **Upstream Artifact Provenance:**
   - **Repository:** `onnx-community/SmolLM-135M-Instruct-ONNX`
   - **Pinned Immutable Revision:** `7e78273381b84cc2dae12daceb53552c8b115eef`
   - **Download URL:** `https://huggingface.co/onnx-community/SmolLM-135M-Instruct-ONNX/resolve/7e78273381b84cc2dae12daceb53552c8b115eef/tokenizer.json`
   - **Raw Upstream File Size:** `3,522,656` bytes
   - **Raw Upstream SHA-256:** `7d27c493c729a66ecefc837280b05d948b1ed50d130eebdbf911b1b36cf38ed7`
   - **Structure:** Upstream Hugging Face export contains `model.merges` as 2D arrays: `[['Ġ', 't'], ['Ġ', 's'], ...]`.

2. **Transformers.js Compatibility Invariant:**
   - `@xenova/transformers@2.17.2` tokenizers strictly expect string merges: `['Ġ t', 'Ġ s', ...]`.
   - Passing raw 2D array merges causes `@xenova/transformers` to crash during tokenization with `TypeError: t.split is not a function`.

3. **Verification Asymmetry:**
   - The expected metadata in `EXPECTED_ASSET_METADATA['tokenizer.json']` was pinned to the **normalized** tokenizer representation:
     - Expected Byte Size: `1,367,670` bytes
     - Expected SHA-256: `46e005fac00bc2e588170339ee3bf9ad7bf7d507985f747ac51c6bf76cf0f9aa`
   - However, `downloadModel('qwen')` in `lib/model-provisioning.ts` fetched the raw 3.52 MB upstream file and directly invoked `verifyAssetBlob()` **without normalizing it**.
   - Comparing the raw upstream hash (`7d27c4...`) against the expected normalized hash (`46e005...`) failed cryptographic integrity validation, aborting Qwen provisioning and marking the download interrupted.

---

## 2. Technical Remediation

### A. Deterministic Tokenizer Normalization Pipeline
Implemented `normalizeSmolLMTokenizer()` on `ModelProvisioningService`:
```typescript
normalizeSmolLMTokenizer(rawJsonText: string): { normalizedText: string; isNormalized: boolean } {
  try {
    const json = JSON.parse(rawJsonText)
    if (Array.isArray(json?.model?.merges) && json.model.merges.length > 0) {
      let changed = false
      json.model.merges = json.model.merges.map((m: any) => {
        if (Array.isArray(m)) {
          changed = true
          return m.join(' ')
        }
        return m
      })
      if (changed) {
        return {
          normalizedText: JSON.stringify(json),
          isNormalized: true
        }
      }
    }
    return { normalizedText: rawJsonText, isNormalized: false }
  } catch (e: any) {
    throw new Error(`Failed to parse tokenizer.json during normalization: ${e.message}`)
  }
}
```

### B. Staged Transactional Provisioning Lifecycle
In `downloadModel()`:
1. **Check Cache & Self-Heal:** Inspects `cache.match(canonicalUrl)`. If a raw unnormalized tokenizer exists in cache, it automatically normalizes and verifies it without hitting the network. If corrupt, it purges the entry so it cannot linger.
2. **Fetch Upstream Asset:** Downloads from the pinned immutable revision `7e78273381b84cc2dae12daceb53552c8b115eef`.
3. **Execute Normalization:** Converts 2D array merges to space-delimited string merges and serializes deterministically via UTF-8 `TextEncoder`.
4. **Cryptographic Verification:** Validates SHA-256 against `46e005fac00bc2e588170339ee3bf9ad7bf7d507985f747ac51c6bf76cf0f9aa`.
5. **Atomic Commit:** Commits only the verified bytes to `CacheStorage` under canonical URL, main URL, and alias paths.
6. **Progress & Final Verification:** Performs an end-to-end `verifyCacheIntegrity()` pass before marking `state: 'downloaded'`.

### C. Concurrency Guard & Retry Hardening
- Added concurrency locks in `downloadModel`, `downloadAllModels`, and `retryDownload` (`if (this.state === 'downloading' || this.activeDownloadKey !== null) return false`).
- Duplicate clicks on "Download & Set Up Local AI" or "Retry" cannot spawn duplicate downloads or corrupt cache state.
- Preserved existing valid caches: failures in SmolLM do not invalidate or evict existing valid caches for `all-MiniLM-L6-v2` or `Whisper Tiny`.
- Scoped `downloadAllModels()` to the 3 core models (`CORE_MODEL_KEYS = ['embeddings', 'whisper', 'qwen']`, total ~205 MB) matching the onboarding UI and button copy.
- In `lib/model-provisioning-context.tsx`, wrapped provisioning operations in `try { ... } finally { await checkStatus() }` to guarantee React state stays in sync even when errors occur.

### D. Enhanced Onboarding Error Banner
In `components/onboarding/steps/model-availability-step.tsx`:
- Removed restrictive CSS `truncate` that obscured critical error diagnostic messages.
- Added structured error container displaying:
  - Header: `Model Provisioning Incomplete`
  - Exact failure reason and asset: e.g. `modelProv.progress.error`
  - Reassurance: *"Existing valid models remain cached and intact. Retry will resume only the missing or unverified files."*
  - Dedicated `[Retry]` button, disabled with spinner while downloading.

---

## 3. Cryptographic & File Verification Matrix

| Model Asset | Upstream Raw Size | Normalized Size | Verified SHA-256 Hash | Status |
| :--- | :--- | :--- | :--- | :--- |
| `onnx/model_quantized.onnx` | 135,658,353 bytes | N/A (binary) | `bec65cbd7d2aed51d35659629f9f20169367de1ed4de87bbb5d66de9eff214e7` | **VERIFIED** |
| `tokenizer.json` | 3,522,656 bytes | **1,367,670 bytes** | `46e005fac00bc2e588170339ee3bf9ad7bf7d507985f747ac51c6bf76cf0f9aa` | **VERIFIED** |
| `config.json` | 789 bytes | 789 bytes | `9528ed05d1c71e62a85c0897dad4b78be11c32814232a1f66b18035b351b5496` | **VERIFIED** |
| `generation_config.json` | 156 bytes | 156 bytes | `314f0ed543962bb557ac011738bf5dca90a890ad0f7169a14e99c187e9782110` | **VERIFIED** |
| `tokenizer_config.json` | 3,620 bytes | 3,620 bytes | `b6fa33508375abb95ff67512923e75f8017ffaf2055ce8378a804b1cb687a11f` | **VERIFIED** |
| `special_tokens_map.json` | 655 bytes | 655 bytes | `2b7379f3ae813529281a5c602bc5a11c1d4e0a99107aaa597fe936c1e813ca52` | **VERIFIED** |
| `vocab.json` | 800,662 bytes | 800,662 bytes | `82b84012e3add4d01d12ba14442026e49b8cbbaead1f79ecf3d919784f82dc79` | **VERIFIED** |
| `merges.txt` | 466,391 bytes | 466,391 bytes | `0b54e8aa4e53d5383e2e4bc635a56b43f9647f7b13832d5d9ecd8f82dac4f510` | **VERIFIED** |

---

## 4. Verification & Test Evidence

### A. Suite Test Results
Executed: `pnpm test`
- **Result:** **246 passing tests across 21 test suites in 4.81s** (0 failures, 0 skipped).
- **Added Tests (16 dedicated regression tests in `tests/onboarding-and-model-provisioning.test.ts`):**
  1. `Correct normalized tokenizer passes SHA verification`: Verified deterministic normalization and `verifyAssetBlob()` SHA-256 success.
  2. `Wrong tokenizer hash is rejected`: Rejects altered or corrupt tokenizer payloads.
  3. `Wrong model revision is rejected`: Ensures URLs and cache lookup strictly enforce pinned commit SHA.
  4. `HTML/error response is rejected`: Fails JSON structural parsing and size checks on server error responses.
  5. `Truncated tokenizer download is rejected`: Detects truncated JSON streams.
  6. `Invalid JSON is rejected`: Rejects malformed JSON syntax.
  7. `Normalization produces deterministic bytes`: Proves idempotency and byte stability across multiple normalization passes.
  8. `Hash is computed after normalization`: Confirms raw 2D array hash differs from normalized string hash.
  9. `Cache stores exactly the verified bytes`: Verifies that `CacheStorage` receives the normalized string merge structure.
  10. `Failed download does not mark the model cached`: Confirms failed downloads leave `checkModelCached('qwen') === false`.
  11. `Retry successfully recovers from tokenizer verification failure`: Simulates initial failure followed by clean recovery and cache verification.
  12. `Valid embeddings and Whisper caches remain intact after Qwen failure`: Proves fault isolation between independent models.
  13. `Duplicate Retry clicks do not start duplicate downloads`: Verifies concurrency guards and duplicate rejection.
  14. `Download All correctly reports partial success and failure`: Reports precise failed model names in error state while preserving finished models.
  15. `Fully provisioned models pass checkAllModelsCached()`: Validates `{ qwen: true, embeddings: true, whisper: true, allCached: true, coreCached: true }`.
  16. `Local SmolLM initializes and completes a minimal inference after provisioning`: Proves generative runtime execution and text generation using provisioned SmolLM assets.

### B. Production Build
Executed: `pnpm build`
- Plasmo Chrome MV3 bundling: **Finished in 6,491ms**
- Postbuild `patch-bundle.js`: Restored native dynamic imports cleanly in `build/chrome-mv3-prod/transformers.1fabdbf2.js`.
- Exit code: 0 (Clean).

### C. Git & Project Invariants
- `git diff f6e31c78a9d652d69a002efb00726ec73a606122 -- components/waveform.tsx`: **Strictly 0 bytes diff**.
- Zero branch switching, commits, rebases, merges, or stashes executed. Active branch remains `feature/phase-4-offline-resilience`, HEAD `7b0220ec491daddedaa9d6629ecd1927585e6665`.
