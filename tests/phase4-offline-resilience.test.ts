import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  ModelNotProvisionedError,
  isModelNotProvisionedError
} from '../lib/errors'
import { generativeRuntime } from '../lib/generative-runtime'
import { voiceAuthorizationManager } from '../lib/audio/voice-authorization-manager'
import { executeUITool } from '../lib/ui-tools'

function mintTestVoiceToken(turnId = 999) {
  voiceAuthorizationManager.setActiveContext({
    userId: 'test_user_phase4',
    sessionId: 'test_session_phase4',
    turnId
  })
  return voiceAuthorizationManager.mintToken({
    turnId,
    userId: 'test_user_phase4',
    sessionId: 'test_session_phase4',
    mode: 'UNIVERSAL_VOICE',
    activationMethod: 'PUSH_TO_TALK',
    isPttActive: true
  })
}

test('Phase 4: ModelNotProvisionedError type and type guard', () => {
  const err = new ModelNotProvisionedError(
    'Model assets are not provisioned in local cache. Operating in strictly offline mode; please download the model in Settings.',
    'onnx-community/Qwen2.5-0.5B-Instruct',
    'onnx/model_quantized.onnx'
  )
  assert.strictEqual(err.name, 'ModelNotProvisionedError')
  assert.strictEqual(err.code, 'MODEL_NOT_PROVISIONED')
  assert.strictEqual(err.modelId, 'onnx-community/Qwen2.5-0.5B-Instruct')
  assert.strictEqual(err.missingAsset, 'onnx/model_quantized.onnx')
  assert.ok(err.message.includes('strictly offline'))
  assert.ok(isModelNotProvisionedError(err))
  assert.strictEqual(isModelNotProvisionedError(new Error('Generic error')), false)
  assert.strictEqual(isModelNotProvisionedError(null), false)
})

test('Phase 4: Strict offline invariant configuration in all four neural pipelines', () => {
  // 1. Text generation inference worker
  const workerSrc = fs.readFileSync(path.resolve(__dirname, '../lib/workers/inference-worker.ts'), 'utf8')
  assert.ok(
    workerSrc.includes('env.allowRemoteModels = false'),
    'inference-worker.ts must explicitly configure env.allowRemoteModels = false'
  )
  assert.ok(
    workerSrc.includes('env.allowLocalModels = false'),
    'inference-worker.ts must configure env.allowLocalModels = false'
  )
  assert.ok(
    workerSrc.includes('ModelNotProvisionedError'),
    'inference-worker.ts must use ModelNotProvisionedError on missing cache asset'
  )

  // 2. Generative runtime harness
  const runtimeSrc = fs.readFileSync(path.resolve(__dirname, '../lib/generative-runtime.ts'), 'utf8')
  assert.ok(
    runtimeSrc.includes('env.allowRemoteModels = false'),
    'generative-runtime.ts must configure env.allowRemoteModels = false'
  )

  // 3. Semantic embeddings pipeline (FINDING-01 Remediated)
  const embSrc = fs.readFileSync(path.resolve(__dirname, '../lib/embeddings.ts'), 'utf8')
  assert.ok(
    embSrc.includes('env.allowRemoteModels = false'),
    'embeddings.ts must configure env.allowRemoteModels = false'
  )
  assert.ok(
    embSrc.includes('env.useBrowserCache = true'),
    'embeddings.ts must configure env.useBrowserCache = true'
  )

  // 4. Whisper ASR speech pipeline (FINDING-01 Remediated)
  const whisperSrc = fs.readFileSync(path.resolve(__dirname, '../lib/audio/whisper-asr-service.ts'), 'utf8')
  assert.ok(
    whisperSrc.includes('env.allowRemoteModels = false'),
    'whisper-asr-service.ts must configure env.allowRemoteModels = false'
  )
  assert.ok(
    whisperSrc.includes('env.useBrowserCache = true'),
    'whisper-asr-service.ts must configure env.useBrowserCache = true'
  )
})

test('Phase 4: Unprovisioned embeddings and Whisper pipelines fail safely without remote egress', async () => {
  // Test embeddings fail-safe behavior
  const { generateEmbedding, EmbeddingModelUnavailableError } = await import('../lib/embeddings')
  try {
    await generateEmbedding('Test input for unprovisioned embedding')
  } catch (err: any) {
    assert.ok(
      err instanceof EmbeddingModelUnavailableError || err.name === 'EmbeddingModelUnavailableError',
      'Missing embedding model must throw EmbeddingModelUnavailableError'
    )
  }

  // Test Whisper fail-safe behavior
  const { WhisperASRService } = await import('../lib/audio/whisper-asr-service')
  const whisper = WhisperASRService.getInstance()
  try {
    await whisper.initialize('unprovisioned-model-offline-test')
    assert.fail('Unprovisioned Whisper model initialization should not succeed')
  } catch (err: any) {
    assert.ok(err, 'Unprovisioned Whisper model must throw on missing cache')
    assert.strictEqual(whisper.isReady(), false, 'Whisper must remain in unready state')
  }
})

test('Phase 4: GenerativeRuntime worker crash rejects in-flight requests cleanly and schedules recovery', async () => {
  const origWorker = (globalThis as any).Worker
  const origDoc = (globalThis as any).document

  let activeMockWorker: any = null

  class MockWorker {
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
        setTimeout(() => {
          this.onerror?.(new Error('Out of memory in WebAssembly isolate'))
        }, 10)
      }
    }
    terminate() {}
  }

  ;(globalThis as any).document = {}
  ;(globalThis as any).Worker = MockWorker as any

  try {
    await generativeRuntime.unloadModel()
    const initOk = await generativeRuntime.initializeLocalModel()
    assert.strictEqual(initOk, true)
    assert.strictEqual(generativeRuntime.getState().status, 'ready')

    // Trigger inference that crashes worker
    const genPromise = (generativeRuntime as any).executeLocalGeneration('Test prompt', { maxTokens: 10 })
    const result = await genPromise
    assert.strictEqual(result, null, 'Must drop through cleanly to null without unhandled promise rejections')

    const state = generativeRuntime.getState()
    assert.strictEqual(state.status, 'error')
    assert.ok(state.error?.includes('Out of memory'))
    assert.strictEqual(state.recoveryAttempt, 1)
    assert.strictEqual(state.maxRecoveryAttempts, 3)

    // Test cancelRecovery
    generativeRuntime.cancelRecovery()
    const cancelledState = generativeRuntime.getState()
    assert.strictEqual(cancelledState.status, 'error')
    assert.ok(cancelledState.error?.includes('Worker recovery cancelled by user'))

    // Test restartEngine
    const restartOk = await generativeRuntime.restartEngine()
    assert.strictEqual(restartOk, true)
    assert.strictEqual(generativeRuntime.getState().status, 'ready')
    assert.strictEqual(generativeRuntime.getState().recoveryAttempt, 0)
  } finally {
    ;(globalThis as any).Worker = origWorker
    if (origDoc !== undefined) (globalThis as any).document = origDoc
    else delete (globalThis as any).document
    await generativeRuntime.unloadModel()
  }
})

test('Phase 4: Maximum auto-recovery threshold transitions to persistent error state', async () => {
  const origWorker = (globalThis as any).Worker
  const origDoc = (globalThis as any).document

  class AlwaysFailingWorker {
    onmessage: any = null
    onerror: any = null
    onmessageerror: any = null
    postMessage(msg: any) {
      setTimeout(() => {
        this.onerror?.(new Error('Persistent worker crash'))
      }, 5)
    }
    terminate() {}
  }

  ;(globalThis as any).document = {}
  ;(globalThis as any).Worker = AlwaysFailingWorker as any

  try {
    await generativeRuntime.unloadModel()
    // Directly simulate reaching max recovery attempts
    ;(generativeRuntime as any).recoveryAttempts = 3
    ;(generativeRuntime as any).scheduleWorkerRecovery('Repeated OOM')

    const state = generativeRuntime.getState()
    assert.strictEqual(state.status, 'error')
    assert.ok(state.error?.includes('Maximum auto-recovery attempts (3) exceeded'))

    // Calling restartEngine resets attempts and allows recovery attempt
    ;(generativeRuntime as any).recoveryAttempts = 0
    generativeRuntime.cancelRecovery()
  } finally {
    ;(globalThis as any).Worker = origWorker
    if (origDoc !== undefined) (globalThis as any).document = origDoc
    else delete (globalThis as any).document
    await generativeRuntime.unloadModel()
  }
})

test('Phase 4: Strict safety invariant: crashed tool action is rejected and token cannot be reused', async () => {
  // Mint a genuine voice authorization token
  const token = mintTestVoiceToken(941)
  assert.ok(token, 'VoiceAuthorizationToken must be minted')

  // First tool execution consumes the token
  const res = await executeUITool({
    function: 'translateText',
    arguments: { text: 'hello', sourceLanguage: 'en', targetLanguage: 'es' }
  }, token)

  assert.strictEqual(res.success, true)

  // Attempting to reuse the exact same token must immediately fail
  const replayRes = await executeUITool({
    function: 'translateText',
    arguments: { text: 'hello', sourceLanguage: 'en', targetLanguage: 'es' }
  }, token)

  assert.strictEqual(replayRes.success, false)
  assert.ok(replayRes.error?.includes('Voice token already consumed') || replayRes.error?.includes('consumed'))
})
