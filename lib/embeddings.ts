// Embedding utilities for semantic search

// Custom error class for unavailable or failed embedding model operations
export class EmbeddingModelUnavailableError extends Error {
  constructor(message: string, public cause?: any) {
    super(message)
    this.name = 'EmbeddingModelUnavailableError'
  }
}

let pipeline: any = null
let env: any = null
let embedderPipeline: any = null

// Initialize the embedding model lazily
async function getEmbedder() {
  if (!embedderPipeline) {
    if (!pipeline) {
      try {
        const transformers = await import('@xenova/transformers')
        pipeline = transformers.pipeline
        env = transformers.env
        if (env) {
          env.allowLocalModels = false
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
      console.log('[Embeddings] Loading model...')
      embedderPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
      console.log('[Embeddings] Model loaded!')
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
  try {
    const embedder = await getEmbedder()
    const output = await embedder(text, { pooling: 'mean', normalize: true })
    const embedding = Array.from(output.data as Float32Array)

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
    console.error('[Embeddings] Error generating embedding:', error)
    if (error instanceof EmbeddingModelUnavailableError) {
      throw error
    }
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
