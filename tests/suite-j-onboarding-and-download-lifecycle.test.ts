import { test } from 'node:test'
import assert from 'node:assert/strict'
import { 
  normalizeModelAvailability, 
  normalizeBuiltInAPIAvailability,
  inspectPromptAPIAvailability,
  checkPromptAPIAvailability,
  downloadOnDeviceModel,
  subscribeToModelDownload,
  getModelDownloadState,
  resetModelDownloadState,
  getPreservedSession,
  setPreservedSession,
  clearPreservedSession,
  resetPromptAPILifecycleMetrics,
  getPromptAPILifecycleMetrics
} from '../lib/ai-config'
import { setAISession, getAISession, isModelReady, destroySession } from '../lib/ai'

test('Suite J: AI Model Onboarding & Download Lifecycle', async (t) => {
  // Setup global mock environment
  const originalWindow = (global as any).window

  t.beforeEach(() => {
    resetModelDownloadState()
    resetPromptAPILifecycleMetrics()
    destroySession()
  })

  t.afterEach(() => {
    (global as any).window = originalWindow
    resetModelDownloadState()
    destroySession()
  })

  await t.test('1. Normalizes all Chrome availability strings to canonical 4-state contract', () => {
    // Accepted canonical states (case-insensitive & trimmed)
    assert.strictEqual(normalizeModelAvailability('available'), 'available')
    assert.strictEqual(normalizeModelAvailability('AVAILABLE'), 'available')
    assert.strictEqual(normalizeModelAvailability('  available  '), 'available')
    
    assert.strictEqual(normalizeModelAvailability('downloadable'), 'downloadable')
    assert.strictEqual(normalizeModelAvailability('DOWNLOADABLE'), 'downloadable')
    assert.strictEqual(normalizeModelAvailability('  downloadable  '), 'downloadable')

    assert.strictEqual(normalizeModelAvailability('downloading'), 'downloading')
    assert.strictEqual(normalizeModelAvailability('DOWNLOADING'), 'downloading')

    assert.strictEqual(normalizeModelAvailability('unavailable'), 'unavailable')
    assert.strictEqual(normalizeModelAvailability('UNAVAILABLE'), 'unavailable')

    assert.strictEqual(normalizeModelAvailability('timeout'), 'timeout')

    // Rejected legacy aliases: must strictly map to 'unavailable', NEVER 'available' or 'downloadable'
    assert.strictEqual(normalizeModelAvailability('readily'), 'unavailable')
    assert.strictEqual(normalizeModelAvailability('after-download'), 'unavailable')
    assert.strictEqual(normalizeModelAvailability('no'), 'unavailable')

    // Rejection of arbitrary / unknown strings: never false READY or false DOWNLOADABLE
    assert.strictEqual(normalizeModelAvailability('ready'), 'unavailable')
    assert.strictEqual(normalizeModelAvailability('installed'), 'unavailable')
    assert.strictEqual(normalizeModelAvailability('ok'), 'unavailable')
    assert.strictEqual(normalizeModelAvailability('download'), 'unavailable')
    assert.strictEqual(normalizeModelAvailability('unknown-status'), 'unavailable')
    assert.strictEqual(normalizeModelAvailability(''), 'unavailable')
    assert.strictEqual(normalizeModelAvailability(null), 'unavailable')
    assert.strictEqual(normalizeModelAvailability(undefined), 'unavailable')
    assert.strictEqual(normalizeModelAvailability({} as any), 'unavailable')
    assert.strictEqual(normalizeModelAvailability(123 as any), 'unavailable')
  })

  await t.test('2. inspectPromptAPIAvailability correctly detects Chrome 156 "downloadable" state', async () => {
    (global as any).window = {
      LanguageModel: {
        availability: async () => 'downloadable',
        create: async () => ({ destroy: () => {} })
      }
    }

    const { raw, normalized } = await inspectPromptAPIAvailability()
    assert.strictEqual(raw, 'downloadable')
    assert.strictEqual(normalized, 'downloadable')

    const state = getModelDownloadState()
    assert.strictEqual(state.status, 'downloadable')
    assert.strictEqual(state.rawAvailability, 'downloadable')
    assert.strictEqual(state.normalizedAvailability, 'downloadable')
  })

  await t.test('3. inspectPromptAPIAvailability correctly handles "available"', async () => {
    (global as any).window = {
      LanguageModel: {
        availability: async () => 'available',
        create: async () => ({ destroy: () => {} })
      }
    }

    const { raw, normalized } = await inspectPromptAPIAvailability()
    assert.strictEqual(raw, 'available')
    assert.strictEqual(normalized, 'available')

    const state = getModelDownloadState()
    assert.strictEqual(state.status, 'ready')
  })

  await t.test('4. inspectPromptAPIAvailability handles missing API or "unavailable" honestly', async () => {
    (global as any).window = {}

    const { raw, normalized } = await inspectPromptAPIAvailability()
    assert.strictEqual(raw, 'unavailable')
    assert.strictEqual(normalized, 'unavailable')

    const state = getModelDownloadState()
    assert.strictEqual(state.status, 'unsupported')
  })

  await t.test('5. downloadOnDeviceModel streams real progress via monitor callback and resolves session', async () => {
    let monitorCallback: any = null
    let mockSessionDestroyed = false

    const mockSession = {
      inputUsage: 100,
      inputQuota: 9216,
      destroy: () => { mockSessionDestroyed = true }
    };

    (global as any).window = {
      LanguageModel: {
        availability: async () => 'downloadable',
        create: async (options: any) => {
          if (options.monitor) {
            monitorCallback = options.monitor
          }
          return mockSession
        }
      }
    }

    const progressSnapshots: number[] = []
    const unsub = subscribeToModelDownload((st) => {
      progressSnapshots.push(st.progress)
    })

    // Start download
    const downloadPromise = downloadOnDeviceModel()

    // Verify monitor was attached
    assert.ok(monitorCallback, 'Monitor callback must be passed to LanguageModel.create()')

    // Simulate downloadprogress events from Chrome
    let progressListener: any = null
    monitorCallback({
      addEventListener: (evt: string, cb: any) => {
        if (evt === 'downloadprogress') progressListener = cb
      }
    })

    assert.ok(progressListener, 'downloadprogress listener must be registered')

    // Fire progressive events
    progressListener({ loaded: 0.25, total: 1.0 })
    assert.strictEqual(getModelDownloadState().progress, 25)

    progressListener({ loaded: 0.60, total: 1.0 })
    assert.strictEqual(getModelDownloadState().progress, 60)

    progressListener({ loaded: 1.0, total: 1.0 })
    assert.strictEqual(getModelDownloadState().progress, 100)

    const session = await downloadPromise
    assert.strictEqual(session, mockSession)

    const finalState = getModelDownloadState()
    assert.strictEqual(finalState.status, 'ready')
    assert.strictEqual(finalState.progress, 100)
    assert.ok(finalState.downloadDurationMs !== null && finalState.downloadDurationMs >= 0)

    // Check that preserved session is set and recognized
    assert.strictEqual(getPreservedSession(), mockSession)
    assert.strictEqual(isModelReady(), true)

    unsub()
  })

  await t.test('6. Deduplication: Concurrent download calls attach to the single in-flight promise', async () => {
    let createCallCount = 0

    const mockSession = { destroy: () => {} };

    (global as any).window = {
      LanguageModel: {
        availability: async () => 'downloadable',
        create: async () => {
          createCallCount++
          // Artificial latency
          await new Promise(r => setTimeout(r, 25))
          return mockSession
        }
      }
    }

    // Launch 3 concurrent downloads simultaneously
    const p1 = downloadOnDeviceModel()
    const p2 = downloadOnDeviceModel()
    const p3 = downloadOnDeviceModel()

    const [s1, s2, s3] = await Promise.all([p1, p2, p3])

    assert.strictEqual(createCallCount, 1, 'LanguageModel.create must only be called once')
    assert.strictEqual(s1, mockSession)
    assert.strictEqual(s2, mockSession)
    assert.strictEqual(s3, mockSession)
  })

  await t.test('7. Subsequent calls when model is already ready immediately return preserved session', async () => {
    let createCallCount = 0
    const mockSession = { destroy: () => {} };

    (global as any).window = {
      LanguageModel: {
        availability: async () => 'downloadable',
        create: async () => {
          createCallCount++
          return mockSession
        }
      }
    }

    const s1 = await downloadOnDeviceModel()
    assert.strictEqual(createCallCount, 1)

    // Second call after completion
    const s2 = await downloadOnDeviceModel()
    assert.strictEqual(createCallCount, 1, 'Should not re-call create() when already ready')
    assert.strictEqual(s2, s1)
  })

  await t.test('8. Error handling: Failed download sets error state and allows clean retry', async () => {
    let attempt = 0

    const mockSession = { destroy: () => {} };

    (global as any).window = {
      LanguageModel: {
        availability: async () => 'downloadable',
        create: async () => {
          attempt++
          if (attempt === 1) {
            throw new Error('Simulated network timeout during model streaming')
          }
          return mockSession
        }
      }
    }

    // Attempt 1: Fails
    await assert.rejects(async () => {
      await downloadOnDeviceModel()
    }, /Simulated network timeout/)

    const errState = getModelDownloadState()
    assert.strictEqual(errState.status, 'error')
    assert.match(errState.error || '', /Simulated network timeout/)

    // Attempt 2: Retry succeeds
    const session = await downloadOnDeviceModel()
    assert.strictEqual(session, mockSession)
    assert.strictEqual(getModelDownloadState().status, 'ready')
    assert.strictEqual(getModelDownloadState().error, null)
  })

  await t.test('9. Session handoff: lib/ai adopts preserved session without secondary creation', async () => {
    const mockSession = {
      inputUsage: 42,
      inputQuota: 9216,
      prompt: async () => 'OK',
      destroy: () => {}
    }

    setAISession(mockSession)
    assert.strictEqual(isModelReady(), true)
    assert.strictEqual(getAISession(), mockSession)

    destroySession()
    assert.strictEqual(isModelReady(), false)
  })

  await t.test('10. validateUITools() verifies complete UI tool implementation including captureAudio', () => {
    const { validateUITools, executeUITool } = require('../lib/ui-tools')
    const { getUITools } = require('../lib/tool-registry')

    // getUITools must contain captureAudio
    const uiTools = getUITools()
    const captureAudioTool = uiTools.find((t: any) => t.name === 'captureAudio')
    assert.ok(captureAudioTool, 'captureAudio must be present in UI tools')
    assert.strictEqual(captureAudioTool.requiresUserGesture, true)

    // validateUITools must run without throwing or reporting missing tools
    let errorLogged = false
    const originalConsoleError = console.error
    console.error = (...args: any[]) => {
      if (args[0]?.includes?.('Missing UI tool implementations')) {
        errorLogged = true
      }
      originalConsoleError(...args)
    }

    try {
      validateUITools()
      assert.strictEqual(errorLogged, false, 'validateUITools must not find any missing UI tools')
    } finally {
      console.error = originalConsoleError
    }
  })

  await t.test('11. executeUITool routes captureAudio through authorized UI handler', async () => {
    const { executeUITool } = await import('../lib/ui-tools')
    const { voiceAuthorizationManager } = await import('../lib/audio/voice-authorization-manager')

    // Mock chrome environment for test
    const originalChrome = (global as any).chrome
    let captureTabAudioSent = false

    ;(global as any).chrome = {
      runtime: { id: 'test-ext-id' },
      tabs: {
        query: async () => [{ id: 123, url: 'https://youtube.com/watch?v=abc' }],
        sendMessage: (tabId: number, message: any, cb: any) => {
          if (message.type === 'capture_tab_audio') {
            captureTabAudioSent = true
            cb({ result: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEA' })
          }
        }
      },
      tabCapture: {
        getMediaStreamId: (opts: any, cb: any) => {
          cb('mock-stream-id-456')
        }
      }
    }

    try {
      // 1. Unauthorized invocation should be rejected by Voice Authorization Gate
      const unauthResult = await executeUITool({
        function: 'captureAudio',
        arguments: { duration: 5 }
      })
      assert.strictEqual(unauthResult.success, false)
      assert.match(unauthResult.error, /Authorization denied/)

      // 2. Issue valid token using mintToken
      const turnId = 101
      const userId = 'test_user'
      const sessionId = 'test_session'
      voiceAuthorizationManager.setActiveContext({ userId, sessionId, turnId })
      voiceAuthorizationManager.advanceTurn(turnId)

      const token = voiceAuthorizationManager.mintToken({
        turnId,
        userId,
        sessionId,
        mode: 'UNIVERSAL_VOICE',
        activationMethod: 'PUSH_TO_TALK',
        isPttActive: true
      })

      const authResult = await executeUITool(
        { function: 'captureAudio', arguments: { duration: 5 } },
        token,
        true,
        { turnId, userId, sessionId }
      )

      assert.strictEqual(authResult.success, true)
      assert.ok(authResult.result?.result?.includes('Captured 5s of audio'))
      assert.strictEqual(captureTabAudioSent, true)
    } finally {
      (global as any).chrome = originalChrome
    }
  })

  await t.test('12. Availability check times out instead of hanging indefinitely', async () => {
    // Mock LanguageModel that hangs forever
    (global as any).window = {
      LanguageModel: {
        availability: () => new Promise(() => {}) // never resolves
      }
    }

    const startTime = Date.now()
    // Test with explicit 100ms timeout
    const result = await checkPromptAPIAvailability({ timeoutMs: 100 })
    const elapsed = Date.now() - startTime

    assert.strictEqual(result, 'timeout', 'Hanging availability check must resolve to timeout after timeout')
    assert.ok(elapsed >= 90 && elapsed < 1000, `Elapsed time was ${elapsed}ms`)
  })

  await t.test('13. Availability check fallback when options object is rejected', async () => {
    let optionsCallAttempted = false;
    let noArgsCallAttempted = false;

    (global as any).window = {
      LanguageModel: {
        availability: async (options?: any) => {
          if (options && Object.keys(options).length > 0) {
            optionsCallAttempted = true
            throw new TypeError('Unexpected option expectedInputs')
          }
          noArgsCallAttempted = true
          return 'downloadable'
        }
      }
    }

    const result = await checkPromptAPIAvailability({ multimodal: false })
    assert.strictEqual(optionsCallAttempted, true)
    assert.strictEqual(noArgsCallAttempted, true)
    assert.strictEqual(result, 'downloadable')
  })

  await t.test('14. Deduplication of concurrent availability checks', async () => {
    let checkCount = 0;

    (global as any).window = {
      LanguageModel: {
        availability: async () => {
          checkCount++
          await new Promise(r => setTimeout(r, 20))
          return 'downloadable'
        }
      }
    }

    resetModelDownloadState()
    const [r1, r2, r3] = await Promise.all([
      inspectPromptAPIAvailability(),
      inspectPromptAPIAvailability(),
      inspectPromptAPIAvailability()
    ])

    assert.strictEqual(checkCount, 1, 'Concurrent availability checks must share single promise')
    assert.strictEqual(r1.normalized, 'downloadable')
    assert.strictEqual(r2.normalized, 'downloadable')
    assert.strictEqual(r3.normalized, 'downloadable')
  })

  await t.test('15. Stale availability response protection: newer retry is never overwritten', async () => {
    const { resetAvailabilityCheckState } = await import('../lib/ai-config')
    let slowResolve: any = null;

    // Call 1: Slow / hanging check
    (global as any).window = {
      LanguageModel: {
        availability: () => new Promise(res => { slowResolve = res })
      }
    }

    resetModelDownloadState()
    const check1 = inspectPromptAPIAvailability(40) // times out in 40ms
    const r1 = await check1
    assert.strictEqual(r1.isTimeout, true)
    assert.strictEqual(getModelDownloadState().status, 'error')

    // Call 2: User retries, and this one resolves as 'downloadable'
    resetAvailabilityCheckState();
    (global as any).window = {
      LanguageModel: {
        availability: async () => 'downloadable'
      }
    }
    const r2 = await inspectPromptAPIAvailability()
    assert.strictEqual(r2.normalized, 'downloadable')
    assert.strictEqual(getModelDownloadState().status, 'downloadable')

    // Now slow call 1 finally resolves late in the background
    if (slowResolve) {
      slowResolve('unavailable')
    }
    await new Promise(r => setTimeout(r, 10))

    // State must STILL be 'downloadable', NOT overwritten by late call 1!
    assert.strictEqual(getModelDownloadState().status, 'downloadable', 'Late stale resolution must not overwrite newer state')
  })

  await t.test('16. Pre-acquired tab capture stream ID works during direct user gesture', async () => {
    const { acquireTabCaptureStreamId, consumePreAcquiredStreamId, default: captureAudio } = await import('../lib/tools/captureAudio')

    const originalChrome = (global as any).chrome
    let getMediaStreamIdCalled = false

    ;(global as any).chrome = {
      tabs: {
        query: async () => [{ id: 888, url: 'https://youtube.com/watch?v=123' }],
        sendMessage: (tabId: number, msg: any, cb: any) => {
          cb({ result: 'data:audio/wav;base64,AAA' })
        }
      },
      tabCapture: {
        getMediaStreamId: (opts: any, cb: any) => {
          getMediaStreamIdCalled = true
          cb('trusted-user-gesture-stream-999')
        }
      }
    }

    try {
      // 1. Direct gesture simulates user click invoking acquireTabCaptureStreamId
      const streamId = await acquireTabCaptureStreamId(888)
      assert.strictEqual(getMediaStreamIdCalled, true)
      assert.strictEqual(streamId, 'trusted-user-gesture-stream-999')

      // 2. captureAudio consumes pre-acquired stream ID
      const result = await captureAudio({ duration: 5 })
      assert.strictEqual(result.success, true)
      assert.strictEqual(result.audioDataUrl, 'data:audio/wav;base64,AAA')

      // 3. Second call has no pre-acquired stream left (single-use)
      assert.strictEqual(consumePreAcquiredStreamId(888), null)
    } finally {
      (global as any).chrome = originalChrome
    }
  })

  await t.test('17. captureAudio returns structured user gesture guidance when activation expired', async () => {
    const { default: captureAudio } = await import('../lib/tools/captureAudio')

    const originalChrome = (global as any).chrome

    ;(global as any).chrome = {
      tabs: {
        query: async () => [{ id: 777, url: 'https://example.com' }]
      },
      tabCapture: {
        getMediaStreamId: (opts: any, cb: any) => {
          (global as any).chrome.runtime.lastError = new Error('Extension has not been invoked for the current page')
          cb(null)
        }
      }
    }

    try {
      const result = await captureAudio({ duration: 5 })
      assert.strictEqual(result.success, false)
      assert.strictEqual(result.requiresUserGesture, true)
      assert.ok(result.error.includes('Tab audio capture requires a direct click gesture'))
    } finally {
      (global as any).chrome = originalChrome
    }
  })

  await t.test('18. normalizeBuiltInAPIAvailability enforces 4-state contract and prevents false READY', () => {
    // Exact valid states (case-insensitive & trimmed)
    assert.strictEqual(normalizeBuiltInAPIAvailability('available'), 'available')
    assert.strictEqual(normalizeBuiltInAPIAvailability('AVAILABLE'), 'available')
    assert.strictEqual(normalizeBuiltInAPIAvailability('  available  '), 'available')
    assert.strictEqual(normalizeBuiltInAPIAvailability('downloadable'), 'downloadable')
    assert.strictEqual(normalizeBuiltInAPIAvailability('DOWNLOADABLE'), 'downloadable')
    assert.strictEqual(normalizeBuiltInAPIAvailability('  downloadable  '), 'downloadable')
    assert.strictEqual(normalizeBuiltInAPIAvailability('downloading'), 'downloading')
    assert.strictEqual(normalizeBuiltInAPIAvailability('DOWNLOADING'), 'downloading')
    assert.strictEqual(normalizeBuiltInAPIAvailability('unavailable'), 'unavailable')
    assert.strictEqual(normalizeBuiltInAPIAvailability('UNAVAILABLE'), 'unavailable')

    // Rejected aliases: 'readily' and 'after-download' must NEVER map to available or downloadable
    assert.strictEqual(normalizeBuiltInAPIAvailability('readily'), 'unavailable')
    assert.strictEqual(normalizeBuiltInAPIAvailability('after-download'), 'unavailable')
    assert.strictEqual(normalizeBuiltInAPIAvailability('no'), 'unavailable')

    // False READY prevention: unknown status, null, undefined, or empty must NEVER be 'available' or 'ready'
    assert.strictEqual(normalizeBuiltInAPIAvailability('ready'), 'unavailable')
    assert.strictEqual(normalizeBuiltInAPIAvailability('installed'), 'unavailable')
    assert.strictEqual(normalizeBuiltInAPIAvailability('download'), 'unavailable')
    assert.strictEqual(normalizeBuiltInAPIAvailability('ok'), 'unavailable')
    assert.strictEqual(normalizeBuiltInAPIAvailability('unknown'), 'unavailable')
    assert.strictEqual(normalizeBuiltInAPIAvailability(''), 'unavailable')
    assert.strictEqual(normalizeBuiltInAPIAvailability(null), 'unavailable')
    assert.strictEqual(normalizeBuiltInAPIAvailability(undefined), 'unavailable')
    assert.strictEqual(normalizeBuiltInAPIAvailability({} as any), 'unavailable')
    assert.strictEqual(normalizeBuiltInAPIAvailability(42 as any), 'unavailable')
  })

  await t.test('19. All 6 built-in AI capabilities probe availability contracts without throwing', async () => {
    // Verify each of the 6 Chrome built-in AI APIs can be probed:
    // LanguageModel, Summarizer, Writer, Rewriter, Translator, LanguageDetector
    const mockWindow: any = {
      LanguageModel: { availability: async () => 'downloadable' },
      Summarizer: { availability: async () => 'available' },
      Writer: { availability: async () => 'downloadable' },
      Rewriter: { availability: async () => 'unavailable' },
      Translator: {
        availability: async (opts: any) => {
          assert.strictEqual(opts.sourceLanguage, 'en')
          assert.strictEqual(opts.targetLanguage, 'es')
          return 'downloading'
        }
      },
      LanguageDetector: { availability: async () => 'available' }
    }

    // LanguageModel
    const lmRaw = await mockWindow.LanguageModel.availability()
    assert.strictEqual(normalizeModelAvailability(lmRaw), 'downloadable')

    // Summarizer
    const sumRaw = await mockWindow.Summarizer.availability()
    assert.strictEqual(normalizeBuiltInAPIAvailability(sumRaw), 'available')

    // Writer
    const wRaw = await mockWindow.Writer.availability()
    assert.strictEqual(normalizeBuiltInAPIAvailability(wRaw), 'downloadable')

    // Rewriter
    const rRaw = await mockWindow.Rewriter.availability()
    assert.strictEqual(normalizeBuiltInAPIAvailability(rRaw), 'unavailable')

    // Translator
    const tRaw = await mockWindow.Translator.availability({ sourceLanguage: 'en', targetLanguage: 'es' })
    assert.strictEqual(normalizeBuiltInAPIAvailability(tRaw), 'downloading')

    // LanguageDetector
    const ldRaw = await mockWindow.LanguageDetector.availability()
    assert.strictEqual(normalizeBuiltInAPIAvailability(ldRaw), 'available')

    // Verify rejection handling (when API call rejects or throws)
    mockWindow.Writer.availability = async () => { throw new Error('Internal hardware error') }
    let writerStatus = 'unavailable'
    try {
      writerStatus = normalizeBuiltInAPIAvailability(await mockWindow.Writer.availability())
    } catch {
      writerStatus = 'unavailable'
    }
    assert.strictEqual(writerStatus, 'unavailable', 'Rejected promise must safely resolve to unavailable')
  })

  await t.test('20. Readiness status semantics: presence !== ready; downloadable/downloading/unknown !== ready', async () => {
    // 1. API presence with 'downloadable' does NOT set status to ready
    (global as any).window = {
      LanguageModel: {
        availability: async () => 'downloadable',
        create: async () => ({ destroy: () => {} })
      }
    }
    resetModelDownloadState()
    const r1 = await inspectPromptAPIAvailability()
    assert.strictEqual(r1.normalized, 'downloadable')
    assert.strictEqual(getModelDownloadState().status, 'downloadable')
    assert.notStrictEqual(getModelDownloadState().status, 'ready')
    assert.strictEqual(isModelReady(), false)

    // 2. API presence with 'downloading' does NOT set status to ready
    resetModelDownloadState();
    (global as any).window.LanguageModel.availability = async () => 'downloading'
    const r2 = await inspectPromptAPIAvailability()
    assert.strictEqual(r2.normalized, 'downloading')
    assert.strictEqual(getModelDownloadState().status, 'downloading')
    assert.notStrictEqual(getModelDownloadState().status, 'ready')
    assert.strictEqual(isModelReady(), false)

    // 3. Unknown string does NOT set status to ready
    resetModelDownloadState();
    (global as any).window.LanguageModel.availability = async () => 'unrecognized_state_foo'
    const r3 = await inspectPromptAPIAvailability()
    assert.strictEqual(r3.normalized, 'unavailable')
    assert.strictEqual(getModelDownloadState().status, 'unsupported')
    assert.notStrictEqual(getModelDownloadState().status, 'ready')
    assert.strictEqual(isModelReady(), false)

    // 4. Only 'available' sets status to ready
    resetModelDownloadState();
    (global as any).window.LanguageModel.availability = async () => 'available'
    const r4 = await inspectPromptAPIAvailability()
    assert.strictEqual(r4.normalized, 'available')
    assert.strictEqual(getModelDownloadState().status, 'ready')
  })
})
