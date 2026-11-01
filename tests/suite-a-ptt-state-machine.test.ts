import test from 'node:test'
import assert from 'node:assert/strict'
import { PTTStateMachine, isEditableElement } from '../lib/audio/ptt-state-machine'

test('Suite A: PTT State Machine - Comprehensive Lifecycle Tests', async (t) => {

  await t.test('1. Short tap (50ms) ignores PTT and returns directly to IDLE without recording', async () => {
    let recordingStarted = false
    let finalizationCalled = false

    const sm = new PTTStateMachine({
      holdThresholdMs: 150,
      onStartRecording: async () => { recordingStarted = true },
      onStopRecording: async () => { finalizationCalled = true },
      onCancel: () => {}
    })

    assert.equal(sm.getPhase(), 'IDLE')

    // Keydown (starts 150ms hold window)
    const consumedDown = sm.handleKeyDown({ code: 'Space', repeat: false })
    assert.equal(consumedDown, true)
    assert.equal(sm.getPhase(), 'PRESS_PENDING')

    // Keyup at 50ms (before 150ms hold threshold)
    await new Promise(r => setTimeout(r, 50))
    const consumedUp = sm.handleKeyUp({ code: 'Space' })
    assert.equal(consumedUp, true)
    assert.equal(sm.getPhase(), 'IDLE')
    assert.equal(recordingStarted, false, 'Recording must never start for 50ms tap')
    assert.equal(finalizationCalled, false, 'Finalization must not be called for tap')

    // Verify after waiting past the original 150ms mark that it stays IDLE
    await new Promise(r => setTimeout(r, 120))
    assert.equal(sm.getPhase(), 'IDLE')
    assert.equal(recordingStarted, false)
    sm.destroy()
  })

  await t.test('2. 100ms tap ignores PTT and returns to IDLE', async () => {
    let recordingStarted = false
    const sm = new PTTStateMachine({
      holdThresholdMs: 150,
      onStartRecording: async () => { recordingStarted = true },
      onStopRecording: async () => {},
      onCancel: () => {}
    })

    sm.handleKeyDown({ code: 'Space', repeat: false })
    assert.equal(sm.getPhase(), 'PRESS_PENDING')

    await new Promise(r => setTimeout(r, 100))
    sm.handleKeyUp({ code: 'Space' })
    assert.equal(sm.getPhase(), 'IDLE')
    assert.equal(recordingStarted, false)

    await new Promise(r => setTimeout(r, 80))
    assert.equal(sm.getPhase(), 'IDLE')
    assert.equal(recordingStarted, false)
    sm.destroy()
  })

  await t.test('3. Deliberate hold (> 150ms) starts RECORDING and keyup finalizes exactly once', async () => {
    let recordingStarted = false
    let stopCount = 0
    let recordedTurnId = 0

    const sm = new PTTStateMachine({
      holdThresholdMs: 150,
      onStartRecording: async (turnId) => {
        recordingStarted = true
        recordedTurnId = turnId
      },
      onStopRecording: async () => {
        stopCount++
      },
      onCancel: () => {}
    })

    sm.handleKeyDown({ code: 'Space', repeat: false })
    assert.equal(sm.getPhase(), 'PRESS_PENDING')

    // Wait past 150ms threshold
    await new Promise(r => setTimeout(r, 170))
    assert.equal(sm.getPhase(), 'RECORDING')
    assert.equal(recordingStarted, true)
    assert.ok(recordedTurnId > 0)

    // Keyup finalizes
    sm.handleKeyUp({ code: 'Space' })
    assert.equal(stopCount, 1)

    // Duplicate keyup must NOT re-finalize
    sm.handleKeyUp({ code: 'Space' })
    assert.equal(stopCount, 1, 'Keyup must never finalize more than once')

    sm.destroy()
  })

  await t.test('4. event.repeat and duplicate keydowns are strictly ignored', async () => {
    let startCount = 0
    const sm = new PTTStateMachine({
      holdThresholdMs: 50,
      onStartRecording: async () => { startCount++ },
      onStopRecording: async () => {},
      onCancel: () => {}
    })

    sm.handleKeyDown({ code: 'Space', repeat: false })
    assert.equal(sm.getPhase(), 'PRESS_PENDING')

    // Repeated keydown with repeat = true
    const repeated = sm.handleKeyDown({ code: 'Space', repeat: true })
    assert.equal(repeated, false)

    // Duplicate keydown while already down
    const dup = sm.handleKeyDown({ code: 'Space', repeat: false })
    assert.equal(dup, false)

    await new Promise(r => setTimeout(r, 70))
    assert.equal(sm.getPhase(), 'RECORDING')
    assert.equal(startCount, 1)

    sm.handleKeyUp({ code: 'Space' })
    sm.destroy()
  })

  await t.test('5. Keyup arriving while mic acquisition is in-flight triggers immediate finalization once acquired', async () => {
    let acquisitionResolved = false
    let stopCalled = false

    const sm = new PTTStateMachine({
      holdThresholdMs: 50,
      onStartRecording: async () => {
        // Simulate async mic acquisition delay of 80ms
        await new Promise(r => setTimeout(r, 80))
        acquisitionResolved = true
      },
      onStopRecording: async () => {
        stopCalled = true
      },
      onCancel: () => {}
    })

    sm.handleKeyDown({ code: 'Space', repeat: false })
    // Wait until RECORDING starts and enters acquisition
    await new Promise(r => setTimeout(r, 60))
    assert.equal(sm.getPhase(), 'RECORDING')

    // Keyup arrives WHILE onStartRecording is still awaiting
    sm.handleKeyUp({ code: 'Space' })
    assert.equal(acquisitionResolved, false)

    // Wait for acquisition to finish
    await new Promise(r => setTimeout(r, 100))
    assert.equal(acquisitionResolved, true)
    assert.equal(stopCalled, true, 'Finalization must trigger immediately after acquisition resolves')
    assert.equal(sm.getPhase(), 'IDLE')

    sm.destroy()
  })

  await t.test('6. Window blur or visibility loss while recording safely cancels capture and never dispatches browser action', async () => {
    let stopped = false
    let cancelled = false
    const sm = new PTTStateMachine({
      holdThresholdMs: 50,
      onStartRecording: async () => {},
      onStopRecording: async () => { stopped = true },
      onCancel: () => { cancelled = true }
    })

    sm.handleKeyDown({ code: 'Space', repeat: false })
    await new Promise(r => setTimeout(r, 60))
    assert.equal(sm.getPhase(), 'RECORDING')

    // Window loses focus
    sm.handleBlurOrVisibilityChange()
    assert.equal(stopped, false, 'Focus loss must never finalize or dispatch browser action')
    assert.equal(cancelled, true, 'Focus loss must cancel capture and revoke authorization')
    assert.equal(sm.isKeyDepressed(), false)

    sm.destroy()
  })

  await t.test('7. Window blur during PRESS_PENDING safely aborts before recording starts', async () => {
    let started = false
    const sm = new PTTStateMachine({
      holdThresholdMs: 150,
      onStartRecording: async () => { started = true },
      onStopRecording: async () => {},
      onCancel: () => {}
    })

    sm.handleKeyDown({ code: 'Space', repeat: false })
    assert.equal(sm.getPhase(), 'PRESS_PENDING')

    // Blur at 40ms
    sm.handleBlurOrVisibilityChange()
    assert.equal(sm.getPhase(), 'IDLE')

    await new Promise(r => setTimeout(r, 150))
    assert.equal(started, false)
    assert.equal(sm.getPhase(), 'IDLE')

    sm.destroy()
  })

  await t.test('8. Escape cancels active turn and returns to IDLE', async () => {
    let cancelled = false
    const sm = new PTTStateMachine({
      holdThresholdMs: 50,
      onStartRecording: async () => {},
      onStopRecording: async () => {},
      onCancel: () => { cancelled = true }
    })

    sm.handleKeyDown({ code: 'Space', repeat: false })
    await new Promise(r => setTimeout(r, 60))
    assert.equal(sm.getPhase(), 'RECORDING')

    sm.cancel('User pressed Escape')
    assert.equal(cancelled, true)
    assert.equal(sm.getPhase(), 'CANCELLED')

    await new Promise(r => setTimeout(r, 450))
    assert.equal(sm.getPhase(), 'IDLE')

    sm.destroy()
  })

  await t.test('9. Watchdog timeout recovers stuck RECORDING state', async () => {
    let cancelCalled = false
    const sm = new PTTStateMachine({
      holdThresholdMs: 30,
      maxRecordingMs: 100, // Short watchdog for testing
      onStartRecording: async () => {},
      onStopRecording: async () => {},
      onCancel: () => { cancelCalled = true }
    })

    sm.handleKeyDown({ code: 'Space', repeat: false })
    await new Promise(r => setTimeout(r, 40))
    assert.equal(sm.getPhase(), 'RECORDING')

    // Do NOT send keyup - let watchdog fire
    await new Promise(r => setTimeout(r, 120))
    assert.equal(cancelCalled, true)
    assert.equal(sm.getPhase(), 'IDLE')

    sm.destroy()
  })

  await t.test('10. Spacebar is ignored when typing in editable controls', () => {
    const sm = new PTTStateMachine({
      holdThresholdMs: 50,
      onStartRecording: async () => {},
      onStopRecording: async () => {},
      onCancel: () => {}
    })

    const inputTarget = { tagName: 'INPUT', isContentEditable: false }
    const consumed = sm.handleKeyDown({ code: 'Space', repeat: false, target: inputTarget } as any)
    assert.equal(consumed, false)
    assert.equal(sm.getPhase(), 'IDLE')

    const textareaTarget = { tagName: 'TEXTAREA', isContentEditable: false }
    assert.equal(sm.handleKeyDown({ code: 'Space', repeat: false, target: textareaTarget } as any), false)

    const contentEditableTarget = { tagName: 'DIV', isContentEditable: true }
    assert.equal(sm.handleKeyDown({ code: 'Space', repeat: false, target: contentEditableTarget } as any), false)

    sm.destroy()
  })

  await t.test('11. Immediate subsequent PTT session starts cleanly with incremented turnId', async () => {
    const turnsRecorded: number[] = []
    const sm = new PTTStateMachine({
      holdThresholdMs: 30,
      onStartRecording: async (turnId) => { turnsRecorded.push(turnId) },
      onStopRecording: async () => {},
      onCancel: () => {}
    })

    // Turn 1
    sm.handleKeyDown({ code: 'Space', repeat: false })
    await new Promise(r => setTimeout(r, 40))
    sm.handleKeyUp({ code: 'Space' })
    await sm.waitForIdle()
    assert.equal(sm.getPhase(), 'IDLE')

    // Turn 2 immediately
    sm.handleKeyDown({ code: 'Space', repeat: false })
    await new Promise(r => setTimeout(r, 40))
    sm.handleKeyUp({ code: 'Space' })
    await sm.waitForIdle()
    assert.equal(sm.getPhase(), 'IDLE')

    assert.equal(turnsRecorded.length, 2)
    assert.equal(turnsRecorded[0] + 1, turnsRecorded[1], 'Turn IDs must increment sequentially')

    sm.destroy()
  })

  await t.test('12. Late events from an old turn are rejected by turnId guard', () => {
    let currentPhase = 'IDLE'
    const sm = new PTTStateMachine({
      holdThresholdMs: 50,
      onStartRecording: async () => {},
      onStopRecording: async () => {},
      onCancel: () => {},
      onPhaseChange: (p) => { currentPhase = p }
    })

    sm.handleKeyDown({ code: 'Space', repeat: false })
    const activeTurn = sm.getCurrentTurnId()

    // Simulate old turn reporting completion
    sm.reportPhase('IDLE', activeTurn - 1)
    assert.equal(sm.getPhase(), 'PRESS_PENDING', 'Old turn report must not disrupt active turn')

    sm.destroy()
  })
})
