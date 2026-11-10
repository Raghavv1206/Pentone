// Embedding utilities for semantic search
import './suppress-warnings'
import { pipeline, env } from '@xenova/transformers'

export const EXPECTED_EMBEDDING_DIM = 384

// Configure Transformers.js for browser extension
env.allowLocalModels = false
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.numThreads = 1
  env.backends.onnx.wasm.proxy = false
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('assets/ort-wasm/')
  }
}

// Singleton pipeline to avoid re-loading model
let embedderPipeline: any = null
let embedderPromise: Promise<any> | null = null
const progressListeners = new Set<(progress: number) => void>()

// Initialize the embedding model
async function getEmbedder() {
  if (embedderPipeline) return embedderPipeline
  if (!embedderPromise) {
    embedderPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      progress_callback: (event: any) => {
        if (event.status === 'progress' && Number.isFinite(event.progress)) {
          for (const listener of progressListeners) listener(Math.round(Math.max(0, Math.min(100, event.progress))))
        }
      }
    })
      .then(instance => { embedderPipeline = instance; return instance })
      .finally(() => { embedderPromise = null })
  }
  return embedderPromise
}

// Reuse the normal runtime pipeline, so setup and the first query do not load
// separate copies. Exercise inference before reporting successful preparation.
export async function prepareEmbeddings(onProgress: (progress: number) => void, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const unsubscribe = () => progressListeners.delete(onProgress)
  signal?.addEventListener('abort', unsubscribe, { once: true })
  progressListeners.add(onProgress)
  try {
    const embedder = await getEmbedder()
    signal?.throwIfAborted()
    const result = await embedder('Pentone setup', { pooling: 'mean', normalize: true })
    signal?.throwIfAborted()
    if (result.data?.length !== EXPECTED_EMBEDDING_DIM) throw new Error('The embedding model did not produce a valid vector.')
    onProgress(100)
  } finally { unsubscribe(); signal?.removeEventListener('abort', unsubscribe) }
}

// Proactively preload the embeddings model on startup
export async function preloadEmbedder(): Promise<boolean> {
  try {
    await getEmbedder()
    return true
  } catch (error) {
    console.log('[Embeddings] Preload notice (will initialize on first query):', error)
    return false
  }
}

// Generate embedding for text
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const embedder = await getEmbedder()
    const output = await embedder(text, { pooling: 'mean', normalize: true })
    return Array.from(output.data as Float32Array)
  } catch (error) {
    console.error('[Embeddings] Error generating embedding:', error)
    throw error
  }
}

// Calculate cosine similarity between two embeddings
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have same dimensions')
  }
  
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0)
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0))
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0))
  
  return magnitudeA && magnitudeB ? dotProduct / (magnitudeA * magnitudeB) : 0
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
