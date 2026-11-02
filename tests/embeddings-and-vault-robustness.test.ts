import test from 'node:test'
import assert from 'node:assert'
import {
  generateEmbedding,
  cosineSimilarity,
  EmbeddingModelUnavailableError,
  findSimilarMemories,
  _setEmbedderPipelineForTesting,
  _resetEmbedderPipelineForTesting
} from '../lib/embeddings'

test('Embeddings: generateEmbedding rejects empty or non-string inputs', async () => {
  await assert.rejects(
    async () => await generateEmbedding(''),
    /Text to embed must be a non-empty string/
  )
  await assert.rejects(
    async () => await generateEmbedding(null as any),
    /Text to embed must be a non-empty string/
  )
})

test('Embeddings: Throws EmbeddingModelUnavailableError when initialization fails', async () => {
  _resetEmbedderPipelineForTesting()
  // Mock failing pipeline
  _setEmbedderPipelineForTesting(async () => {
    throw new Error('Native WASM / DirectML context allocation failed')
  })

  await assert.rejects(
    async () => await generateEmbedding('test query'),
    (err: any) => {
      assert(err instanceof EmbeddingModelUnavailableError)
      assert(err.message.includes('Native WASM / DirectML context allocation failed'))
      return true
    }
  )
  _resetEmbedderPipelineForTesting()
})

test('Embeddings: Strictly rejects zero vector output and does NOT return it as valid embedding', async () => {
  _resetEmbedderPipelineForTesting()
  // Mock pipeline returning 384 zero vector
  _setEmbedderPipelineForTesting(async () => ({
    data: new Float32Array(384) // all zeros
  }))

  await assert.rejects(
    async () => await generateEmbedding('sample text'),
    (err: any) => {
      assert(err instanceof EmbeddingModelUnavailableError)
      assert(err.message.includes('invalid, empty, or all zeros'))
      return true
    }
  )
  _resetEmbedderPipelineForTesting()
})

test('Embeddings: Successfully produces normalized embeddings when pipeline is operational', async () => {
  _resetEmbedderPipelineForTesting()
  // Mock valid normalized pipeline output (unit vector)
  const validVector = new Float32Array(384)
  validVector[0] = 0.6
  validVector[1] = 0.8 // norm = sqrt(0.36 + 0.64) = 1.0

  _setEmbedderPipelineForTesting(async () => ({
    data: validVector
  }))

  const embedding = await generateEmbedding('Pentone AI Navigation')
  assert.strictEqual(embedding.length, 384)
  assert(Math.abs(embedding[0] - 0.6) < 1e-6)
  assert(Math.abs(embedding[1] - 0.8) < 1e-6)
  _resetEmbedderPipelineForTesting()
})

test('Embeddings: cosineSimilarity returns 0 for all-zero vectors and never NaN', () => {
  const zeroVec = new Array(384).fill(0)
  const nonZeroVec = new Array(384).fill(0)
  nonZeroVec[0] = 1

  // Test zero vs nonZero
  const sim1 = cosineSimilarity(zeroVec, nonZeroVec)
  assert.strictEqual(sim1, 0, 'Zero vector must produce similarity 0')
  assert(!isNaN(sim1), 'Similarity must not be NaN')

  // Test zero vs zero
  const sim2 = cosineSimilarity(zeroVec, zeroVec)
  assert.strictEqual(sim2, 0, 'Zero vs zero must produce 0, never NaN')
  assert(!isNaN(sim2), 'Similarity must not be NaN')
})

test('Embeddings: cosineSimilarity calculates exact cosine metric for normalized vectors', () => {
  const vecA = [1, 0, 0]
  const vecB = [1, 0, 0]
  const vecC = [0, 1, 0]
  const vecD = [-1, 0, 0]

  assert.strictEqual(cosineSimilarity(vecA, vecB), 1)
  assert.strictEqual(cosineSimilarity(vecA, vecC), 0)
  assert.strictEqual(cosineSimilarity(vecA, vecD), -1)
})

test('Embeddings: cosineSimilarity rejects dimensional mismatch', () => {
  assert.throws(() => {
    cosineSimilarity([1, 2], [1, 2, 3])
  }, /Embeddings must have same non-zero dimensions/)
})

test('Embeddings: findSimilarMemories ignores invalid or zero embeddings', async () => {
  _resetEmbedderPipelineForTesting()
  const validQueryVector = new Float32Array(3)
  validQueryVector[0] = 1

  _setEmbedderPipelineForTesting(async () => ({
    data: validQueryVector
  }))

  const memories = [
    { id: '1', text: 'zero', embedding: [0, 0, 0] },
    { id: '2', text: 'match', embedding: [0.9, 0.1, 0] },
    { id: '3', text: 'no-embed' }
  ]

  const matches = await findSimilarMemories('query', memories, 5, 0.2)
  assert.strictEqual(matches.length, 1)
  assert.strictEqual(matches[0].memory.id, '2')
  _resetEmbedderPipelineForTesting()
})
