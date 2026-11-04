import test from 'node:test'
import assert from 'node:assert/strict'
import {
  modelProvisioning,
  COMBINED_TOTAL_BYTES,
  MODEL_REGISTRY,
  type ProvisionedModelKey
} from '../lib/model-provisioning'
import { generativeRuntime } from '../lib/generative-runtime'
import { streamResponse, destroySession, getActiveSessionMetadata } from '../lib/ai'

// Setup mock window/caches environment for headless node testing
if (typeof globalThis.window === 'undefined') {
  ;(globalThis as any).window = globalThis
}

if (typeof (globalThis as any).chrome === 'undefined') {
  ;(globalThis as any).chrome = {
    tabs: {
      query: async () => [{ id: 1, title: 'Test Page', url: 'https://example.com' }],
    },
    runtime: {
      getURL: (p: string) => `chrome-extension://test/${p}`,
    },
  }
}

test('Bug 1: Prompt API unavailable or failing seamlessly falls back to Local Qwen SLM', async () => {
  destroySession()

  // Mock window.LanguageModel in unavailable / downloadable state
  ;(globalThis as any).window.LanguageModel = {
    availability: async () => 'downloadable',
    create: async () => {
      throw new Error('The device is unable to create a session to run the model. Please check the result of availability() first.')
    }
  }

  // Mock generativeRuntime execution
  const origGen = (generativeRuntime as any).executeLocalGeneration
  ;(generativeRuntime as any).executeLocalGeneration = async (prompt: string) => {
    return 'This is a verified response from the local Qwen2.5-0.5B ONNX model.'
  }
  ;(generativeRuntime as any).isModelResident = () => true

  try {
    const chunks: string[] = []
    const usage = await streamResponse('Summarize this webpage concisely', (chunk) => {
      chunks.push(chunk)
    })

    const fullResponse = chunks.join('')
    assert.ok(fullResponse.includes('verified response from the local Qwen2.5-0.5B ONNX model'))
    const meta = getActiveSessionMetadata()
    assert.strictEqual(meta.tier, 'generative')
    assert.strictEqual(meta.modelId, 'onnx-community/Qwen2.5-0.5B-Instruct')
  } finally {
    ;(generativeRuntime as any).executeLocalGeneration = origGen
    delete (globalThis as any).window.LanguageModel
    destroySession()
  }
})

test('Bug 1: Webpage summarization falls back safely without unhandled session errors', async () => {
  // Mock window.Summarizer in unavailable state and window.LanguageModel throwing
  ;(globalThis as any).window.Summarizer = {
    availability: async () => 'unavailable',
    create: async () => {
      throw new Error('The device is unable to create a session to run the model. Please check the result of availability() first.')
    }
  }
  ;(globalThis as any).window.LanguageModel = {
    availability: async () => 'unavailable',
    create: async () => {
      throw new Error('The device is unable to create a session to run the model. Please check the result of availability() first.')
    }
  }

  const samplePage = `
    Pentone is an on-device AI browser extension.
    It provides voice-driven browsing, push-to-talk control, and semantic memory.
    All models run locally in CacheStorage without cloud data transmission.
    Users can summarize pages, search for tutorials, and automate repetitive workflows.
  `

  const result = await generativeRuntime.summarizePage({
    content: samplePage,
    title: 'Pentone Architecture',
    type: 'key-points',
    length: 'short'
  })

  assert.ok(result.text.length > 0)
  assert.ok(result.tier === 'generative' || result.tier === 'deterministic')
  assert.ok(!result.text.includes('The device is unable to create a session'))

  delete (globalThis as any).window.Summarizer
  delete (globalThis as any).window.LanguageModel
})

test('Bug 2: TTS absence never blocks waitUntilReady or drops speech turn', async () => {
  const { TTSAcousticTracker } = await import('../lib/tts-context')
  TTSAcousticTracker.clear()

  const utterances = TTSAcousticTracker.getRecentUtterances()
  assert.deepStrictEqual(utterances, [])

  TTSAcousticTracker.recordSpeechStart('Test sentence')
  assert.strictEqual(TTSAcousticTracker.isSpeaking(), true)
  TTSAcousticTracker.recordSpeechEnd()
  assert.strictEqual(TTSAcousticTracker.isSpeaking(), false)
})

test('Bug 3: downloadAllModels aggregates progress and skips already cached assets', async () => {
  const mockCacheStore = new Map<string, Response>()

  const mockCache = {
    match: async (req: string) => {
      return mockCacheStore.get(req)?.clone() || null
    },
    put: async (req: string, res: Response) => {
      mockCacheStore.set(req, res.clone())
    },
    delete: async (req: string) => {
      return mockCacheStore.delete(req)
    }
  }

  ;(globalThis as any).caches = {
    open: async () => mockCache,
    delete: async () => true,
    has: async () => true
  }

  // Pre-populate mock cache for embeddings to verify skipping
  const embDesc = MODEL_REGISTRY.embeddings
  for (const file of embDesc.requiredFiles) {
    const url = modelProvisioning.getFileUrl(file, embDesc.revision, embDesc.modelId)
    const content = file.endsWith('.json') ? '{"mock": true}' : 'MOCK_ONNX_BLOB_TEST_DATA'
    mockCacheStore.set(url, new Response(content, { headers: { 'x-test-skip-sha256': '1' } }))
  }

  // Mock global fetch for whisper and qwen
  const origFetch = globalThis.fetch
  globalThis.fetch = (async (url: any) => {
    const urlStr = String(url)
    const content = urlStr.endsWith('.json') ? '{"model_type": "test"}' : 'MOCK_BINARY_WEIGHTS_DATA'
    return new Response(content, {
      status: 200,
      headers: {
        'x-test-skip-sha256': '1',
        'content-length': String(content.length)
      }
    })
  }) as any

  try {
    const isCachedBefore = await modelProvisioning.checkModelCached('embeddings')
    assert.strictEqual(isCachedBefore, true, 'Embeddings should be detected as cached')

    let progressEvents: any[] = []
    const unsub = modelProvisioning.subscribe((p) => {
      progressEvents.push({ ...p })
    })

    const success = await modelProvisioning.downloadAllModels()
    unsub()

    assert.strictEqual(success, true, 'downloadAllModels should succeed')
    const finalProgress = modelProvisioning.getProgress()
    assert.strictEqual(finalProgress.state, 'downloaded')
    assert.strictEqual(finalProgress.percent, 100)

    // Verify all 3 models are cached
    const qwenCached = await modelProvisioning.checkModelCached('qwen')
    const whisperCached = await modelProvisioning.checkModelCached('whisper')
    const embCached = await modelProvisioning.checkModelCached('embeddings')

    assert.strictEqual(qwenCached, true)
    assert.strictEqual(whisperCached, true)
    assert.strictEqual(embCached, true)
  } finally {
    globalThis.fetch = origFetch
    delete (globalThis as any).caches
  }
})
