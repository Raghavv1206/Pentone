// Embedding utilities for semantic search and vector retrieval (RAG)
import { modelProvisioning, EMBEDDINGS_MODEL_ID, EMBEDDINGS_MODEL_REVISION } from './model-provisioning'

// Custom error class for unavailable or failed embedding model operations
export class EmbeddingModelUnavailableError extends Error {
  constructor(message: string, public cause?: any) {
    super(message)
    this.name = 'EmbeddingModelUnavailableError'
  }
}

export const EXPECTED_EMBEDDING_DIM = 384

let pipeline: any = null
let env: any = null
let embedderPipeline: any = null

/**
 * Checks whether the embedding pipeline is warm and resident in memory.
 */
export function isEmbeddingModelReady(): boolean {
  return embedderPipeline !== null
}

/**
 * Inspects CacheStorage to verify whether embedding assets are cached and intact.
 */
export async function checkEmbeddingModelProvisioned(): Promise<boolean> {
  return modelProvisioning.checkModelCached('embeddings')
}

/**
 * Detects whether execution is within a Manifest V3 ServiceWorkerGlobalScope.
 * Under MV3 Service Workers, dynamic module imports and async importScripts are disallowed
 * by the HTML specification, so model computation is delegated to an active UI context.
 */
export function isServiceWorkerEnvironment(): boolean {
  if (typeof window === 'undefined') {
    if (typeof ServiceWorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof ServiceWorkerGlobalScope) {
      return true
    }
    if (typeof self !== 'undefined' && (self as any).clients && typeof (self as any).skipWaiting === 'function') {
      return true
    }
  }
  return false
}

/**
 * Delegates embedding generation from a Background Service Worker to an active Pentone UI context (e.g. Sidepanel).
 */
async function delegateEmbeddingToUI(text: string): Promise<number[]> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    throw new EmbeddingModelUnavailableError(
      'Service Worker cannot compute embeddings directly and chrome.runtime is unavailable'
    )
  }

  return new Promise<number[]>((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: 'compute_embedding_in_ui',
      payload: { text }
    }, (response) => {
      if (chrome.runtime.lastError) {
        const msg = chrome.runtime.lastError.message || ''
        reject(new EmbeddingModelUnavailableError(
          `Embedding computation requires an active Pentone sidepanel UI: ${msg}`,
          chrome.runtime.lastError
        ))
        return
      }

      if (!response || !response.success || !Array.isArray(response.embedding)) {
        reject(new EmbeddingModelUnavailableError(
          response?.error || 'Failed to compute embedding in UI context'
        ))
        return
      }

      resolve(response.embedding)
    })
  })
}

// Initialize the embedding model lazily from local CacheStorage
async function getEmbedder() {
  if (!embedderPipeline) {
    // Check local provisioning status before initialization
    const isProvisioned = await modelProvisioning.checkModelCached('embeddings')
    if (!isProvisioned) {
      throw new EmbeddingModelUnavailableError(
        'Embedding model assets are not provisioned in local cache. Please download in Settings.'
      )
    }

    if (!pipeline) {
      try {
        const transformers = await import('@xenova/transformers')
        pipeline = transformers.pipeline
        env = transformers.env
        if (env) {
          // Local-only browser cache configuration: allowLocalModels = true allows CacheStorage lookup
          // while allowRemoteModels = false strictly prohibits remote network egress
          env.allowLocalModels = true
          env.allowRemoteModels = false
          env.useBrowserCache = true
          if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
            env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('assets/')
          }
          env.backends.onnx.wasm.numThreads = 1
          env.backends.onnx.wasm.proxy = false
        }
      } catch (e: any) {
        throw new EmbeddingModelUnavailableError(
          `Embedding model runtime unavailable: ${e?.message || 'Transformers.js could not be loaded in this environment'}`,
          e
        )
      }
    }
    try {
      console.log('[Embeddings] Loading model from local cache...')
      embedderPipeline = await pipeline('feature-extraction', EMBEDDINGS_MODEL_ID, {
        quantized: true,
        revision: EMBEDDINGS_MODEL_REVISION
      })
      console.log('[Embeddings] Model loaded successfully!')
    } catch (modelErr: any) {
      throw new EmbeddingModelUnavailableError(
        `Failed to initialize feature-extraction pipeline: ${modelErr?.message || modelErr}`,
        modelErr
      )
    }
  }
  return embedderPipeline
}

// Generate embedding for text
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text || typeof text !== 'string') {
    throw new Error('Text to embed must be a non-empty string')
  }

  // Under MV3 Service Workers, dynamic module imports are disallowed.
  // Delegate the embedding generation to the active UI window (Sidepanel) via IPC.
  if (isServiceWorkerEnvironment()) {
    return delegateEmbeddingToUI(text)
  }

  try {
    const embedder = await getEmbedder()
    const output = await embedder(text, { pooling: 'mean', normalize: true })
    const embedding = Array.from(output.data as Float32Array)

    // Strict 384-dimensional contract enforcement
    if (embedding.length !== EXPECTED_EMBEDDING_DIM) {
      throw new EmbeddingModelUnavailableError(
        `Invalid embedding dimensionality: expected ${EXPECTED_EMBEDDING_DIM}, got ${embedding.length}`
      )
    }

    // Validate embedding is non-empty, non-zero, and contains valid numbers
    let magnitudeSq = 0
    for (let i = 0; i < embedding.length; i++) {
      magnitudeSq += embedding[i] * embedding[i]
    }
    if (embedding.length === 0 || magnitudeSq === 0 || isNaN(magnitudeSq)) {
      throw new EmbeddingModelUnavailableError('Generated embedding vector is invalid, empty, or all zeros')
    }

    return embedding
  } catch (error: any) {
    if (error instanceof EmbeddingModelUnavailableError) {
      console.warn('[Embeddings] Embedding model unavailable:', error.message)
      throw error
    }
    console.error('[Embeddings] Error generating embedding:', error)
    throw new EmbeddingModelUnavailableError(
      `Embedding generation failed: ${error?.message || error}`,
      error
    )
  }
}

// Calculate cosine similarity between two embeddings
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
    throw new Error('Embeddings must have same non-zero dimensions')
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const magnitudeA = Math.sqrt(normA)
  const magnitudeB = Math.sqrt(normB)

  if (magnitudeA === 0 || magnitudeB === 0 || isNaN(dotProduct)) {
    return 0 // Never treat zero or invalid vectors as valid semantic matches
  }

  return dotProduct / (magnitudeA * magnitudeB)
}

// Find most similar memories to a query
export async function findSimilarMemories(
  queryText: string,
  memories: any[],
  limit: number = 5,
  threshold: number = 0.3
): Promise<Array<{ memory: any; similarity: number }>> {
  try {
    // Generate embedding for query
    const queryEmbedding = await generateEmbedding(queryText)

    // Filter memories that have embeddings
    const memoriesWithEmbeddings = memories.filter(m => m.embedding && Array.isArray(m.embedding))

    if (memoriesWithEmbeddings.length === 0) {
      console.log('[Embeddings] No memories with embeddings found')
      return []
    }

    // Calculate similarity for each memory
    const results = memoriesWithEmbeddings.map(memory => ({
      memory,
      similarity: cosineSimilarity(queryEmbedding, memory.embedding)
    }))

    // Sort by similarity (highest first)
    results.sort((a, b) => b.similarity - a.similarity)

    // Filter by threshold and limit
    return results
      .filter(r => r.similarity >= threshold)
      .slice(0, limit)
  } catch (error) {
    console.error('[Embeddings] Error finding similar memories:', error)
    throw error
  }
}

// Test-only hooks to verify fallback, errors, and vector validation without altering production paths
export function _setEmbedderPipelineForTesting(p: any): void {
  embedderPipeline = p
}

export function _resetEmbedderPipelineForTesting(): void {
  embedderPipeline = null
  pipeline = null
  env = null
}

export const resetEmbeddingPipeline = _resetEmbedderPipelineForTesting
