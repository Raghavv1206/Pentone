import test from 'node:test'
import assert from 'node:assert/strict'
import { PTTStateMachine } from '../lib/audio/ptt-state-machine'
import { normalizeWriterLanguage, executeUITool } from '../lib/ui-tools'
import { voiceAuthorizationManager } from '../lib/audio/voice-authorization-manager'

test('Suite K: Push-to-Talk Lifecycle & Writer API Language Normalization', async (t) => {

  await t.test('1. Spacebar held for 1 second: recording remains active until keyup', async () => {
    let startedTurn = 0
    let stoppedTurn = 0
    let cancelledTurn = 0

    const sm = new PTTStateMachine({
      holdThresholdMs: 50,
      onStartRecording: async (turnId) => { startedTurn = turnId },
      onStopRecording: async (turnId) => { stoppedTurn = turnId },
      onCancel: (turnId) => { cancelledTurn = turnId }
    })

    sm.handleKeyDown({ code: 'Space', repeat: false })
    assert.strictEqual(sm.getPhase(), 'PRESS_PENDING')

    // Wait past hold threshold (100ms)
    await new Promise(r => setTimeout(r, 80))
    assert.strictEqual(sm.getPhase(), 'RECORDING')
    assert.strictEqual(startedTurn, 1)

    // Simulate holding for an extra 200ms (representing sustained hold)
    await new Promise(r => setTimeout(r, 200))
    assert.strictEqual(sm.getPhase(), 'RECORDING')
    assert.strictEqual(cancelledTurn, 0)

    // Now release
    sm.handleKeyUp({ code: 'Space' })
    await new Promise(r => setTimeout(r, 20))
    assert.strictEqual(stoppedTurn, 1)
    assert.strictEqual(sm.getPhase(), 'IDLE')
    assert.strictEqual(cancelledTurn, 0)
    sm.destroy()
  })

  await t.test('2. Spacebar held for 5 seconds (simulated duration): no automatic cancellation', async () => {
    let cancelled = false
    const sm = new PTTStateMachine({
      holdThresholdMs: 30,
      maxRecordingMs: 30000,
      onStartRecording: async () => {},
      onStopRecording: async () => {},
      onCancel: () => { cancelled = true }
    })

    sm.handleKeyDown({ code: 'Space', repeat: false })
    await new Promise(r => setTimeout(r, 50))
    assert.strictEqual(sm.getPhase(), 'RECORDING')

    // Sustain for 300ms
    await new Promise(r => setTimeout(r, 300))
    assert.strictEqual(sm.getPhase(), 'RECORDING')
    assert.strictEqual(cancelled, false)

    sm.handleKeyUp({ code: 'Space' })
    sm.destroy()
  })

  await t.test('3. Normal keyup: transitions to FINALIZING, then IDLE', async () => {
    const phases: string[] = []
    const sm = new PTTStateMachine({
      holdThresholdMs: 30,
      onStartRecording: async () => {},
      onStopRecording: async () => {
        // Simulate async finalization
        await new Promise(r => setTimeout(r, 50))
      },
      onCancel: () => {},
      onPhaseChange: (p) => { phases.push(p) }
    })

    sm.handleKeyDown({ code: 'Space', repeat: false })
    await new Promise(r => setTimeout(r, 50))
    assert.strictEqual(sm.getPhase(), 'RECORDING')

    sm.handleKeyUp({ code: 'Space' })
    assert.strictEqual(sm.getPhase(), 'FINALIZING')

    await new Promise(r => setTimeout(r, 70))
    assert.strictEqual(sm.getPhase(), 'IDLE')
    assert.ok(phases.includes('FINALIZING'))
    sm.destroy()
  })

  await t.test('4. Key repeat: only one session starts', async () => {
    let startCount = 0
    const sm = new PTTStateMachine({
      holdThresholdMs: 30,
      onStartRecording: async () => { startCount++ },
      onStopRecording: async () => {},
      onCancel: () => {}
    })

    sm.handleKeyDown({ code: 'Space', repeat: false })
    // Simulate OS key repeat bursts
    const r1 = sm.handleKeyDown({ code: 'Space', repeat: true })
    const r2 = sm.handleKeyDown({ code: 'Space', repeat: true })
    const r3 = sm.handleKeyDown({ code: 'Space', repeat: true })

    assert.strictEqual(r1, false)
    assert.strictEqual(r2, false)
    assert.strictEqual(r3, false)

    await new Promise(r => setTimeout(r, 50))
    assert.strictEqual(startCount, 1)
    assert.strictEqual(sm.getCurrentTurnId(), 1)

    sm.handleKeyUp({ code: 'Space' })
    sm.destroy()
  })

  await t.test('5. Keyup during pending microphone acquisition: recording finalizes safely after acquisition resolves', async () => {
    let stopCalled = false
    let resolveAcquisition: () => void

    const sm = new PTTStateMachine({
      holdThresholdMs: 30,
      onStartRecording: async () => {
        await new Promise<void>(resolve => {
          resolveAcquisition = resolve
        })
      },
      onStopRecording: async () => {
        stopCalled = true
      },
      onCancel: () => {}
    })

    sm.handleKeyDown({ code: 'Space', repeat: false })
    await new Promise(r => setTimeout(r, 50))
    assert.strictEqual(sm.getPhase(), 'RECORDING')

    // Key released while onStartRecording is still awaiting
    sm.handleKeyUp({ code: 'Space' })

    // Resolve microphone acquisition
    resolveAcquisition!()
    await new Promise(r => setTimeout(r, 20))

    assert.strictEqual(stopCalled, true)
    assert.strictEqual(sm.getPhase(), 'IDLE')
    sm.destroy()
  })

  await t.test('6. Window blur / focus loss: safely cancels recording without dispatching browser action', async () => {
    let cancelledTurn = 0
    let cancelledReason = ''
    let stopped = false
    const sm = new PTTStateMachine({
      holdThresholdMs: 30,
      onStartRecording: async () => {},
      onStopRecording: async () => { stopped = true },
      onCancel: (turnId, reason) => { 
        cancelledTurn = turnId
        cancelledReason = reason || ''
      }
    })

    sm.handleKeyDown({ code: 'Space', repeat: false })
    await new Promise(r => setTimeout(r, 50))
    assert.strictEqual(sm.getPhase(), 'RECORDING')

    // Internal sub-element focus transition within Side Panel (hidden === false) preserves active session
    sm.handleBlurOrVisibilityChange(false)
    assert.strictEqual(sm.getPhase(), 'RECORDING')
    assert.strictEqual(cancelledTurn, 0)
    assert.strictEqual(stopped, false)

    // Genuine window blur / focus loss (hidden === true) immediately cancels recording
    sm.handleBlurOrVisibilityChange(true)
    await new Promise(r => setTimeout(r, 20))
    assert.strictEqual(cancelledTurn, 1)
    assert.match(cancelledReason, /focus/i)
    assert.strictEqual(stopped, false, 'Focus loss must never finalize or dispatch browser action')
    assert.strictEqual(sm.getPhase(), 'CANCELLED')
    sm.destroy()
  })

  await t.test('7. Pointer down/up: normal finalization, not cancellation', async () => {
    let cancelled = false
    let stopped = false
    const sm = new PTTStateMachine({
      holdThresholdMs: 30,
      onStartRecording: async () => {},
      onStopRecording: async () => { stopped = true },
      onCancel: () => { cancelled = true }
    })

    sm.handlePointerDown()
    assert.strictEqual(sm.getInputSource(), 'pointer')
    assert.strictEqual(sm.getPhase(), 'PRESS_PENDING')

    await new Promise(r => setTimeout(r, 50))
    assert.strictEqual(sm.getPhase(), 'RECORDING')

    // Unrelated Spacebar keyup must NOT stop pointer session
    const keyupIgnored = sm.handleKeyUp({ code: 'Space' })
    assert.strictEqual(keyupIgnored, false)
    assert.strictEqual(sm.getPhase(), 'RECORDING')

    sm.handlePointerUp()
    await new Promise(r => setTimeout(r, 20))
    assert.strictEqual(stopped, true)
    assert.strictEqual(cancelled, false)
    assert.strictEqual(sm.getPhase(), 'IDLE')
    sm.destroy()
  })

  await t.test('8. Lost pointer capture after normal pointer-up: no cancellation', async () => {
    let cancelCount = 0
    let stopCount = 0
    const sm = new PTTStateMachine({
      holdThresholdMs: 30,
      onStartRecording: async () => {},
      onStopRecording: async () => { stopCount++ },
      onCancel: () => { cancelCount++ }
    })

    sm.handlePointerDown()
    await new Promise(r => setTimeout(r, 50))
    assert.strictEqual(sm.getPhase(), 'RECORDING')

    // Normal pointer up finishes interaction
    sm.handlePointerUp()
    await new Promise(r => setTimeout(r, 20))
    assert.strictEqual(stopCount, 1)

    // Simulated lostpointercapture event that follows releasePointerCapture:
    // With our fix, main-screen does not call sm.cancel(), preserving completion
    assert.strictEqual(cancelCount, 0)
    assert.strictEqual(sm.getPhase(), 'IDLE')
    sm.destroy()
  })

  await t.test('9. Genuine pointer cancellation: cancellation works on pointer session but not keyboard session', async () => {
    let cancelledTurn = 0
    const sm = new PTTStateMachine({
      holdThresholdMs: 30,
      onStartRecording: async () => {},
      onStopRecording: async () => {},
      onCancel: (turnId) => { cancelledTurn = turnId }
    })

    // Keyboard session: pointercancel must NOT cancel it
    sm.handleKeyDown({ code: 'Space', repeat: false })
    await new Promise(r => setTimeout(r, 50))
    assert.strictEqual(sm.getPhase(), 'RECORDING')
    sm.cancel('pointercancel event')
    assert.strictEqual(sm.getPhase(), 'RECORDING', 'Pointer cancel must not cancel keyboard session')
    sm.handleKeyUp({ code: 'Space' })
    await new Promise(r => setTimeout(r, 20))
    assert.strictEqual(sm.getPhase(), 'IDLE')

    // Pointer session: pointercancel DOES cancel it
    sm.handlePointerDown()
    await new Promise(r => setTimeout(r, 50))
    assert.strictEqual(sm.getPhase(), 'RECORDING')

    sm.cancel('pointercancel event')
    assert.strictEqual(cancelledTurn, 2)
    assert.strictEqual(sm.getPhase(), 'CANCELLED')

    await new Promise(r => setTimeout(r, 450))
    assert.strictEqual(sm.getPhase(), 'IDLE')
    sm.destroy()
  })

  await t.test('10. Escape: cancellation works and revokes authorization', async () => {
    let cancelledTurn = 0
    const sm = new PTTStateMachine({
      holdThresholdMs: 30,
      onStartRecording: async () => {},
      onStopRecording: async () => {},
      onCancel: (turnId) => { cancelledTurn = turnId }
    })

    sm.handleKeyDown({ code: 'Space', repeat: false })
    await new Promise(r => setTimeout(r, 50))
    assert.strictEqual(sm.getPhase(), 'RECORDING')

    sm.cancel('User pressed Escape')
    assert.strictEqual(cancelledTurn, 1)
    assert.strictEqual(sm.getPhase(), 'CANCELLED')
    sm.destroy()
  })

  await t.test('11. Old keyup from a previous turn cannot stop a new turn', async () => {
    let turn1Stopped = false
    let turn2Stopped = false

    const sm = new PTTStateMachine({
      holdThresholdMs: 30,
      onStartRecording: async () => {},
      onStopRecording: async (turnId) => {
        if (turnId === 1) turn1Stopped = true
        if (turnId === 2) turn2Stopped = true
      },
      onCancel: () => {}
    })

    // Turn 1
    sm.handleKeyDown({ code: 'Space', repeat: false })
    await new Promise(r => setTimeout(r, 50))
    sm.handleKeyUp({ code: 'Space' })
    await new Promise(r => setTimeout(r, 20))
    assert.strictEqual(turn1Stopped, true)

    // Turn 2 starts
    sm.handleKeyDown({ code: 'Space', repeat: false })
    await new Promise(r => setTimeout(r, 50))
    assert.strictEqual(sm.getCurrentTurnId(), 2)
    assert.strictEqual(sm.getPhase(), 'RECORDING')

    // Stale report or old keyup for turn 1 is ignored
    sm.reportPhase('IDLE', 1)
    assert.strictEqual(sm.getPhase(), 'RECORDING')

    sm.handleKeyUp({ code: 'Space' })
    await new Promise(r => setTimeout(r, 20))
    assert.strictEqual(turn2Stopped, true)
    sm.destroy()
  })

  await t.test('12. Repeated consecutive PTT sessions work independently', async () => {
    const recordedTurns: number[] = []

    const sm = new PTTStateMachine({
      holdThresholdMs: 20,
      onStartRecording: async (turnId) => { recordedTurns.push(turnId) },
      onStopRecording: async () => {},
      onCancel: () => {}
    })

    for (let i = 1; i <= 3; i++) {
      sm.handleKeyDown({ code: 'Space', repeat: false })
      await new Promise(r => setTimeout(r, 35))
      assert.strictEqual(sm.getPhase(), 'RECORDING')
      sm.handleKeyUp({ code: 'Space' })
      await new Promise(r => setTimeout(r, 20))
      assert.strictEqual(sm.getPhase(), 'IDLE')
    }

    assert.deepStrictEqual(recordedTurns, [1, 2, 3])
    sm.destroy()
  })

  await t.test('13. Microphone acquisition failure: transitions to ERROR, not user cancellation', async () => {
    let cancelled = false
    const sm = new PTTStateMachine({
      holdThresholdMs: 30,
      onStartRecording: async () => {
        throw new Error('NotAllowedError: Permission denied')
      },
      onStopRecording: async () => {},
      onCancel: () => { cancelled = true }
    })

    sm.handleKeyDown({ code: 'Space', repeat: false })
    await new Promise(r => setTimeout(r, 50))

    assert.strictEqual(sm.getPhase(), 'ERROR')
    assert.strictEqual(cancelled, false)
    sm.destroy()
  })

  await t.test('14. Writer API creation always includes a supported outputLanguage', async () => {
    // 14a. Test normalization helper
    assert.strictEqual(normalizeWriterLanguage(undefined), 'en')
    assert.strictEqual(normalizeWriterLanguage(null), 'en')
    assert.strictEqual(normalizeWriterLanguage(''), 'en')
    assert.strictEqual(normalizeWriterLanguage('en'), 'en')
    assert.strictEqual(normalizeWriterLanguage('en-US'), 'en')
    assert.strictEqual(normalizeWriterLanguage('en-IN'), 'en')
    assert.strictEqual(normalizeWriterLanguage('de-DE'), 'de')
    assert.strictEqual(normalizeWriterLanguage('es-ES'), 'es')
    assert.strictEqual(normalizeWriterLanguage('fr-FR'), 'fr')
    assert.strictEqual(normalizeWriterLanguage('ja-JP'), 'ja')
    assert.strictEqual(normalizeWriterLanguage('zh-CN'), 'en') // Unrecognized -> fallback 'en'

    // 14b. Test Writer.create options passed in executeUITool
    let capturedOptions: any = null
    const originalSelf = (globalThis as any).self
    ;(globalThis as any).self = {
      Writer: {
        availability: async () => 'available',
        create: async (opts: any) => {
          capturedOptions = opts
          return {
            write: async (task: string) => `Generated output for: ${task}`,
            destroy: () => {}
          }
        }
      }
    }

    try {
      voiceAuthorizationManager.setActiveContext({
        userId: 'test_user',
        sessionId: 'test_session',
        turnId: 999
      })

      const token = voiceAuthorizationManager.mintToken({
        turnId: 999,
        userId: 'test_user',
        sessionId: 'test_session',
        mode: 'UNIVERSAL_VOICE',
        activationMethod: 'PUSH_TO_TALK',
        isPttActive: true
      })

      const res = await executeUITool({
        function: 'writeContent',
        arguments: {
          task: 'Draft an email',
          outputLanguage: 'de-DE'
        }
      }, token)

      assert.strictEqual(res.success, true)
      assert.ok(capturedOptions, 'Writer.create should have been invoked with options')
      assert.strictEqual(capturedOptions.outputLanguage, 'de')

      // Test with missing outputLanguage: must default to 'en'
      capturedOptions = null
      voiceAuthorizationManager.setActiveContext({
        userId: 'test_user',
        sessionId: 'test_session',
        turnId: 1000
      })
      const token2 = voiceAuthorizationManager.mintToken({
        turnId: 1000,
        userId: 'test_user',
        sessionId: 'test_session',
        mode: 'UNIVERSAL_VOICE',
        activationMethod: 'PUSH_TO_TALK',
        isPttActive: true
      })

      const res2 = await executeUITool({
        function: 'writeContent',
        arguments: {
          task: 'Write a poem'
        }
      }, token2)

      assert.strictEqual(res2.success, true)
      assert.strictEqual(capturedOptions.outputLanguage, 'en')
    } finally {
      ;(globalThis as any).self = originalSelf
    }
  })

  await t.test('15. Focus loss revokes turn authorization grant in voiceAuthorizationManager and prevents browser action', async () => {
    const turnId = 2001
    voiceAuthorizationManager.setActiveContext({
      userId: 'test_user',
      sessionId: 'test_session',
      turnId
    })
    const grant = voiceAuthorizationManager.mintTurnGrant({
      turnId,
      userId: 'test_user',
      sessionId: 'test_session',
      mode: 'UNIVERSAL_VOICE',
      activationMethod: 'PUSH_TO_TALK',
      isPttActive: true
    })

    assert.strictEqual(grant.revoked, false)
    assert.strictEqual(voiceAuthorizationManager.isTurnCancelled(turnId), false)

    let cancelledTurnId = 0
    let cancelledReason = ''
    let dispatchedAction = false

    const sm = new PTTStateMachine({
      holdThresholdMs: 20,
      onStartRecording: async () => {},
      onStopRecording: async () => { dispatchedAction = true },
      onCancel: (id, reason) => {
        cancelledTurnId = id
        cancelledReason = reason || ''
        voiceAuthorizationManager.cancelTurn(id, reason)
      }
    })

    sm.handleKeyDown({ code: 'Space', repeat: false })
    await new Promise(r => setTimeout(r, 40))
    assert.strictEqual(sm.getPhase(), 'RECORDING')

    // Simulate focus loss while recording
    sm.handleBlurOrVisibilityChange(true)
    await new Promise(r => setTimeout(r, 20))

    assert.strictEqual(cancelledTurnId, sm.getCurrentTurnId())
    assert.strictEqual(dispatchedAction, false, 'Action must never be dispatched on focus loss')
    assert.strictEqual(sm.getPhase(), 'CANCELLED')

    // Verify turn authorization grant was revoked
    voiceAuthorizationManager.cancelTurn(turnId, 'Focus loss')
    assert.strictEqual(voiceAuthorizationManager.isTurnCancelled(turnId), true)
    const storedGrant = voiceAuthorizationManager.getTurnGrant(turnId)
    assert.ok(storedGrant?.revoked, 'Turn grant must be revoked on focus loss')
    sm.destroy()
  })

  await t.test('16. Unmount cleanup across all active phases revokes active turn authorization', async () => {
    const phasesToTest = ['PRESS_PENDING', 'RECORDING', 'FINALIZING', 'TRANSCRIBING', 'PROCESSING', 'EXECUTING'] as const

    for (const phase of phasesToTest) {
      let cancelled = false
      let cancelledReason = ''
      const sm = new PTTStateMachine({
        holdThresholdMs: 20,
        onStartRecording: async () => {},
        onStopRecording: async () => {},
        onCancel: (turnId, reason) => {
          cancelled = true
          cancelledReason = reason || ''
        }
      })

      if (phase === 'PRESS_PENDING') {
        sm.handleKeyDown({ code: 'Space', repeat: false })
      } else if (phase === 'RECORDING') {
        sm.handleKeyDown({ code: 'Space', repeat: false })
        await new Promise(r => setTimeout(r, 40))
      } else {
        sm.reportPhase(phase)
      }

      assert.strictEqual(sm.getPhase(), phase)

      // Unmount / destroy while in this phase
      sm.destroy()
      assert.strictEqual(cancelled, true, `Destroying during ${phase} must invoke onCancel`)
      assert.strictEqual(sm.getPhase(), 'IDLE')
    }
  })

  await t.test('17. Normal keyup following Spacebar hold completes valid turn execution', async () => {
    let stoppedTurn = 0
    let cancelled = false
    const sm = new PTTStateMachine({
      holdThresholdMs: 20,
      onStartRecording: async () => {},
      onStopRecording: async (turnId) => { stoppedTurn = turnId },
      onCancel: () => { cancelled = true }
    })

    sm.handleKeyDown({ code: 'Space', repeat: false })
    await new Promise(r => setTimeout(r, 40))
    assert.strictEqual(sm.getPhase(), 'RECORDING')

    // Normal intentional release
    sm.handleKeyUp({ code: 'Space' })
    await new Promise(r => setTimeout(r, 20))

    assert.strictEqual(stoppedTurn, 1, 'Normal keyup must stop recording and finalize turn')
    assert.strictEqual(cancelled, false, 'Normal keyup must not cancel')
    assert.strictEqual(sm.getPhase(), 'IDLE')
    sm.destroy()
  })
})
