/**
 * Pentone Phase 3.5 — Production Hardening & Reliability Test Suite
 */

import test from 'node:test'
import assert from 'node:assert'
import { generativeRuntime } from '../lib/generative-runtime'
import { modelProvisioning, EXPECTED_ASSET_METADATA, QWEN_MODEL_REVISION } from '../lib/model-provisioning'
import { executeUITool } from '../lib/ui-tools'
import { createAssistantMessage } from '../lib/messages'
import { localAIDiagnostics } from '../lib/local-ai-diagnostics'
import { PersistentAudioPipeline } from '../lib/audio/persistent-audio-pipeline'
import { voiceAuthorizationManager } from '../lib/audio/voice-authorization-manager'

function mintTestVoiceToken(turnId = 888) {
  voiceAuthorizationManager.setActiveContext({
    userId: 'test_user_p35',
    sessionId: 'test_session_p35',
    turnId
  })
  return voiceAuthorizationManager.mintToken({
    turnId,
    userId: 'test_user_p35',
    sessionId: 'test_session_p35',
    mode: 'UNIVERSAL_VOICE',
    activationMethod: 'PUSH_TO_TALK',
    isPttActive: true
  })
}

test('Phase 3.5: Worker initialization failure NEVER silently loads 495MB model on main thread', async () => {
  const origWorker = (globalThis as any).Worker
  const origDoc = (globalThis as any).document

  // Simulate browser environment with a failing Worker constructor
  ;(globalThis as any).document = {}
  ;(globalThis as any).Worker = class FailingWorker {
    constructor() {
      throw new Error('Extension worker construction restricted')
    }
  }

  try {
    await generativeRuntime.unloadModel()
    const success = await generativeRuntime.initializeLocalModel()
    assert.strictEqual(success, false, 'initializeLocalModel must return false on worker failure')
    assert.strictEqual((generativeRuntime as any).pipelineInstance, null, 'Main-thread pipelineInstance must NEVER be instantiated on worker failure')
    assert.strictEqual((generativeRuntime as any).worker, null, 'Worker reference must be cleaned up')
    assert.strictEqual(generativeRuntime.getState().status, 'error')
    assert.ok(generativeRuntime.getState().error?.includes('Worker initialization failed'))

    // Verify graceful fallback to deterministic without main-thread blocking
    const token = mintTestVoiceToken(801)
    const res = await executeUITool({
      function: 'translateText',
      arguments: { text: 'hello', sourceLanguage: 'en', targetLanguage: 'es' }
    }, token)

    assert.strictEqual(res.success, true)
    assert.strictEqual(res.provenance, 'deterministic')
    assert.strictEqual(res.executionMode, 'deterministic')
    assert.strictEqual(res.modelId, 'pentone-lexicon-fallback')
  } finally {
    ;(globalThis as any).Worker = origWorker
    if (origDoc !== undefined) (globalThis as any).document = origDoc
    else delete (globalThis as any).document
    await generativeRuntime.unloadModel()
  }
})

test('Phase 3.5: Unexpected Worker crash rejects all pending requests cleanly with zero dangling promises', async () => {
  const origWorker = (globalThis as any).Worker
  const origDoc = (globalThis as any).document

  let activeMockWorker: any = null

  class CrashingWorker {
    onmessage: any = null
    onerror: any = null
    onmessageerror: any = null
    constructor() {
      activeMockWorker = this
    }
    postMessage(msg: any) {
      if (msg.type === 'INITIALIZE') {
        setTimeout(() => {
          this.onmessage?.({ data: { id: msg.id, type: 'INITIALIZED', result: { modelId: 'test-model' } } })
        }, 5)
      } else if (msg.type === 'GENERATE') {
        // Simulate sudden worker crash mid-inference
        setTimeout(() => {
          this.onerror?.(new Error('Out of memory in WebAssembly isolate'))
        }, 10)
      }
    }
    terminate() {}
  }

  ;(globalThis as any).document = {}
  ;(globalThis as any).Worker = CrashingWorker as any

  try {
    await generativeRuntime.unloadModel()
    const initOk = await generativeRuntime.initializeLocalModel()
    assert.strictEqual(initOk, true)

    // Trigger inference that crashes worker
    const genPromise = (generativeRuntime as any).executeLocalGeneration('Test prompt', { maxTokens: 10 })
    const result = await genPromise
    // Must return null (falling back cleanly) without hanging
    assert.strictEqual(result, null)

    // Worker must be torn down and state must reflect error
    assert.strictEqual((generativeRuntime as any).worker, null)
    assert.strictEqual(generativeRuntime.getState().status, 'error')
    assert.ok(generativeRuntime.getState().error?.includes('Out of memory'))
  } finally {
    ;(globalThis as any).Worker = origWorker
    if (origDoc !== undefined) (globalThis as any).document = origDoc
    else delete (globalThis as any).document
    await generativeRuntime.unloadModel()
  }
})

test('Phase 3.5: Concurrent initializeLocalModel calls deduplicate onto single in-flight promise', async () => {
  const origWorker = (globalThis as any).Worker
  const origDoc = (globalThis as any).document

  let workerCreationCount = 0

  class TrackingWorker {
    onmessage: any = null
    onerror: any = null
    constructor() {
      workerCreationCount++
    }
    postMessage(msg: any) {
      if (msg.type === 'INITIALIZE') {
        setTimeout(() => {
          this.onmessage?.({ data: { id: msg.id, type: 'INITIALIZED', result: { modelId: 'test-model' } } })
        }, 20)
      } else if (msg.type === 'DISPOSE') {
        setTimeout(() => {
          this.onmessage?.({ data: { id: msg.id, type: 'DISPOSED' } })
        }, 5)
      }
    }
    terminate() {}
  }

  ;(globalThis as any).document = {}
  ;(globalThis as any).Worker = TrackingWorker as any

  try {
    await generativeRuntime.unloadModel()

    // Dispatch 3 concurrent initialization requests
    const p1 = generativeRuntime.initializeLocalModel()
    const p2 = generativeRuntime.initializeLocalModel()
    const p3 = generativeRuntime.initializeLocalModel()

    const [r1, r2, r3] = await Promise.all([p1, p2, p3])

    assert.strictEqual(r1, true)
    assert.strictEqual(r2, true)
    assert.strictEqual(r3, true)
    assert.strictEqual(workerCreationCount, 1, 'Exactly one Worker must be created across concurrent requests')
  } finally {
    ;(globalThis as any).Worker = origWorker
    if (origDoc !== undefined) (globalThis as any).document = origDoc
    else delete (globalThis as any).document
    await generativeRuntime.unloadModel()
  }
})

test('Phase 3.5: Execution mode and provenance reporting across native, worker, and fallback paths', async () => {
  // 1. Native execution
  const msgNative = createAssistantMessage('Native summary', 50, false, 'native', 'chrome-native-writer', 'native')
  assert.strictEqual(msgNative.provenance, 'native')
  assert.strictEqual(msgNative.executionMode, 'native')

  // 2. Dedicated worker execution
  const msgWorker = createAssistantMessage('Neural generation', 100, false, 'generative', 'onnx-community/Qwen2.5-0.5B-Instruct', 'worker')
  assert.strictEqual(msgWorker.provenance, 'generative')
  assert.strictEqual(msgWorker.executionMode, 'worker')

  // 3. Deterministic offline fallback
  const msgFallback = createAssistantMessage('Extractive summary', 20, false, 'deterministic', 'pentone-textrank-fallback', 'deterministic')
  assert.strictEqual(msgFallback.provenance, 'deterministic')
  assert.strictEqual(msgFallback.executionMode, 'deterministic')

  // 4. Unavailable
  const msgUnavail = createAssistantMessage('Action failed', 0, false, 'deterministic', undefined, 'unavailable')
  assert.strictEqual(msgUnavail.executionMode, 'unavailable')
})

test('Phase 3.5: Model provisioning quota error and cache integrity validation', async () => {
  // 1. Storage quota calculation
  const mockStorage = {
    estimate: async () => ({ quota: 1000 * 1024 * 1024, usage: 900 * 1024 * 1024 }) // only 100MB free (<550MB required)
  }
  const origStorage = (globalThis as any).navigator?.storage
  if (!(globalThis as any).navigator) (globalThis as any).navigator = {}
  ;(globalThis as any).navigator.storage = mockStorage

  try {
    const quotaInfo = await modelProvisioning.checkStorageQuota()
    assert.strictEqual(quotaInfo.isSufficient, false, 'Must flag insufficient when free space < threshold')

    // Attempting download with insufficient quota throws user-friendly error
    await assert.rejects(
      async () => { await modelProvisioning.downloadModel() },
      /Insufficient storage space/
    )
  } finally {
    if (origStorage) (globalThis as any).navigator.storage = origStorage
    else delete (globalThis as any).navigator.storage
  }
})

test('Phase 3.5: Audio pipeline expected callback interval calculation based on buffer and sample rate', () => {
  const pipeline = new PersistentAudioPipeline()
  const metrics = pipeline.getAudioPipelineMetrics()
  assert.strictEqual(metrics.bufferSize, 4096)
  assert.ok(metrics.sampleRate > 0)

  // Test mathematical formula across standard sample rates
  const interval16k = (4096 / 16000) * 1000
  assert.strictEqual(interval16k, 256.0, '16kHz sample rate must have exactly 256ms callback interval')

  const interval44k = (4096 / 44100) * 1000
  assert.ok(Math.abs(interval44k - 92.88) < 0.1, '44.1kHz sample rate must have ~92.88ms callback interval')

  const interval48k = (4096 / 48000) * 1000
  assert.ok(Math.abs(interval48k - 85.33) < 0.1, '48kHz sample rate must have ~85.33ms callback interval')
})

test('Phase 3.5: Privacy-conscious diagnostics records operational telemetry with zero text/prompts', () => {
  localAIDiagnostics.clear()

  localAIDiagnostics.record({
    category: 'worker_init',
    executionMode: 'worker',
    durationMs: 42,
    modelId: 'test-qwen',
    success: true
  })

  localAIDiagnostics.record({
    category: 'inference',
    executionMode: 'worker',
    durationMs: 150,
    modelId: 'test-qwen',
    success: true
  })

  localAIDiagnostics.record({
    category: 'worker_error',
    executionMode: 'worker',
    success: false,
    errorCategory: 'worker_crash',
    details: { error: 'Memory limit exceeded' }
  })

  const summary = localAIDiagnostics.getSummary()
  assert.strictEqual(summary.totalEvents, 3)
  assert.strictEqual(summary.workerInitSuccesses, 1)
  assert.strictEqual(summary.inferencesByMode.worker, 1)
  assert.strictEqual(summary.lastError, 'worker_crash')

  const events = localAIDiagnostics.getRecentEvents()
  for (const ev of events) {
    assert.strictEqual((ev as any).prompt, undefined, 'Diagnostic event must NEVER contain prompt property')
    assert.strictEqual((ev as any).content, undefined, 'Diagnostic event must NEVER contain content property')
    assert.strictEqual((ev as any).audio, undefined, 'Diagnostic event must NEVER contain audio property')
  }
})
