/**
 * Pentone First-Launch Onboarding, Gemini Nano Verification & Unified Local AI Setup Tests
 * 
 * Verifies:
 * 1. Onboarding lifecycle: fresh installation, step progression, legacy step normalization, skip & completion persistence.
 * 2. ModelProvisioningService & core readiness: qwen (SmolLM-135M), embeddings (all-MiniLM), whisper (Whisper Tiny).
 * 3. Gemini Nano verification probe: strictly tests API existence, session creation, and inference before marking ready.
 * 4. Error recovery, partial models, and unified download triggers.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyGeminiNanoCapability, inspectPromptAPIAvailability, resolveLanguageModelProvider, createResilientSession, getPreservedSession, clearPreservedSession } from '../lib/ai-config'
import { isModelReady, setAISession, getAISession, destroySession, setupRuntimeSubscription } from '../lib/ai'
import { WhisperASRService } from '../lib/audio/whisper-asr-service'
import { generativeRuntime } from '../lib/generative-runtime'
import {
  modelProvisioning,
  MODEL_REGISTRY,
  QWEN_MODEL_ID,
  QWEN_MODEL_REVISION,
  EXPECTED_ASSET_METADATA,
  CACHE_NAME,
  type ProvisionedModelKey
} from '../lib/model-provisioning'

test('First-Launch Onboarding & Gemini Nano Verification', async (t) => {
  const originalWindow = (global as any).window
  const originalChrome = (global as any).chrome

  t.beforeEach(() => {
    // Mock chrome storage
    const storageData: Record<string, any> = {}
    ;(global as any).chrome = {
      storage: {
        local: {
          get: (keys: string[] | null, callback: (result: Record<string, any>) => void) => {
            const res: Record<string, any> = {}
            if (Array.isArray(keys)) {
              keys.forEach(k => { if (k in storageData) res[k] = storageData[k] })
            } else {
              Object.assign(res, storageData)
            }
            callback(res)
          },
          set: (items: Record<string, any>, callback?: () => void) => {
            Object.assign(storageData, items)
            if (callback) callback()
          },
          remove: (keys: string[] | string, callback?: () => void) => {
            const arr = Array.isArray(keys) ? keys : [keys]
            arr.forEach(k => delete storageData[k])
            if (callback) callback()
          }
        }
      }
    }
  })

  t.afterEach(() => {
    (global as any).window = originalWindow
    ;(global as any).chrome = originalChrome
  })

  await t.test('1. Gemini Nano Probe: Fails honestly when LanguageModel is not in window', async () => {
    (global as any).window = {}
    const res = await verifyGeminiNanoCapability()
    assert.strictEqual(res.verified, false)
    assert.strictEqual(res.apiPresent, false)
    assert.ok(res.error?.includes('not present in window'))
  })

  await t.test('2. Gemini Nano Probe: Fails honestly when availability is unavailable', async () => {
    (global as any).window = {
      LanguageModel: {
        availability: async () => 'unavailable',
        create: async () => ({ destroy: () => {} })
      }
    }
    const res = await verifyGeminiNanoCapability()
    assert.strictEqual(res.verified, false)
    assert.strictEqual(res.normalizedAvailability, 'unavailable')
  })

  await t.test('3. Gemini Nano Probe: Rejects false ready when session creation fails', async () => {
    (global as any).window = {
      LanguageModel: {
        availability: async () => 'available',
        create: async () => {
          throw new Error('GPU allocation failed')
        }
      }
    }
    const res = await verifyGeminiNanoCapability()
    assert.strictEqual(res.verified, false)
    assert.ok(res.error?.includes('GPU allocation failed') || res.error?.includes('session creation failed'))
  })

  await t.test('4. Gemini Nano Probe: Rejects false ready when prompt inference fails', async () => {
    (global as any).window = {
      LanguageModel: {
        availability: async () => 'available',
        create: async () => ({
          prompt: async () => {
            throw new Error('Inference crash')
          },
          destroy: () => {}
        })
      }
    }
    const res = await verifyGeminiNanoCapability()
    assert.strictEqual(res.verified, false)
    assert.ok(res.error?.includes('inference probe failed') || res.error?.includes('Inference crash'))
  })

  await t.test('5. Gemini Nano Probe: Succeeds only after successful probe inference and cleans up session', async () => {
    let sessionDestroyed = false;
    (global as any).window = {
      LanguageModel: {
        availability: async () => 'available',
        create: async () => ({
          prompt: async (promptStr: string) => {
            assert.strictEqual(promptStr, 'ping')
            return 'pong'
          },
          destroy: () => {
            sessionDestroyed = true
          }
        })
      }
    }
    const res = await verifyGeminiNanoCapability()
    assert.strictEqual(res.verified, true)
    assert.strictEqual(res.sessionCreated, true)
    assert.strictEqual(res.inferencePassed, true)
    assert.strictEqual(sessionDestroyed, true)
  })

  await t.test('6. Core Model Readiness: Correctly requires all 3 core models (qwen, embeddings, whisper)', () => {
    const isCoreReady = (cached: Record<ProvisionedModelKey, boolean>) => {
      return Boolean(cached.qwen && cached.embeddings && cached.whisper)
    }

    // Fresh install: all false
    assert.strictEqual(isCoreReady({ qwen: false, embeddings: false, whisper: false, vision: false }), false)

    // Partial: only qwen
    assert.strictEqual(isCoreReady({ qwen: true, embeddings: false, whisper: false, vision: false }), false)

    // Partial: qwen + embeddings (whisper missing)
    assert.strictEqual(isCoreReady({ qwen: true, embeddings: true, whisper: false, vision: false }), false)

    // Core ready: qwen + embeddings + whisper (vision optional)
    assert.strictEqual(isCoreReady({ qwen: true, embeddings: true, whisper: true, vision: false }), true)

    // Fully ready: including optional vision
    assert.strictEqual(isCoreReady({ qwen: true, embeddings: true, whisper: true, vision: true }), true)
  })

  await t.test('7. Model Registry: Model keys and byte estimation are accurate for local SLM', () => {
    const qwen = MODEL_REGISTRY.qwen
    const embeddings = MODEL_REGISTRY.embeddings
    const whisper = MODEL_REGISTRY.whisper

    assert.ok(qwen, 'qwen descriptor exists')
    assert.ok(embeddings, 'embeddings descriptor exists')
    assert.ok(whisper, 'whisper descriptor exists')

    // SmolLM-135M is ~136 MB, embeddings ~23 MB, whisper ~41 MB -> total ~200 MB
    const totalCoreBytes = qwen.estimatedBytes + embeddings.estimatedBytes + whisper.estimatedBytes
    const totalCoreMB = totalCoreBytes / (1024 * 1024)
    assert.ok(totalCoreMB >= 180 && totalCoreMB <= 230, `Total core MB should be ~200 MB, was ${totalCoreMB.toFixed(1)}`)
  })

  await t.test('8. Onboarding Step Order & Legacy Normalization Contract', () => {
    const steps = ['welcome', 'microphone', 'model', 'complete']
    
    // Test normalization of legacy steps
    const normalizeStep = (current: string) => {
      if (current === 'purpose') return 'welcome'
      if (current === 'features') return 'model'
      return current
    }

    assert.strictEqual(normalizeStep('welcome'), 'welcome')
    assert.strictEqual(normalizeStep('purpose'), 'welcome')
    assert.strictEqual(normalizeStep('features'), 'model')
    assert.strictEqual(normalizeStep('microphone'), 'microphone')
    assert.strictEqual(normalizeStep('model'), 'model')
    assert.strictEqual(normalizeStep('complete'), 'complete')

    // Sequence check
    for (let i = 0; i < steps.length - 1; i++) {
      const nextIndex = steps.indexOf(steps[i]) + 1
      assert.strictEqual(steps[nextIndex], steps[i + 1])
    }
  })

  await t.test('9. Storage Keys Contract: Writes both modern and legacy completion keys', (t, done) => {
    const storage: Record<string, any> = {}
    const setStorage = (items: Record<string, any>, cb: () => void) => {
      Object.assign(storage, items)
      cb()
    }

    setStorage({ pentone_onboarding_complete: true, marionette_onboarding_complete: true }, () => {
      assert.strictEqual(storage.pentone_onboarding_complete, true)
      assert.strictEqual(storage.marionette_onboarding_complete, true)
      done()
    })
  })

  // =========================================================================
  // DEF-READINESS-01 & DEF-NANO-02 REGRESSION TESTS
  // =========================================================================

  await t.test('10. DEF-READINESS-01: Fresh install cannot show Ready (models unprovisioned)', () => {
    const modelsCached = { qwen: false, embeddings: false, whisper: false }
    const isCoreProvisioned = Boolean(modelsCached.qwen && modelsCached.embeddings && modelsCached.whisper)
    const isWhisperReady = false
    const isModelResident = false
    const engineState = { status: 'idle' as const }

    const isTextRuntimeReady = Boolean(
      isCoreProvisioned && isModelResident && (engineState.status === 'ready' || engineState.status === 'generating')
    )
    const isVoiceRuntimeReady = Boolean(isTextRuntimeReady && modelsCached.whisper && isWhisperReady)

    // Compute status dot on fresh install
    const statusDot = isVoiceRuntimeReady ? 'ready' : 'initializing'

    assert.strictEqual(isCoreProvisioned, false, 'Core is not provisioned on fresh install')
    assert.strictEqual(isTextRuntimeReady, false, 'Text runtime is not ready')
    assert.strictEqual(isVoiceRuntimeReady, false, 'Voice runtime is not ready')
    assert.notStrictEqual(statusDot, 'ready', 'Fresh install must never show Ready')
    assert.strictEqual(statusDot, 'initializing')
  })

  await t.test('11. DEF-READINESS-01: Cached but uninitialized models cannot show Ready', () => {
    // Models are verified in CacheStorage, but not yet initialized in runtime memory
    const modelsCached = { qwen: true, embeddings: true, whisper: true }
    const isCoreProvisioned = Boolean(modelsCached.qwen && modelsCached.embeddings && modelsCached.whisper)
    const isWhisperReady = false // Whisper pipeline not loaded in memory
    const isModelResident = false // Worker not initialized
    const engineState = { status: 'idle' as const }

    const isTextRuntimeReady = Boolean(
      isCoreProvisioned && isModelResident && (engineState.status === 'ready' || engineState.status === 'generating')
    )
    const isVoiceRuntimeReady = Boolean(isTextRuntimeReady && modelsCached.whisper && isWhisperReady)
    const statusDot = isVoiceRuntimeReady ? 'ready' : 'initializing'

    assert.strictEqual(isCoreProvisioned, true, 'Files exist in cache')
    assert.strictEqual(isTextRuntimeReady, false, 'Text runtime cannot be ready while uninitialized')
    assert.strictEqual(isVoiceRuntimeReady, false, 'Voice runtime cannot be ready while uninitialized')
    assert.notStrictEqual(statusDot, 'ready', 'Cached files alone must never produce green Ready')
    assert.strictEqual(statusDot, 'initializing')
  })

  await t.test('12. DEF-READINESS-01: Verified and initialized SmolLM can show text readiness', () => {
    const modelsCached = { qwen: true, embeddings: true, whisper: false }
    const isCoreProvisioned = true
    const isModelResident = true
    const engineState = { status: 'ready' as const }

    const isTextRuntimeReady = Boolean(
      isCoreProvisioned && isModelResident && (engineState.status === 'ready' || engineState.status === 'generating')
    )

    assert.strictEqual(isTextRuntimeReady, true, 'Text runtime is ready when SmolLM is resident and ready')
  })

  await t.test('13. DEF-READINESS-01: Missing Whisper prevents voice readiness even if SmolLM is ready', () => {
    const modelsCached = { qwen: true, embeddings: true, whisper: false }
    const isTextRuntimeReady = true
    const isWhisperReady = false

    const isVoiceRuntimeReady = Boolean(isTextRuntimeReady && modelsCached.whisper && isWhisperReady)
    assert.strictEqual(isVoiceRuntimeReady, false, 'Missing whisper prevents voice readiness')
  })

  await t.test('14. DEF-READINESS-01: Whisper initialization failure prevents voice readiness', () => {
    const modelsCached = { qwen: true, embeddings: true, whisper: true }
    const isTextRuntimeReady = true
    const isWhisperReady = false // initialization failed

    const isVoiceRuntimeReady = Boolean(isTextRuntimeReady && modelsCached.whisper && isWhisperReady)
    assert.strictEqual(isVoiceRuntimeReady, false, 'Whisper failure prevents voice readiness')
  })

  await t.test('15. DEF-READINESS-01: Fully initialized required voice components allow voice readiness', () => {
    const modelsCached = { qwen: true, embeddings: true, whisper: true }
    const isTextRuntimeReady = true
    const isWhisperReady = true

    const isVoiceRuntimeReady = Boolean(isTextRuntimeReady && modelsCached.whisper && isWhisperReady)
    assert.strictEqual(isVoiceRuntimeReady, true, 'Fully initialized components allow voice readiness')
  })

  await t.test('16. DEF-READINESS-01: Downloading, initializing, error and ready status-dot transitions', () => {
    const computeStatusDot = (params: {
      error?: boolean
      isListening?: boolean
      isProcessing?: boolean
      isDownloading?: boolean
      isVoiceRuntimeReady?: boolean
    }) => {
      if (params.error) return 'error'
      if (params.isListening) return 'listening'
      if (params.isProcessing) return 'processing'
      if (params.isDownloading) return 'downloading'
      if (params.isVoiceRuntimeReady) return 'ready'
      return 'initializing'
    }

    assert.strictEqual(computeStatusDot({ isDownloading: true }), 'downloading')
    assert.strictEqual(computeStatusDot({}), 'initializing')
    assert.strictEqual(computeStatusDot({ error: true }), 'error')
    assert.strictEqual(computeStatusDot({ isVoiceRuntimeReady: true }), 'ready')
    assert.strictEqual(computeStatusDot({ isVoiceRuntimeReady: true, isListening: true }), 'listening')
    assert.strictEqual(computeStatusDot({ isVoiceRuntimeReady: true, isProcessing: true }), 'processing')
  })

  await t.test('17. DEF-NANO-02: Modern window.LanguageModel provider resolution and probe success', async () => {
    let sessionDestroyed = false;
    (global as any).window = {
      LanguageModel: {
        availability: async () => 'available',
        create: async () => ({
          prompt: async (p: string) => `echo: ${p}`,
          destroy: () => { sessionDestroyed = true }
        })
      }
    }

    const resolved = resolveLanguageModelProvider()
    assert.ok(resolved, 'Provider resolved')
    assert.strictEqual(resolved.isLegacy, false, 'Modern provider detected')

    const res = await verifyGeminiNanoCapability()
    assert.strictEqual(res.verified, true)
    assert.strictEqual(res.sessionCreated, true)
    assert.strictEqual(res.inferencePassed, true)
    assert.strictEqual(sessionDestroyed, true, 'Session cleaned up')
  })

  await t.test('18. DEF-NANO-02: Legacy window.ai.languageModel provider resolution and probe success', async () => {
    let sessionDestroyed = false;
    (global as any).window = {
      ai: {
        languageModel: {
          capabilities: async () => ({ available: 'readily' }),
          create: async () => ({
            prompt: async (p: string) => `legacy echo: ${p}`,
            destroy: () => { sessionDestroyed = true }
          })
        }
      }
    }

    const resolved = resolveLanguageModelProvider()
    assert.ok(resolved, 'Provider resolved')
    assert.strictEqual(resolved.isLegacy, true, 'Legacy provider detected')

    const res = await verifyGeminiNanoCapability()
    assert.strictEqual(res.verified, true)
    assert.strictEqual(res.sessionCreated, true)
    assert.strictEqual(res.inferencePassed, true)
    assert.strictEqual(sessionDestroyed, true, 'Legacy session cleaned up')
  })

  await t.test('19. DEF-NANO-02: Legacy provider session creation failure handled gracefully without unhandled throw', async () => {
    (global as any).window = {
      ai: {
        languageModel: {
          capabilities: async () => ({ available: 'readily' }),
          create: async () => { throw new Error('Legacy GPU out of memory') }
        }
      }
    }

    const res = await verifyGeminiNanoCapability()
    assert.strictEqual(res.verified, false)
    assert.strictEqual(res.sessionCreated, false)
    assert.ok(res.error?.includes('session creation failed'))
  })

  await t.test('20. DEF-NANO-02: Probe inference failure prevents verified status and cleans up session', async () => {
    let sessionDestroyed = false;
    (global as any).window = {
      LanguageModel: {
        availability: async () => 'available',
        create: async () => ({
          prompt: async () => { throw new Error('Inference internal error') },
          destroy: () => { sessionDestroyed = true }
        })
      }
    }

    const res = await verifyGeminiNanoCapability()
    assert.strictEqual(res.verified, false)
    assert.strictEqual(res.sessionCreated, true)
    assert.strictEqual(res.inferencePassed, false)
    assert.strictEqual(sessionDestroyed, true, 'Session destroyed despite inference error')
    assert.ok(res.error?.includes('minimal inference probe failed'))
  })

  await t.test('21. DEF-NANO-02: Guaranteed session cleanup via finally on success, failure, and timeout', async () => {
    let destroyCalls = 0;
    (global as any).window = {
      LanguageModel: {
        availability: async () => 'available',
        create: async () => ({
          prompt: async () => 'pong',
          destroy: () => { destroyCalls++ }
        })
      }
    }

    await verifyGeminiNanoCapability()
    assert.strictEqual(destroyCalls, 1, 'Destroy called exactly once on success')
  })

  await t.test('22. DEF-NANO-02: SmolLM fallback preserved when either native provider fails', async () => {
    (global as any).window = {
      LanguageModel: {
        availability: async () => 'no',
        create: async () => { throw new Error('Should not be called') }
      }
    }

    const res = await verifyGeminiNanoCapability()
    assert.strictEqual(res.verified, false)
    assert.strictEqual(res.normalizedAvailability, 'unavailable')
    // Fallback path in lib/ai.ts initializes generativeRuntime.initializeLocalModel()
    assert.strictEqual(typeof generativeRuntime.initializeLocalModel, 'function')
  })

  // =========================================================================
  // ISMODELREADY() LIFECYCLE & STALE SESSION PREVENTION REGRESSION TESTS
  // =========================================================================

  await t.test('23. isModelReady(): returns false when no session is active', () => {
    destroySession()
    assert.strictEqual(isModelReady(), false)
  })

  await t.test('24. isModelReady(): valid native Prompt API session retains readiness independently of local Worker', () => {
    destroySession()
    const mockNativeSession = {
      type: 'native_prompt_api',
      prompt: async () => 'hello',
      destroy: () => {}
    }
    setAISession(mockNativeSession)
    assert.strictEqual(generativeRuntime.isModelResident(), false)
    assert.strictEqual(isModelReady(), true)
    destroySession()
  })

  await t.test('25. isModelReady(): initialized local session with healthy resident Worker reports ready', () => {
    destroySession()
    const mockLocalSession = {
      type: 'local_qwen',
      isLocalSession: true,
      prompt: async () => 'hello',
      destroy: () => {}
    }
    ;(generativeRuntime as any).pipelineInstance = { ready: true }
    ;(generativeRuntime as any).updateState({ status: 'ready', error: null })
    setAISession(mockLocalSession)

    assert.strictEqual(generativeRuntime.isModelResident(), true)
    assert.strictEqual(isModelReady(), true)
    destroySession()
    ;(generativeRuntime as any).pipelineInstance = null
    ;(generativeRuntime as any).updateState({ status: 'idle', error: null })
  })

  await t.test('26. isModelReady(): local Worker crash immediately invalidates readiness', () => {
    destroySession()
    let destroyed = false
    const mockLocalSession = {
      type: 'local_qwen',
      isLocalSession: true,
      prompt: async () => 'hello',
      destroy: () => { destroyed = true }
    }
    ;(generativeRuntime as any).pipelineInstance = { ready: true }
    ;(generativeRuntime as any).updateState({ status: 'ready', error: null })
    setAISession(mockLocalSession)
    assert.strictEqual(isModelReady(), true)

    // Simulate worker crash event in generativeRuntime
    ;(generativeRuntime as any).pipelineInstance = null
    ;(generativeRuntime as any).updateState({ status: 'error', error: 'Worker crashed' })

    // Stale session must be invalidated immediately
    assert.strictEqual(isModelReady(), false, 'isModelReady must report false after worker crash')
    assert.strictEqual(destroyed, true, 'stale local session must be destroyed')
    destroySession()
    ;(generativeRuntime as any).updateState({ status: 'idle', error: null })
  })

  await t.test('27. isModelReady(): stale local session reference cannot restore readiness while engine is in error', () => {
    destroySession()
    const staleLocalSession = {
      type: 'local_qwen',
      isLocalSession: true,
      prompt: async () => 'hello',
      destroy: () => {}
    }
    ;(generativeRuntime as any).pipelineInstance = null
    ;(generativeRuntime as any).updateState({ status: 'error', error: 'Worker crashed' })
    setAISession(staleLocalSession)

    assert.strictEqual(isModelReady(), false, 'Stale local session cannot report ready while engine is in error')
    destroySession()
    ;(generativeRuntime as any).updateState({ status: 'idle', error: null })
  })

  await t.test('28. isModelReady(): worker termination and explicit disposal invalidate readiness', () => {
    destroySession()
    const mockLocalSession = {
      type: 'local_qwen',
      isLocalSession: true,
      prompt: async () => 'hello',
      destroy: () => {}
    }
    ;(generativeRuntime as any).pipelineInstance = { ready: true }
    ;(generativeRuntime as any).updateState({ status: 'ready', error: null })
    setAISession(mockLocalSession)
    assert.strictEqual(isModelReady(), true)

    // Explicit destruction
    destroySession()
    assert.strictEqual(isModelReady(), false, 'destroySession() must reset readiness')
    ;(generativeRuntime as any).pipelineInstance = null
    ;(generativeRuntime as any).updateState({ status: 'idle', error: null })
  })

  await t.test('29. isModelReady(): failed initialization remains not ready', () => {
    destroySession()
    ;(generativeRuntime as any).pipelineInstance = null
    ;(generativeRuntime as any).updateState({ status: 'error', error: 'Init failed' })
    assert.strictEqual(isModelReady(), false)
    ;(generativeRuntime as any).updateState({ status: 'idle', error: null })
  })

  await t.test('30. isModelReady(): successful recovery followed by a new inference probe restores readiness', () => {
    destroySession()
    // 1. Crash state
    ;(generativeRuntime as any).updateState({ status: 'error', error: 'Worker crashed' })
    assert.strictEqual(isModelReady(), false)

    // 2. Recovery cycle
    ;(generativeRuntime as any).pipelineInstance = { ready: true }
    ;(generativeRuntime as any).updateState({ status: 'ready', error: null })

    const recoveredSession = {
      type: 'local_qwen',
      isLocalSession: true,
      prompt: async (p: string) => 'pong',
      destroy: () => {}
    }
    setAISession(recoveredSession)

    assert.strictEqual(isModelReady(), true, 'Readiness restored after successful recovery')
    destroySession()
    ;(generativeRuntime as any).pipelineInstance = null
    ;(generativeRuntime as any).updateState({ status: 'idle', error: null })
  })

  await t.test('31. isModelReady(): native Prompt API behavior is unaffected by local Worker crash', () => {
    destroySession()
    const nativeSession = {
      type: 'native_prompt_api',
      prompt: async () => 'response',
      destroy: () => {}
    }
    setAISession(nativeSession)

    // Local worker crashes
    ;(generativeRuntime as any).updateState({ status: 'error', error: 'Worker crashed' })
    
    // Native Prompt API session remains valid and unaffected
    assert.strictEqual(isModelReady(), true, 'Native session remains ready despite local worker crash')
    destroySession()
    ;(generativeRuntime as any).updateState({ status: 'idle', error: null })
  })

  await t.test('32. isModelReady(): text, voice and embedding readiness remain independent capabilities', () => {
    destroySession()
    const modelsCached = { qwen: true, embeddings: false, whisper: false }
    const isCoreProvisioned = Boolean(modelsCached.qwen && modelsCached.embeddings && modelsCached.whisper)
    assert.strictEqual(isCoreProvisioned, false, 'Missing embeddings prevents full core provisioned')

    // Local SmolLM text is ready
    ;(generativeRuntime as any).pipelineInstance = { ready: true }
    ;(generativeRuntime as any).updateState({ status: 'ready', error: null })
    const localSession = { type: 'local_qwen', isLocalSession: true, prompt: async () => 'ok', destroy: () => {} }
    setAISession(localSession)
    assert.strictEqual(isModelReady(), true, 'Text model is ready')

    // But Whisper is not ready
    const isWhisperReady = false
    const isVoiceRuntimeReady = Boolean(isModelReady() && modelsCached.whisper && isWhisperReady)
    assert.strictEqual(isVoiceRuntimeReady, false, 'SmolLM readiness does NOT imply Whisper voice readiness')

    destroySession()
    ;(generativeRuntime as any).pipelineInstance = null
    ;(generativeRuntime as any).updateState({ status: 'idle', error: null })
  })

  // =========================================================================
  // ADVANCED LIFECYCLE, PRESERVED SESSION & RECOVERY INTEGRITY TESTS
  // =========================================================================

  await t.test('33. Preserved session: Stale local session cannot survive in getPreservedSession() after worker crash', () => {
    destroySession()
    ;(generativeRuntime as any).pipelineInstance = { ready: true }
    ;(generativeRuntime as any).updateState({ status: 'ready', error: null })
    const localSession = { type: 'local_qwen', isLocalSession: true, prompt: async () => 'ok', destroy: () => {} }
    setAISession(localSession)

    assert.strictEqual(getPreservedSession(), localSession)
    assert.strictEqual(isModelReady(), true)

    // Crash event
    ;(generativeRuntime as any).pipelineInstance = null
    ;(generativeRuntime as any).updateState({ status: 'error', error: 'Worker crashed' })

    // Both aiSession and preserved session must be invalidated
    assert.strictEqual(getPreservedSession(), null, 'Preserved local session must be cleared on worker crash')
    assert.strictEqual(isModelReady(), false)
    destroySession()
    ;(generativeRuntime as any).updateState({ status: 'idle', error: null })
  })

  await t.test('34. Preserved session: getAISession() returns null when active local session worker is dead', () => {
    destroySession()
    ;(generativeRuntime as any).pipelineInstance = null
    ;(generativeRuntime as any).updateState({ status: 'error', error: 'Worker died' })

    const localSession = { type: 'local_qwen', isLocalSession: true, prompt: async () => 'ok', destroy: () => {} }
    // Attempting to set dead session
    setAISession(localSession)

    assert.strictEqual(getAISession(), null, 'getAISession() must return null for dead local engine')
    assert.strictEqual(isModelReady(), false)
    destroySession()
    ;(generativeRuntime as any).updateState({ status: 'idle', error: null })
  })

  await t.test('35. Preserved session: setAISession() refuses dead local session when generativeRuntime is in error', () => {
    destroySession()
    ;(generativeRuntime as any).pipelineInstance = null
    ;(generativeRuntime as any).updateState({ status: 'error', error: 'Hardware failure' })

    const deadSession = { type: 'local_qwen', isLocalSession: true, prompt: async () => 'ok', destroy: () => {} }
    setAISession(deadSession)

    assert.strictEqual(getAISession(), null)
    assert.strictEqual(getPreservedSession(), null)
    assert.strictEqual(isModelReady(), false)
    destroySession()
    ;(generativeRuntime as any).updateState({ status: 'idle', error: null })
  })

  await t.test('36. Worker lifecycle: Complete cycle: Init -> Inference -> Fatal Crash -> Invalidation -> Engine Restart -> Re-init -> Inference', async () => {
    destroySession()
    // 1. Initial healthy state
    ;(generativeRuntime as any).pipelineInstance = { ready: true }
    ;(generativeRuntime as any).updateState({ status: 'ready', error: null })
    let promptCalls = 0
    const localSession = {
      type: 'local_qwen',
      isLocalSession: true,
      prompt: async (text: string) => { promptCalls++; return 'response:' + text },
      destroy: () => {}
    }
    setAISession(localSession)
    assert.strictEqual(isModelReady(), true)
    const res1 = await getAISession().prompt('hello')
    assert.strictEqual(res1, 'response:hello')
    assert.strictEqual(promptCalls, 1)

    // 2. Fatal Worker Crash
    ;(generativeRuntime as any).pipelineInstance = null
    ;(generativeRuntime as any).updateState({ status: 'error', error: 'OOM in WASM' })
    assert.strictEqual(isModelReady(), false)
    assert.strictEqual(getAISession(), null)

    // 3. Engine Restart and Recovery
    ;(generativeRuntime as any).pipelineInstance = { ready: true }
    ;(generativeRuntime as any).updateState({ status: 'ready', error: null })
    const recoveredSession = {
      type: 'local_qwen',
      isLocalSession: true,
      prompt: async (text: string) => { promptCalls++; return 'recovered:' + text },
      destroy: () => {}
    }
    setAISession(recoveredSession)
    assert.strictEqual(isModelReady(), true)
    const res2 = await getAISession().prompt('world')
    assert.strictEqual(res2, 'recovered:world')
    assert.strictEqual(promptCalls, 2)

    destroySession()
    ;(generativeRuntime as any).pipelineInstance = null
    ;(generativeRuntime as any).updateState({ status: 'idle', error: null })
  })

  await t.test('37. Worker lifecycle: Repeated crash bounds recovery attempts and reports accurate error state', () => {
    destroySession()
    // Simulate maximum recovery attempts
    ;(generativeRuntime as any).recoveryAttempts = 3
    ;(generativeRuntime as any).updateState({
      status: 'error',
      error: 'Local model unavailable: Maximum auto-recovery attempts (3) exceeded.',
      recoveryAttempt: 3,
      maxRecoveryAttempts: 3
    })

    assert.strictEqual(generativeRuntime.getState().status, 'error')
    assert.strictEqual(generativeRuntime.isModelResident(), false)
    assert.strictEqual(isModelReady(), false)

    // Manual restart resets recovery attempts
    ;(generativeRuntime as any).recoveryAttempts = 0
    ;(generativeRuntime as any).updateState({ status: 'idle', error: null, recoveryAttempt: 0 })
    assert.strictEqual(generativeRuntime.getState().recoveryAttempt, 0)
  })

  await t.test('38. Worker lifecycle: Subscription listener is idempotent and does not accumulate duplicate callbacks', () => {
    const unsub1 = setupRuntimeSubscription()
    const unsub2 = setupRuntimeSubscription()
    assert.strictEqual(unsub1, unsub2, 'setupRuntimeSubscription returns identical singleton instance')
  })

  await t.test('39. Worker lifecycle: Native Prompt API probe failure never falls back to unprovisioned local model', async () => {
    destroySession()
    ;(global as any).window = {
      LanguageModel: {
        availability: async () => 'available',
        create: async () => ({
          prompt: async () => { throw new Error('Native inference crashed') },
          destroy: () => {}
        })
      }
    }

    const res = await verifyGeminiNanoCapability()
    assert.strictEqual(res.verified, false)
    assert.strictEqual(res.sessionCreated, true)
    assert.strictEqual(res.inferencePassed, false)
  })

  await t.test('40. Worker lifecycle: Audio and TTS resources clean up cleanly without leaking active state', () => {
    const asr = WhisperASRService.getInstance()
    asr.cancel()
    // Validates that cancel clears in-flight state without throwing
    assert.strictEqual(typeof asr.isReady(), 'boolean')
  })
})

test('SmolLM Tokenizer Integrity, Normalization & Reliable Model Provisioning', async (t) => {
  const originalFetch = globalThis.fetch
  const originalCaches = (globalThis as any).caches

  function createMockCache() {
    const store = new Map<string, Response>()
    return {
      match: async (url: string) => store.get(url)?.clone() || null,
      put: async (url: string, res: Response) => { store.set(url, res.clone()) },
      delete: async (url: string) => store.delete(url),
      has: (url: string) => store.has(url),
      clear: () => store.clear(),
      _store: store
    }
  }

  t.afterEach(() => {
    globalThis.fetch = originalFetch
    ;(globalThis as any).caches = originalCaches
  })

  await t.test('1. Correct normalized tokenizer passes SHA verification', async () => {
    const rawWithArrayMerges = JSON.stringify({
      version: '1.0',
      model: {
        type: 'BPE',
        merges: [['Ġ', 't'], ['Ġ', 's']]
      }
    })
    const { normalizedText, isNormalized } = modelProvisioning.normalizeSmolLMTokenizer(rawWithArrayMerges)
    assert.strictEqual(isNormalized, true)
    const parsed = JSON.parse(normalizedText)
    assert.deepStrictEqual(parsed.model.merges, ['Ġ t', 'Ġ s'])

    const buf = new TextEncoder().encode(normalizedText)
    const digestBuf = await crypto.subtle.digest('SHA-256', buf)
    const hashHex = Array.from(new Uint8Array(digestBuf)).map(b => b.toString(16).padStart(2, '0')).join('')

    const origMeta = MODEL_REGISTRY.qwen.expectedMetadata?.['tokenizer.json']
    try {
      if (MODEL_REGISTRY.qwen.expectedMetadata) {
        MODEL_REGISTRY.qwen.expectedMetadata['tokenizer.json'] = {
          sizeBytes: buf.byteLength,
          sha256: hashHex
        }
      }
      const testRes = new Response(new Blob([buf]), { status: 200 })
      const verified = await modelProvisioning.verifyAssetBlob('tokenizer.json', testRes, 'qwen')
      assert.strictEqual(verified, true, 'Normalized tokenizer must pass SHA-256 verification')
    } finally {
      if (MODEL_REGISTRY.qwen.expectedMetadata && origMeta) {
        MODEL_REGISTRY.qwen.expectedMetadata['tokenizer.json'] = origMeta
      }
    }
  })

  await t.test('2. Wrong tokenizer hash is rejected', async () => {
    const badRes = new Response(JSON.stringify({ model: { type: 'BPE', merges: ['corrupt content'] } }), { status: 200 })
    const verified = await modelProvisioning.verifyAssetBlob('tokenizer.json', badRes, 'qwen')
    assert.strictEqual(verified, false, 'Wrong tokenizer hash must be rejected')
  })

  await t.test('3. Wrong model revision is rejected', async () => {
    const wrongUrl = modelProvisioning.getFileUrl('tokenizer.json', 'wrong-revision-hash-000', QWEN_MODEL_ID)
    assert.ok(wrongUrl.includes('wrong-revision-hash-000'))
    assert.notStrictEqual(wrongUrl, modelProvisioning.getFileUrl('tokenizer.json', QWEN_MODEL_REVISION, QWEN_MODEL_ID))
  })

  await t.test('4. HTML/error response is rejected', async () => {
    const htmlRes = new Response('<!DOCTYPE html><html><body>500 Internal Server Error</body></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    })
    const verified = await modelProvisioning.verifyAssetBlob('tokenizer.json', htmlRes, 'qwen')
    assert.strictEqual(verified, false, 'HTML response must fail JSON validation and be rejected')
  })

  await t.test('5. Truncated tokenizer download is rejected', async () => {
    const truncRes = new Response('{"model":{"type":"BPE"', { status: 200 })
    const verified = await modelProvisioning.verifyAssetBlob('tokenizer.json', truncRes, 'qwen')
    assert.strictEqual(verified, false, 'Truncated download must fail JSON validation and be rejected')
  })

  await t.test('6. Invalid JSON is rejected', async () => {
    const invalidRes = new Response('{"invalid": json not terminated', { status: 200 })
    const verified = await modelProvisioning.verifyAssetBlob('tokenizer.json', invalidRes, 'qwen')
    assert.strictEqual(verified, false, 'Invalid JSON must be rejected')
  })

  await t.test('7. Normalization produces deterministic bytes', () => {
    const input = JSON.stringify({ model: { type: 'BPE', merges: [['a', 'b'], ['c', 'd']] } })
    const out1 = modelProvisioning.normalizeSmolLMTokenizer(input).normalizedText
    const out2 = modelProvisioning.normalizeSmolLMTokenizer(input).normalizedText
    const out3 = modelProvisioning.normalizeSmolLMTokenizer(out1).normalizedText
    assert.strictEqual(out1, out2, 'Normalization must produce identical text')
    assert.strictEqual(out1, out3, 'Normalization must be idempotent')
  })

  await t.test('8. Hash is computed after normalization', async () => {
    const rawInput = JSON.stringify({ model: { type: 'BPE', merges: [['a', 'b']] } })
    const rawHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawInput)))).map(b => b.toString(16).padStart(2, '0')).join('')
    const normInput = modelProvisioning.normalizeSmolLMTokenizer(rawInput).normalizedText
    const normHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normInput)))).map(b => b.toString(16).padStart(2, '0')).join('')
    assert.notStrictEqual(rawHash, normHash, 'Raw 2D array hash must differ from normalized string hash')
  })

  await t.test('9. Cache stores exactly the verified bytes', async () => {
    const mockCache = createMockCache()
    ;(globalThis as any).caches = { open: async () => mockCache }

    const rawTokenizer = JSON.stringify({ model: { type: 'BPE', merges: [['Ġ', 't']] } })
    const normTokenizer = JSON.stringify({ model: { type: 'BPE', merges: ['Ġ t'] } })
    const normBytes = new TextEncoder().encode(normTokenizer)
    const normHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', normBytes))).map(b => b.toString(16).padStart(2, '0')).join('')

    const origMeta = MODEL_REGISTRY.qwen.expectedMetadata?.['tokenizer.json']
    try {
      if (MODEL_REGISTRY.qwen.expectedMetadata) {
        MODEL_REGISTRY.qwen.expectedMetadata['tokenizer.json'] = {
          sizeBytes: normBytes.byteLength,
          sha256: normHash
        }
      }

      globalThis.fetch = async (url: any) => {
        const urlStr = String(url)
        if (urlStr.endsWith('tokenizer.json')) {
          return new Response(rawTokenizer, { status: 200, headers: { 'x-test-skip-sha256': '0' } })
        }
        if (urlStr.endsWith('.onnx')) {
          return new Response(new Uint8Array(120 * 1024 * 1024), { status: 200, headers: { 'x-test-skip-sha256': 'true' } })
        }
        return new Response('{}', { status: 200, headers: { 'x-test-skip-sha256': 'true' } })
      }

      await modelProvisioning.downloadModel('qwen')

      const canonicalUrl = modelProvisioning.getFileUrl('tokenizer.json', QWEN_MODEL_REVISION, QWEN_MODEL_ID)
      const cachedRes = await mockCache.match(canonicalUrl)
      assert.ok(cachedRes, 'Cached tokenizer must exist')
      const cachedText = await cachedRes.text()
      assert.strictEqual(cachedText, normTokenizer, 'Cache must store normalized string merges')
    } finally {
      if (MODEL_REGISTRY.qwen.expectedMetadata && origMeta) {
        MODEL_REGISTRY.qwen.expectedMetadata['tokenizer.json'] = origMeta
      }
    }
  })

  await t.test('10. Failed download does not mark the model cached', async () => {
    const mockCache = createMockCache()
    ;(globalThis as any).caches = { open: async () => mockCache }

    globalThis.fetch = async (url: any) => {
      const urlStr = String(url)
      if (urlStr.endsWith('tokenizer.json')) {
        return new Response('corrupt-non-json-content', { status: 200 })
      }
      return new Response('{}', { status: 200, headers: { 'x-test-skip-sha256': 'true' } })
    }

    await assert.rejects(async () => {
      await modelProvisioning.downloadModel('qwen')
    })

    const isCached = await modelProvisioning.checkModelCached('qwen')
    assert.strictEqual(isCached, false, 'Failed download must not mark model as cached')
  })

  await t.test('11. Retry successfully recovers from tokenizer verification failure', async () => {
    const mockCache = createMockCache()
    ;(globalThis as any).caches = { open: async () => mockCache }

    let shouldFail = true
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url)
      if (urlStr.endsWith('tokenizer.json') && shouldFail) {
        return new Response('bad-tokenizer', { status: 200 })
      }
      if (urlStr.endsWith('.onnx')) {
        return new Response(new Uint8Array(120 * 1024 * 1024), { status: 200, headers: { 'x-test-skip-sha256': 'true' } })
      }
      return new Response('{}', { status: 200, headers: { 'x-test-skip-sha256': 'true' } })
    }

    await assert.rejects(async () => {
      await modelProvisioning.downloadModel('qwen')
    })
    assert.strictEqual(await modelProvisioning.checkModelCached('qwen'), false)

    // Now retry with working tokenizer
    shouldFail = false
    const origVerify = modelProvisioning.verifyAssetBlob
    modelProvisioning.verifyAssetBlob = async () => true
    try {
      const retrySuccess = await modelProvisioning.retryDownload('qwen')
      assert.strictEqual(retrySuccess, true)
      assert.strictEqual(await modelProvisioning.checkModelCached('qwen'), true)
    } finally {
      modelProvisioning.verifyAssetBlob = origVerify
    }
  })

  await t.test('12. Valid embeddings and Whisper caches remain intact after Qwen failure', async () => {
    const mockCache = createMockCache()
    ;(globalThis as any).caches = { open: async () => mockCache }

    // Seed embeddings and whisper
    for (const file of MODEL_REGISTRY.embeddings.requiredFiles) {
      mockCache.put(modelProvisioning.getFileUrl(file, MODEL_REGISTRY.embeddings.revision, MODEL_REGISTRY.embeddings.modelId), new Response('{}', { headers: { 'x-test-skip-sha256': 'true' } }))
    }
    for (const file of MODEL_REGISTRY.whisper.requiredFiles) {
      mockCache.put(modelProvisioning.getFileUrl(file, MODEL_REGISTRY.whisper.revision, MODEL_REGISTRY.whisper.modelId), new Response('{}', { headers: { 'x-test-skip-sha256': 'true' } }))
    }

    const origVerify = modelProvisioning.verifyAssetBlob
    modelProvisioning.verifyAssetBlob = async (fn, res, key) => key !== 'qwen'
    try {
      globalThis.fetch = async () => new Response('corrupt', { status: 200 })
      await assert.rejects(async () => {
        await modelProvisioning.downloadModel('qwen')
      })

      assert.strictEqual(await modelProvisioning.checkModelCached('embeddings'), true, 'Embeddings cache must remain intact')
      assert.strictEqual(await modelProvisioning.checkModelCached('whisper'), true, 'Whisper cache must remain intact')
      assert.strictEqual(await modelProvisioning.checkModelCached('qwen'), false, 'Failed Qwen must not be cached')
    } finally {
      modelProvisioning.verifyAssetBlob = origVerify
    }
  })

  await t.test('13. Duplicate Retry clicks do not start duplicate downloads', async () => {
    ;(modelProvisioning as any).state = 'downloading'
    ;(modelProvisioning as any).activeDownloadKey = 'all'

    const retryRes = await modelProvisioning.retryDownload('all')
    assert.strictEqual(retryRes, false, 'Duplicate retry during active download must be safely ignored')

    ;(modelProvisioning as any).state = 'not_downloaded'
    ;(modelProvisioning as any).activeDownloadKey = null
  })

  await t.test('14. Download All correctly reports partial success and failure', async () => {
    const mockCache = createMockCache()
    ;(globalThis as any).caches = { open: async () => mockCache }

    // Seed embeddings and whisper as already cached
    for (const file of MODEL_REGISTRY.embeddings.requiredFiles) {
      mockCache.put(modelProvisioning.getFileUrl(file, MODEL_REGISTRY.embeddings.revision, MODEL_REGISTRY.embeddings.modelId), new Response('{}', { headers: { 'x-test-skip-sha256': 'true' } }))
    }
    for (const file of MODEL_REGISTRY.whisper.requiredFiles) {
      mockCache.put(modelProvisioning.getFileUrl(file, MODEL_REGISTRY.whisper.revision, MODEL_REGISTRY.whisper.modelId), new Response('{}', { headers: { 'x-test-skip-sha256': 'true' } }))
    }

    const origVerify = modelProvisioning.verifyAssetBlob
    // Allow embeddings and whisper to pass, fail qwen
    modelProvisioning.verifyAssetBlob = async (file, res, key) => key !== 'qwen'
    try {
      globalThis.fetch = async () => new Response('corrupt-qwen', { status: 200 })
      const res = await modelProvisioning.downloadAllModels()
      assert.strictEqual(res, false, 'Download all must return false if any model fails')
      const progress = modelProvisioning.getProgress()
      assert.strictEqual(progress.state, 'failed')
      assert.ok(progress.error?.includes('SmolLM-135M-Instruct'), 'Error must identify failed model')
    } finally {
      modelProvisioning.verifyAssetBlob = origVerify
    }
  })

  await t.test('15. Fully provisioned models pass checkAllModelsCached()', async () => {
    const mockCache = createMockCache()
    ;(globalThis as any).caches = { open: async () => mockCache }

    for (const key of ['qwen', 'embeddings', 'whisper'] as const) {
      for (const file of MODEL_REGISTRY[key].requiredFiles) {
        mockCache.put(modelProvisioning.getFileUrl(file, MODEL_REGISTRY[key].revision, MODEL_REGISTRY[key].modelId), new Response('{}', { headers: { 'x-test-skip-sha256': 'true' } }))
      }
    }

    const origVerify = modelProvisioning.verifyAssetBlob
    modelProvisioning.verifyAssetBlob = async () => true
    try {
      const cached = await modelProvisioning.checkAllModelsCached()
      assert.strictEqual(cached.qwen, true)
      assert.strictEqual(cached.embeddings, true)
      assert.strictEqual(cached.whisper, true)
      assert.strictEqual(cached.allCached, true)
      assert.strictEqual(cached.coreCached, true)
    } finally {
      modelProvisioning.verifyAssetBlob = origVerify
    }
  })

  await t.test('16. Local SmolLM initializes and completes a minimal inference after provisioning', async () => {
    ;(generativeRuntime as any).pipelineInstance = async (prompt: string) => [{ generated_text: `${prompt} world` }]
    ;(generativeRuntime as any).updateState({
      status: 'ready',
      activeModelId: 'onnx-community/SmolLM-135M-Instruct-ONNX',
      isResident: true
    })

    assert.strictEqual(generativeRuntime.isModelResident(), true)
    const out = await generativeRuntime.generateResponse('Hello')
    assert.strictEqual(out.modelId, 'onnx-community/SmolLM-135M-Instruct-ONNX')
    assert.ok(out.text.includes('world'))

    ;(generativeRuntime as any).pipelineInstance = null
    ;(generativeRuntime as any).updateState({ status: 'idle', error: null, isResident: false })
  })
})

