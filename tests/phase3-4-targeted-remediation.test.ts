import test from 'node:test'
import assert from 'node:assert'
import { generativeRuntime } from '../lib/generative-runtime'
import { modelProvisioning, QWEN_MODEL_REVISION, LEGACY_MODEL_REVISION, EXPECTED_ASSET_METADATA } from '../lib/model-provisioning'
import { executeUITool } from '../lib/ui-tools'
import { createAssistantMessage } from '../lib/messages'
import { voiceAuthorizationManager } from '../lib/audio/voice-authorization-manager'

function mintTestVoiceToken(turnId = 999) {
  voiceAuthorizationManager.setActiveContext({
    userId: 'test_user',
    sessionId: 'test_session',
    turnId
  })
  return voiceAuthorizationManager.mintToken({
    turnId,
    userId: 'test_user',
    sessionId: 'test_session',
    mode: 'UNIVERSAL_VOICE',
    activationMethod: 'PUSH_TO_TALK',
    isPttActive: true
  })
}

test('Remediation F-04: summarizePage handles undeclared scope cleanly without ReferenceError', async () => {
  const originalChrome = (globalThis as any).chrome
  ;(globalThis as any).chrome = {
    tabs: {
      query: async () => [{ id: 101, title: 'Sample Document', url: 'https://example.com' }],
      sendMessage: async () => ({ content: 'This is a sample document for testing summarization.', title: 'Sample Document' })
    },
    scripting: {
      executeScript: async () => [{ result: { success: true, content: 'This is a sample document for testing summarization. It contains multiple sentences and valuable information to be summarized by the local engine.', title: 'Sample Document' } }]
    },
    runtime: { id: 'test_extension_id' }
  }

  try {
    const token = mintTestVoiceToken(101)
    const res = await executeUITool({
      function: 'summarizePage',
      arguments: { type: 'key-points', length: 'short' }
    }, token)

    assert.strictEqual(res.success, true)
    assert.ok(typeof res.result === 'string', 'Should produce valid summary text')
    assert.ok(res.provenance, 'Should include execution provenance')
    assert.strictEqual(res.provenance, 'deterministic')
  } finally {
    ;(globalThis as any).chrome = originalChrome
  }
})

test('Remediation F-05: writeContent passes outputLanguage to scope.Writer.create', async () => {
  let capturedOptions: any = null
  const originalScope = (globalThis as any).self
  ;(globalThis as any).self = {
    Writer: {
      availability: async () => 'available',
      create: async (opts: any) => {
        capturedOptions = opts
        return {
          write: async (task: string) => `Written: ${task}`,
          destroy: () => {}
        }
      }
    }
  }

  try {
    const token = mintTestVoiceToken(102)
    const res = await executeUITool({
      function: 'writeContent',
      arguments: {
        task: 'Draft an invitation',
        outputLanguage: 'es-ES',
        tone: 'formal',
        length: 'short',
        format: 'plain-text'
      }
    }, token)

    assert.strictEqual(res.success, true)
    assert.ok(capturedOptions, 'Writer.create should have received options')
    assert.strictEqual(capturedOptions.outputLanguage, 'es')
    assert.strictEqual(capturedOptions.tone, 'formal')
    assert.strictEqual(res.provenance, 'native')
    assert.strictEqual(res.modelId, 'chrome-native-writer')
  } finally {
    ;(globalThis as any).self = originalScope
  }
})

test('Remediation F-02: Provenance plumbing carries through from tools to messages', async () => {
  // Test native specialist execution
  const msg1 = createAssistantMessage('Translated greeting', 10, false, 'native', 'chrome-translator-en-es')
  assert.strictEqual(msg1.provenance, 'native')
  assert.strictEqual(msg1.modelId, 'chrome-translator-en-es')

  // Test generative execution
  const msg2 = createAssistantMessage('Neural generation from local Qwen', 50, false, 'generative', 'onnx-community/Qwen2.5-0.5B-Instruct')
  assert.strictEqual(msg2.provenance, 'generative')
  assert.strictEqual(msg2.modelId, 'onnx-community/Qwen2.5-0.5B-Instruct')

  // Test deterministic fallback execution
  const msg3 = createAssistantMessage('Extractive TextRank fallback summary', 15, false, 'deterministic', 'pentone-textrank-fallback')
  assert.strictEqual(msg3.provenance, 'deterministic')
  assert.strictEqual(msg3.modelId, 'pentone-textrank-fallback')

  // Test backwards compatibility: messages without provenance default to undefined
  const msgLegacy = createAssistantMessage('Old message without provenance')
  assert.strictEqual(msgLegacy.provenance, undefined)
  assert.strictEqual(msgLegacy.modelId, undefined)
})

test('Remediation F-03: Concurrency-safe model unloading lifecycle', async () => {
  // 1. Initial state
  assert.strictEqual(generativeRuntime.getState().status, 'idle')

  // 2. Simultaneous unload calls return same promise and do not throw
  const p1 = generativeRuntime.unloadModel()
  const p2 = generativeRuntime.unloadModel()
  const [res1, res2] = await Promise.all([p1, p2])
  assert.strictEqual(res1, undefined)
  assert.strictEqual(res2, undefined)
  assert.strictEqual(generativeRuntime.isModelResident(), false)

  // 3. Inference request during unloading transition throws or rejects cleanly
  ;(generativeRuntime as any).isUnloading = true
  await assert.rejects(
    async () => {
      await (generativeRuntime as any).enqueue(async () => 'inference')
    },
    /currently unloading/
  )
  ;(generativeRuntime as any).isUnloading = false

  // 4. State resets cleanly to idle
  assert.strictEqual(generativeRuntime.getState().status, 'idle')
})

test('Remediation F-06: Legacy cache hygiene deletes legacy key only after canonical migration', async () => {
  // Mock CacheStorage
  const mockStorage = new Map<string, any>()
  const mockCache = {
    match: async (url: string) => mockStorage.get(url) || null,
    put: async (url: string, res: any) => { mockStorage.set(url, res) },
    delete: async (url: string) => { mockStorage.delete(url); return true }
  }

  const originalScope = (globalThis as any).self
  ;(globalThis as any).self = {
    caches: {
      open: async () => mockCache
    }
  }

  try {
    const filename = 'config.json'
    const legacyUrl = modelProvisioning.getFileUrl(filename, LEGACY_MODEL_REVISION)
    const canonicalUrl = modelProvisioning.getFileUrl(filename, QWEN_MODEL_REVISION)

    // Bypass subtle.digest in mock to verify migration and deletion flow
    const origVerify = modelProvisioning.verifyAssetBlob
    modelProvisioning.verifyAssetBlob = async (fn: string) => fn === filename

    try {
      mockStorage.set(legacyUrl, new Response('{}', { status: 200 }))

      assert.ok(mockStorage.has(legacyUrl))
      assert.strictEqual(mockStorage.has(canonicalUrl), false)

      await modelProvisioning.checkModelCached()

      assert.ok(mockStorage.has(canonicalUrl), 'Canonical URL must exist after migration')
      assert.strictEqual(mockStorage.has(legacyUrl), false, 'Legacy URL must be purged after verified migration')
    } finally {
      modelProvisioning.verifyAssetBlob = origVerify
    }
  } finally {
    ;(globalThis as any).self = originalScope
  }
})

test('Remediation F-02: All four local AI tools return provenance and modelId through executeUITool', async () => {
  const token1 = mintTestVoiceToken(201)
  const resDetect = await executeUITool({
    function: 'detectLanguage',
    arguments: { text: 'Bonjour tout le monde' }
  }, token1)
  assert.strictEqual(resDetect.success, true)
  assert.strictEqual(typeof resDetect.result, 'string')
  assert.ok(resDetect.provenance, 'detectLanguage must return provenance')
  assert.ok(resDetect.modelId, 'detectLanguage must return modelId')

  const token2 = mintTestVoiceToken(202)
  const resTranslate = await executeUITool({
    function: 'translateText',
    arguments: { text: 'hello', sourceLanguage: 'en', targetLanguage: 'es' }
  }, token2)
  assert.strictEqual(resTranslate.success, true)
  assert.strictEqual(typeof resTranslate.result, 'string')
  assert.ok(resTranslate.provenance, 'translateText must return provenance')
  assert.ok(resTranslate.modelId, 'translateText must return modelId')

  const token3 = mintTestVoiceToken(203)
  const resWrite = await executeUITool({
    function: 'writeContent',
    arguments: { task: 'Write a thank you note' }
  }, token3)
  assert.strictEqual(resWrite.success, true)
  assert.strictEqual(typeof resWrite.result, 'string')
  assert.ok(resWrite.provenance, 'writeContent must return provenance')
  assert.ok(resWrite.modelId, 'writeContent must return modelId')
})

test('Remediation F-01: Inference Worker IPC architecture and fallback', async () => {
  // Test worker bridge lifecycle
  const origWorker = (globalThis as any).Worker
  let workerCreated = false
  let postedMessages: any[] = []

  class MockWorker {
    onmessage: any = null
    onerror: any = null
    constructor() {
      workerCreated = true
    }
    postMessage(msg: any) {
      postedMessages.push(msg)
      if (msg.type === 'INITIALIZE') {
        setTimeout(() => {
          this.onmessage?.({ data: { type: 'INITIALIZED', id: msg.id } })
        }, 1)
      } else if (msg.type === 'GENERATE') {
        setTimeout(() => {
          this.onmessage?.({
            data: {
              type: 'GENERATED',
              id: msg.id,
              result: {
                text: 'Worker generated text',
                generationTimeMs: 150,
                tokenCount: 8,
                tokensPerSec: 53.3,
                modelId: 'onnx-community/Qwen2.5-0.5B-Instruct'
              }
            }
          })
        }, 1)
      } else if (msg.type === 'DISPOSE') {
        setTimeout(() => {
          this.onmessage?.({ data: { type: 'DISPOSED', id: msg.id } })
        }, 1)
      }
    }
    terminate() {}
  }

  const origDoc = (globalThis as any).document
  ;(globalThis as any).Worker = MockWorker as any
  ;(globalThis as any).document = {}

  try {
    const initialized = await generativeRuntime.initializeLocalModel()
    assert.strictEqual(initialized, true)
    assert.strictEqual(workerCreated, true)
    assert.strictEqual(generativeRuntime.isModelResident(), true)

    // Verify off-thread generation via worker IPC
    const genRes = await (generativeRuntime as any).executeLocalGeneration('prompt', { maxTokens: 10 })
    assert.strictEqual(genRes, 'Worker generated text')

    // Verify worker disposal
    await generativeRuntime.unloadModel()
    assert.strictEqual((generativeRuntime as any).worker, null)
    assert.strictEqual(generativeRuntime.isModelResident(), false)
  } finally {
    ;(globalThis as any).Worker = origWorker
    if (origDoc !== undefined) {
      ;(globalThis as any).document = origDoc
    } else {
      delete (globalThis as any).document
    }
  }
})
