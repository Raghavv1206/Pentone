import { test, expect, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ pipeline: vi.fn() }))
vi.mock('@xenova/transformers', () => ({ pipeline: mocks.pipeline, env: {} }))
import { preloadEmbedder, generateEmbedding, cosineSimilarity } from '../lib/embeddings'
test('failed embedding initialization retries, and 100 concurrent requests share the retry', async () => {
  mocks.pipeline.mockRejectedValueOnce(new Error('Model download unavailable'))
  expect(await preloadEmbedder()).toBe(false)
  const embedder = vi.fn(async () => ({ data: new Float32Array([1, 0, 0]) }))
  mocks.pipeline.mockResolvedValue(embedder)
  const vectors = await Promise.all(Array.from({ length: 100 }, () => generateEmbedding('test')))
  expect(mocks.pipeline).toHaveBeenCalledTimes(2)
  expect(vectors).toHaveLength(100); expect(vectors[0]).toEqual([1, 0, 0])
  expect(cosineSimilarity([0, 0], [0, 0])).toBe(0)
  expect(cosineSimilarity([1, 0], [1, 0])).toBe(1)
})
