/**
 * Pentone Local Model Provisioning Service
 * 
 * Manages user-controlled downloading, verification, caching, and lifecycle
 * management for on-device small language models (Qwen2.5-0.5B-Instruct).
 * 
 * Guarantees:
 * 1. Pinned immutable model revision (22942cb7d7ba4cc81bb4673549ca4d4614469b5e).
 * 2. Backwards-compatible legacy cache migration with integrity verification (never blindly aliases).
 * 3. Persistent storage using the standard browser Cache API ('transformers-cache') across extension restarts.
 * 4. User-controlled lifecycle states and non-duplicative pub-sub state management.
 * 5. File completeness and cryptographic verification before marking model ready.
 * 6. Storage quota pre-check (>550 MB) before downloading.
 * 7. Full cancellation support via AbortSignal.
 * 8. Zero transmission of user prompts or data — downloads model weights only.
 */

import { localAIDiagnostics } from './local-ai-diagnostics'

export type ModelLifecycleState =
  | 'not_downloaded'
  | 'downloading'
  | 'paused'
  | 'interrupted'
  | 'downloaded'
  | 'initializing'
  | 'ready'
  | 'failed'
  | 'cancelled'

export interface ModelDownloadProgress {
  state: ModelLifecycleState
  modelId: string
  totalBytes: number
  downloadedBytes: number
  percent: number
  currentFile?: string
  error?: string | null
}

export interface ModelStorageInfo {
  quotaBytes?: number
  usageBytes?: number
  availableBytes?: number
  isSufficient: boolean
}

export const QWEN_MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct'
export const QWEN_MODEL_REVISION = '22942cb7d7ba4cc81bb4673549ca4d4614469b5e'
export const LEGACY_MODEL_REVISION = 'main'
export const CACHE_NAME = 'transformers-cache'
export const HF_REMOTE_BASE = 'https://huggingface.co'

// Required files for Qwen2.5-0.5B-Instruct quantized pipeline execution
export const REQUIRED_MODEL_FILES = [
  'config.json',
  'generation_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'onnx/model_quantized.onnx'
] as const

// Expected asset metadata and cryptographic checksums verified in Phase 3.3.1
export const EXPECTED_ASSET_METADATA: Record<string, { sizeBytes: number; sha256: string }> = {
  'config.json': {
    sizeBytes: 678,
    sha256: '777e01f0fbb3346eb229cb6fb278ed6533c1e4dcb9ebf4bed0f6e94ef17fa1b5'
  },
  'generation_config.json': {
    sizeBytes: 242,
    sha256: 'f7e7ce458658b2d40d9eb213b91b77a8bf698845ab89360976722d7ac46928a3'
  },
  'tokenizer.json': {
    sizeBytes: 7031673,
    sha256: 'a8506e7111b80c6d8635951a02eab0f4e1a8e4e5772da83846579e97b16f61bf'
  },
  'tokenizer_config.json': {
    sizeBytes: 7849,
    sha256: '6a14243f0ae04884e597b3f032c05e15de9f417318fdcac24ab4e2680e691430'
  },
  'special_tokens_map.json': {
    sizeBytes: 613,
    sha256: '76862e765266b85aa9459767e33cbaf13970f327a0e88d1c65846c2ddd3a1ecd'
  },
  'onnx/model_quantized.onnx': {
    sizeBytes: 512096557,
    sha256: '41834041ab1b29eff9fc592f1a29a1844133aea35832ea9fa91682be13016100'
  }
}

// Approximate uncompressed download size for Qwen2.5-0.5B quantized (~495 MB)
export const ESTIMATED_MODEL_BYTES = 495 * 1024 * 1024
export const STORAGE_BUFFER_BYTES = 50 * 1024 * 1024 // 50MB headroom

export class ModelProvisioningService {
  private static instance: ModelProvisioningService | null = null
  private state: ModelLifecycleState = 'not_downloaded'
  private progress: ModelDownloadProgress = {
    state: 'not_downloaded',
    modelId: QWEN_MODEL_ID,
    totalBytes: ESTIMATED_MODEL_BYTES,
    downloadedBytes: 0,
    percent: 0,
    error: null
  }

  private currentAbortController: AbortController | null = null
  private listeners = new Set<(progress: ModelDownloadProgress) => void>()

  private constructor() {}

  static getInstance(): ModelProvisioningService {
    if (!ModelProvisioningService.instance) {
      ModelProvisioningService.instance = new ModelProvisioningService()
    }
    return ModelProvisioningService.instance
  }

  getState(): ModelLifecycleState {
    return this.state
  }

  getProgress(): ModelDownloadProgress {
    return { ...this.progress }
  }

  subscribe(listener: (progress: ModelDownloadProgress) => void): () => void {
    this.listeners.add(listener)
    listener(this.getProgress())
    return () => this.listeners.delete(listener)
  }

  private notify() {
    const p = this.getProgress()
    for (const l of this.listeners) {
      try { l(p) } catch (e) { console.warn('[ModelProvisioning] Listener error:', e) }
    }
  }

  private updateProgress(updates: Partial<ModelDownloadProgress>) {
    this.progress = { ...this.progress, ...updates }
    if (updates.state) {
      this.state = updates.state
    }
    this.notify()
  }

  /**
   * Constructs the HuggingFace URL corresponding to the model asset.
   */
  getFileUrl(filename: string, revision = QWEN_MODEL_REVISION): string {
    return `${HF_REMOTE_BASE}/${QWEN_MODEL_ID}/resolve/${revision}/${filename}`
  }

  /**
   * Cryptographically verifies an asset Response before caching or migrating from legacy keys.
   */
  async verifyAssetBlob(filename: string, response: Response): Promise<boolean> {
    const expected = EXPECTED_ASSET_METADATA[filename]
    if (!expected) return false

    try {
      const clone = response.clone()
      const blob = await clone.blob()
      
      // Basic size check
      if (blob.size === 0) return false
      if (filename.endsWith('.onnx') && blob.size < 100 * 1024 * 1024) return false

      // Structural JSON check
      if (filename.endsWith('.json')) {
        const text = await blob.text()
        try {
          JSON.parse(text)
        } catch {
          return false
        }
      }

      // Check SHA-256 hash if Web Crypto or Node Crypto is available
      const scope: any = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {}))
      if (scope.crypto?.subtle) {
        const buf = await blob.arrayBuffer()
        const digestBuf = await scope.crypto.subtle.digest('SHA-256', buf)
        const hashArray = Array.from(new Uint8Array(digestBuf))
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
        return hashHex.toLowerCase() === expected.sha256.toLowerCase()
      }

      // If Web Crypto is unavailable, verify exact byte length
      return blob.size === expected.sizeBytes
    } catch (e) {
      console.warn(`[ModelProvisioning] Asset verification failed for ${filename}:`, e)
      return false
    }
  }

  /**
   * Pre-checks whether the client storage has sufficient quota for the model weights.
   */
  async checkStorageQuota(): Promise<ModelStorageInfo> {
    const scope: any = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {}))
    if (scope.navigator?.storage?.estimate) {
      try {
        const estimate = await scope.navigator.storage.estimate()
        const quota = estimate.quota || 0
        const usage = estimate.usage || 0
        const available = Math.max(0, quota - usage)
        const isSufficient = available >= (ESTIMATED_MODEL_BYTES + STORAGE_BUFFER_BYTES)
        return { quotaBytes: quota, usageBytes: usage, availableBytes: available, isSufficient }
      } catch (e) {
        console.warn('[ModelProvisioning] Storage estimate failed:', e)
      }
    }
    // In environments without storage estimation, default to sufficient
    return { isSufficient: true }
  }

  /**
   * Verifies if the model assets are present and complete in CacheStorage under pinned commit SHA.
   * Performs dual-key lookup: verifies legacy /resolve/main/ artifacts before migrating them.
   */
  async checkModelCached(): Promise<boolean> {
    const scope: any = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {}))
    if (!scope.caches) return false

    try {
      const cache = await scope.caches.open(CACHE_NAME)
      for (const file of REQUIRED_MODEL_FILES) {
        const canonicalUrl = this.getFileUrl(file, QWEN_MODEL_REVISION)
        let res = await cache.match(canonicalUrl)

        if (!res) {
          // Check for legacy /resolve/main/ entry
          const legacyUrl = this.getFileUrl(file, LEGACY_MODEL_REVISION)
          const legacyRes = await cache.match(legacyUrl)
          if (legacyRes) {
            // Verify legacy artifact before migrating — never blindly alias
            const isValid = await this.verifyAssetBlob(file, legacyRes)
            if (isValid) {
              await cache.put(canonicalUrl, legacyRes.clone())
              try { await cache.delete(legacyUrl) } catch {}
              res = legacyRes
            }
          }
        }

        if (!res) return false

        // Phase 3.5: Verify asset blob integrity before declaring cache complete
        const isAssetValid = await this.verifyAssetBlob(file, res)
        if (!isAssetValid) return false
      }
      return true
    } catch (e) {
      console.warn('[ModelProvisioning] Cache inspection error:', e)
      return false
    }
  }

  /**
   * Downloads and caches the required model files with progress reporting and cancellation.
   */
  async downloadModel(options?: {
    signal?: AbortSignal
    onProgress?: (progress: ModelDownloadProgress) => void
  }): Promise<boolean> {
    if (this.state === 'downloading' || this.state === 'initializing') {
      console.warn('[ModelProvisioning] Download already in progress.')
      return false
    }

    // Check storage availability
    const storage = await this.checkStorageQuota()
    if (!storage.isSufficient) {
      const err = `Insufficient storage space. Need at least ${Math.round((ESTIMATED_MODEL_BYTES + STORAGE_BUFFER_BYTES) / (1024 * 1024))} MB.`
      this.updateProgress({ state: 'failed', error: err })
      throw new Error(err)
    }

    // Setup cancellation controller
    this.currentAbortController = new AbortController()
    const abortSignal = options?.signal || this.currentAbortController.signal

    this.updateProgress({
      state: 'downloading',
      downloadedBytes: 0,
      totalBytes: ESTIMATED_MODEL_BYTES,
      percent: 0,
      error: null
    })

    const scope: any = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {}))
    if (!scope.caches) {
      const err = 'Cache API not supported in this runtime environment'
      this.updateProgress({ state: 'failed', error: err })
      throw new Error(err)
    }

    try {
      const cache = await scope.caches.open(CACHE_NAME)
      let cumulativeDownloaded = 0

      for (const file of REQUIRED_MODEL_FILES) {
        if (abortSignal.aborted) {
          this.updateProgress({ state: 'cancelled', error: 'Download cancelled by user' })
          return false
        }

        const canonicalUrl = this.getFileUrl(file, QWEN_MODEL_REVISION)
        this.updateProgress({ currentFile: file })

        // Check if already in cache under canonical key
        let existing = await cache.match(canonicalUrl)
        if (!existing) {
          // Check legacy key
          const legacyUrl = this.getFileUrl(file, LEGACY_MODEL_REVISION)
          const legacyRes = await cache.match(legacyUrl)
          if (legacyRes && (await this.verifyAssetBlob(file, legacyRes))) {
            await cache.put(canonicalUrl, legacyRes.clone())
            try { await cache.delete(legacyUrl) } catch {}
            existing = legacyRes
          }
        }

        if (existing) {
          const blob = await existing.blob()
          if (blob.size > 0) {
            cumulativeDownloaded += blob.size
            const pct = Math.min(99, Math.round((cumulativeDownloaded / ESTIMATED_MODEL_BYTES) * 100))
            this.updateProgress({ downloadedBytes: cumulativeDownloaded, percent: pct })
            continue
          }
        }

        // Fetch file with streaming progress
        const res = await fetch(canonicalUrl, { signal: abortSignal })
        if (!res.ok) {
          throw new Error(`Failed to download ${file}: HTTP ${res.status} ${res.statusText}`)
        }

        // Validate before committing to cache
        const clone = res.clone()
        const isValid = await this.verifyAssetBlob(file, clone)
        if (!isValid) {
          throw new Error(`Integrity verification failed for newly downloaded ${file}`)
        }

        await cache.put(canonicalUrl, res.clone())

        const blob = await res.blob()
        cumulativeDownloaded += blob.size
        const pct = Math.min(99, Math.round((cumulativeDownloaded / ESTIMATED_MODEL_BYTES) * 100))
        this.updateProgress({ downloadedBytes: cumulativeDownloaded, percent: pct })
      }

      // Final integrity verification
      const complete = await this.verifyCacheIntegrity()
      if (!complete) {
        throw new Error('Model verification failed: one or more assets missing or corrupt')
      }

      this.updateProgress({
        state: 'downloaded',
        downloadedBytes: cumulativeDownloaded,
        totalBytes: cumulativeDownloaded,
        percent: 100,
        currentFile: undefined,
        error: null
      })

      return true
    } catch (err: any) {
      if (abortSignal.aborted || err?.name === 'AbortError') {
        this.updateProgress({ state: 'cancelled', error: 'Download cancelled by user' })
        localAIDiagnostics.record({
          category: 'cache_check',
          success: false,
          errorCategory: 'unknown',
          details: { reason: 'Cancelled by user' }
        })
        return false
      }

      if (err?.name === 'QuotaExceededError' || err?.message?.toLowerCase().includes('quota')) {
        const quotaErr = 'Storage quota exceeded while caching model weights. Free up disk space.'
        this.updateProgress({ state: 'failed', error: quotaErr })
        localAIDiagnostics.record({
          category: 'cache_check',
          success: false,
          errorCategory: 'quota_exceeded',
          details: { error: quotaErr }
        })
        throw new Error(quotaErr)
      }

      this.updateProgress({ state: 'failed', error: err?.message || 'Download failed' })
      localAIDiagnostics.record({
        category: 'cache_check',
        success: false,
        errorCategory: 'network',
        details: { error: err?.message || 'Download failed' }
      })
      throw err
    } finally {
      this.currentAbortController = null
    }
  }

  /**
   * Cancels any active download operation.
   */
  cancelDownload(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort()
      this.currentAbortController = null
      this.updateProgress({ state: 'cancelled', error: 'Download cancelled by user' })
    }
  }

  /**
   * Verifies that all required model assets exist in the cache and are cryptographically valid.
   */
  async verifyCacheIntegrity(): Promise<boolean> {
    const scope: any = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {}))
    if (!scope.caches) return false

    try {
      const cache = await scope.caches.open(CACHE_NAME)
      for (const file of REQUIRED_MODEL_FILES) {
        const canonicalUrl = this.getFileUrl(file, QWEN_MODEL_REVISION)
        const match = await cache.match(canonicalUrl)
        if (!match) return false

        const isValid = await this.verifyAssetBlob(file, match)
        if (!isValid) return false
      }
      return true
    } catch (e) {
      console.warn('[ModelProvisioning] Integrity check error:', e)
      return false
    }
  }

  /**
   * Removes cached model files from CacheStorage to free user storage.
   * Removes both canonical commit SHA keys and legacy main keys.
   */
  async deleteModel(): Promise<void> {
    const scope: any = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {}))
    if (!scope.caches) return

    try {
      const cache = await scope.caches.open(CACHE_NAME)
      for (const file of REQUIRED_MODEL_FILES) {
        await cache.delete(this.getFileUrl(file, QWEN_MODEL_REVISION))
        await cache.delete(this.getFileUrl(file, LEGACY_MODEL_REVISION))
      }
      this.updateProgress({
        state: 'not_downloaded',
        downloadedBytes: 0,
        percent: 0,
        error: null
      })
    } catch (e) {
      console.warn('[ModelProvisioning] Delete error:', e)
    }
  }
}

export const modelProvisioning = ModelProvisioningService.getInstance()
