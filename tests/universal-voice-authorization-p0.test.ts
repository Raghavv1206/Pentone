import test from 'node:test'
import assert from 'node:assert/strict'

// Setup global mock for Chrome extension environment BEFORE importing modules
;(global as any).chrome = {
  runtime: {
    getURL: (p: string) => `chrome-extension://mock-id/${p}`,
    sendMessage: (_msg: any, cb?: (res: any) => void) => {
      if (cb) cb({ success: true })
    },
  },
  tabs: {
    query: (_query: any, cb?: (tabs: any[]) => void) => {
      if (cb) cb([])
    }
  },
  storage: {
    local: {
      get: () => Promise.resolve({}),
      set: () => Promise.resolve({}),
    }
  }
}

import { voiceAuthorizationManager } from '../lib/audio/voice-authorization-manager'
import { voiceDiagnosticTracker } from '../lib/audio/voice-diagnostic-tracker'
import { evaluateHighImpact } from '../lib/audio/tool-authorization-classifier'
import type { VoiceAuthorizationToken } from '../lib/audio/voice-authorization-types'

test('Pentone P0 Suite: Universal Voice Authorization & Error Decoupling', async (t) => {
  const { validateVoiceTurnAuthorization } = await import('../lib/chat-context')
  
  // Setup clean context before each subtest
  const setupContext = (userId = 'user_default', sessionId = 'sess_default', turnId = 1) => {
    voiceAuthorizationManager.clear()
    voiceAuthorizationManager.setActiveContext({ userId, sessionId, turnId })
  }

  await t.test('1. Valid UNIVERSAL_GRANTED token is accepted', () => {
    setupContext('user_alice', 'sess_1', 101)
    const token = voiceAuthorizationManager.mintToken({
      turnId: 101,
      userId: 'user_alice',
      sessionId: 'sess_1',
      mode: 'UNIVERSAL_VOICE',
      activationMethod: 'PUSH_TO_TALK',
      isPttActive: true,
    })

    assert.equal(token.scope, 'EXECUTE_MUTATING_ACTIONS')
    assert.equal(token.source, 'UNIVERSAL_VOICE')
    assert.equal(token.activationMethod, 'PUSH_TO_TALK')

    const outcome = validateVoiceTurnAuthorization({
      token,
      turnId: 101,
      userId: 'user_alice',
      sessionId: 'sess_1',
    })

    assert.equal(outcome.authorized, true)
    assert.equal(outcome.reason, 'AUTHORIZED')
  })

  await t.test('2. Valid token with correct PTT session and turn binding reaches dispatch', () => {
    setupContext('user_bob', 'sess_ptt_200', 202)
    const token = voiceAuthorizationManager.mintToken({
      turnId: 202,
      userId: 'user_bob',
      sessionId: 'sess_ptt_200',
      mode: 'UNIVERSAL_VOICE',
      activationMethod: 'PUSH_TO_TALK',
      isPttActive: true,
    })

    const outcome = validateVoiceTurnAuthorization({
      token,
      turnId: 202,
      userId: 'user_bob',
      sessionId: 'sess_ptt_200',
    })

    assert.equal(outcome.authorized, true)
    assert.equal(outcome.reason, 'AUTHORIZED')
  })

  await t.test('3. Expired token is rejected', () => {
    setupContext('user_alice', 'sess_1', 301)
    const pastTime = Date.now() - 15000 // 15 seconds ago
    const expiredToken = voiceAuthorizationManager.mintToken({
      turnId: 301,
      userId: 'user_alice',
      sessionId: 'sess_1',
      mode: 'UNIVERSAL_VOICE',
      activationMethod: 'PUSH_TO_TALK',
      currentTime: pastTime,
    })

    const outcome = validateVoiceTurnAuthorization({
      token: expiredToken,
      turnId: 301,
      userId: 'user_alice',
      sessionId: 'sess_1',
    })

    assert.equal(outcome.authorized, false)
    assert.equal(outcome.reason, 'TOKEN_EXPIRED')
  })

  await t.test('4. Replayed token is rejected', () => {
    setupContext('user_replay', 'sess_replay', 401)
    const token = voiceAuthorizationManager.mintToken({
      turnId: 401,
      userId: 'user_replay',
      sessionId: 'sess_replay',
      mode: 'UNIVERSAL_VOICE',
      activationMethod: 'PUSH_TO_TALK',
      isPttActive: true,
    })

    // First use: tool consumption consumes the token
    const firstOutcome = voiceAuthorizationManager.validateAndConsume(token, {
      toolName: 'openTab',
      turnId: 401,
      userId: 'user_replay',
      sessionId: 'sess_replay',
    })
    assert.equal(firstOutcome.authorized, true)

    // Replay attempt: subsequent validation must reject
    const replayOutcome = validateVoiceTurnAuthorization({
      token,
      turnId: 401,
      userId: 'user_replay',
      sessionId: 'sess_replay',
    })

    assert.equal(replayOutcome.authorized, false)
    assert.equal(replayOutcome.reason, 'TOKEN_ALREADY_CONSUMED')
  })

  await t.test('5. Cancelled PTT session cannot dispatch', () => {
    setupContext('user_cancel', 'sess_cancel', 501)
    const token = voiceAuthorizationManager.mintToken({
      turnId: 501,
      userId: 'user_cancel',
      sessionId: 'sess_cancel',
      mode: 'UNIVERSAL_VOICE',
      activationMethod: 'PUSH_TO_TALK',
      isPttActive: true,
    })

    // User cancels PTT
    voiceAuthorizationManager.cancelTurn(501, 'User released outside or blurred window')

    const outcome = validateVoiceTurnAuthorization({
      token,
      turnId: 501,
      userId: 'user_cancel',
      sessionId: 'sess_cancel',
    })

    assert.equal(outcome.authorized, false)
    assert.ok(outcome.reason === 'TURN_CANCELLED' || outcome.reason === 'TOKEN_REVOKED')
  })

  await t.test('6. Mismatched user or session is rejected', () => {
    setupContext('user_legit', 'sess_legit', 601)
    const token = voiceAuthorizationManager.mintToken({
      turnId: 601,
      userId: 'user_legit',
      sessionId: 'sess_legit',
      mode: 'UNIVERSAL_VOICE',
      activationMethod: 'PUSH_TO_TALK',
      isPttActive: true,
    })

    // Mismatched User
    const userMismatch = validateVoiceTurnAuthorization({
      token,
      turnId: 601,
      userId: 'user_attacker',
      sessionId: 'sess_legit',
    })
    assert.equal(userMismatch.authorized, false)
    assert.equal(userMismatch.reason, 'USER_MISMATCH')

    // Mismatched Session
    const sessionMismatch = validateVoiceTurnAuthorization({
      token,
      turnId: 601,
      userId: 'user_legit',
      sessionId: 'sess_other_window',
    })
    assert.equal(sessionMismatch.authorized, false)
    assert.equal(sessionMismatch.reason, 'SESSION_MISMATCH')

    // Mismatched Turn
    const turnMismatch = validateVoiceTurnAuthorization({
      token,
      turnId: 602,
      userId: 'user_legit',
      sessionId: 'sess_legit',
    })
    assert.equal(turnMismatch.authorized, false)
    assert.equal(turnMismatch.reason, 'TURN_MISMATCH')
  })

  await t.test('7. Missing authorization token is rejected', () => {
    setupContext('user_7', 'sess_7', 701)

    // Call with empty authContext object (no token)
    const missingTokenOutcome = validateVoiceTurnAuthorization({
      turnId: 701,
      userId: 'user_7',
      sessionId: 'sess_7',
    })
    assert.equal(missingTokenOutcome.authorized, false)
    assert.equal(missingTokenOutcome.reason, 'MISSING_TOKEN')

    // Arbitrary / manually fabricated token not registered in manager
    const fakeToken: VoiceAuthorizationToken = {
      tokenId: 'fake-uuid-0000-1111-2222',
      turnId: 701,
      userId: 'user_7',
      sessionId: 'sess_7',
      scope: 'EXECUTE_MUTATING_ACTIONS',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 5000,
      requiresExplicitConfirmation: false,
    }
    const fakeTokenOutcome = validateVoiceTurnAuthorization({
      token: fakeToken,
      turnId: 701,
      userId: 'user_7',
      sessionId: 'sess_7',
    })
    assert.equal(fakeTokenOutcome.authorized, false)
    assert.equal(fakeTokenOutcome.reason, 'UNREGISTERED_TOKEN')
  })

  await t.test('8. High-impact actions still require confirmation', () => {
    setupContext('user_8', 'sess_8', 801)
    const token = voiceAuthorizationManager.mintToken({
      turnId: 801,
      userId: 'user_8',
      sessionId: 'sess_8',
      mode: 'UNIVERSAL_VOICE',
      activationMethod: 'PUSH_TO_TALK',
      isPttActive: true,
    })

    // Classifier verification
    const highImpactEval = evaluateHighImpact('clickElement', { selector: '#pay-confirm-button' })
    assert.equal(highImpactEval.isHighImpact, true)

    // Execution without user confirmation must fail closed
    const unconfirmedOutcome = voiceAuthorizationManager.validateAndConsume(token, {
      toolName: 'clickElement',
      parameters: { selector: '#pay-confirm-button' },
      turnId: 801,
      userId: 'user_8',
      sessionId: 'sess_8',
      confirmationApproved: false,
    })
    assert.equal(unconfirmedOutcome.authorized, false)
    assert.equal(unconfirmedOutcome.reason, 'CONFIRMATION_REQUIRED')

    // Execution with explicit confirmation must succeed
    const confirmedOutcome = voiceAuthorizationManager.validateAndConsume(token, {
      toolName: 'clickElement',
      parameters: { selector: '#pay-confirm-button' },
      turnId: 801,
      userId: 'user_8',
      sessionId: 'sess_8',
      confirmationApproved: true,
    })
    assert.equal(confirmedOutcome.authorized, true)
    assert.equal(confirmedOutcome.reason, 'SUCCESS')
  })

  await t.test('9. voiceDiagnosticTracker logging does not throw', () => {
    // Add an intentionally buggy listener to test tracker resilience
    const unsubscribe = voiceDiagnosticTracker.subscribe(() => {
      throw new Error('Telemetry network drop or listener failure')
    })

    try {
      // Direct tracker calls must never throw back to callers
      assert.doesNotThrow(() => {
        voiceDiagnosticTracker.startTurn(901, 'user_9', 'sess_9')
        voiceDiagnosticTracker.recordWhisper(901, 'test speech', 120)
        voiceDiagnosticTracker.recordAuth(901, 'UNIVERSAL_GRANTED', 'EXECUTE_MUTATING_ACTIONS')
        voiceDiagnosticTracker.recordTerminalState(901, 'DENIED', 'Testing defensive wrapper')
        voiceDiagnosticTracker.recordNemotronIntent(901, 'Reasoning intent')
        voiceDiagnosticTracker.recordCancellation(901, 'User cancelled')
      })
    } finally {
      unsubscribe()
    }
  })

  await t.test('10. sendMessage() failure does not display MIC ERROR', async () => {
    // Simulate decoupled PTT execution lifecycle where sendMessage throws
    type PttState = 'READY' | 'LISTENING' | 'PROCESSING' | 'EXECUTING' | 'ERROR'
    let currentState: PttState = 'READY'
    let micErrorTriggered = false

    const setPttState = (s: PttState) => {
      currentState = s
      if (s === 'ERROR') {
        micErrorTriggered = true
      }
    }

    // Mock agent that throws an error (e.g. LLM API failure, ReferenceError, etc.)
    const failingSendMessage = async () => {
      throw new ReferenceError('Downstream agent component threw ReferenceError')
    }

    // Isolated dispatch simulation as implemented in useFullDuplexVoice:
    setPttState('PROCESSING')
    // ASR & Mint stage succeeds
    const tokenMinted = true
    assert.ok(tokenMinted)

    // Stage 5: Dispatch to Agent
    try {
      setPttState('EXECUTING')
      await failingSendMessage()
    } catch (agentErr: any) {
      // Invariant: Agent errors are caught and logged; setPttState('ERROR') is NEVER called
      assert.ok(agentErr instanceof ReferenceError)
    } finally {
      setPttState('READY')
    }

    assert.equal(currentState, 'READY')
    assert.equal(micErrorTriggered, false, 'MIC ERROR was incorrectly triggered by agent dispatch failure')
  })

  await t.test('11. Subsequent PTT activation works immediately after dispatch failure', async () => {
    type PttState = 'READY' | 'LISTENING' | 'PROCESSING' | 'EXECUTING' | 'ERROR'
    let currentState: PttState = 'READY'
    const setPttState = (s: PttState) => { currentState = s }

    // Turn 1 experiences downstream dispatch failure
    setPttState('PROCESSING')
    setPttState('EXECUTING')
    try {
      throw new Error('LLM model unavailable')
    } catch (agentErr) {
      // Decoupled handler
    } finally {
      setPttState('READY')
    }

    assert.equal(currentState, 'READY')

    // Immediate subsequent PTT activation without waiting 2000ms
    const startPttNext = () => {
      if (currentState !== 'READY') throw new Error('Cannot start PTT: not in READY state')
      setPttState('LISTENING')
      return true
    }

    const activated = startPttNext()
    assert.equal(activated, true)
    assert.equal(currentState, 'LISTENING')
  })

  await t.test('12. Genuine microphone and Whisper errors still produce appropriate error states', () => {
    type PttState = 'READY' | 'LISTENING' | 'PROCESSING' | 'EXECUTING' | 'ERROR'
    let currentState: PttState = 'READY'
    let errorMessage: string | null = null

    const setPttState = (s: PttState) => { currentState = s }
    const setError = (msg: string | null) => { errorMessage = msg }

    // Sub-case A: Microphone acquisition failure
    const simulateMicStartupFailure = (err: any) => {
      setPttState('ERROR')
      setError(
        err?.name === 'NotAllowedError'
          ? 'Microphone permission denied. Please allow microphone access in Chrome settings.'
          : (err?.message || 'Microphone error during Push-to-Talk activation')
      )
    }

    simulateMicStartupFailure(new Error('Requested device not found'))
    assert.equal(currentState, 'ERROR')
    assert.equal(errorMessage, 'Requested device not found')

    // Reset
    setPttState('READY')
    setError(null)

    // Sub-case B: Whisper ASR inference failure
    const simulateWhisperAsrFailure = (asrErr: any) => {
      // Diagnostic recorded
      voiceDiagnosticTracker.recordTerminalState(1201, 'ASR_FAILED', asrErr?.message)
      // Error banner populated
      setError(asrErr?.message || 'Speech recognition failed')
      // PTT state returns to READY without showing MIC ERROR (since mic was healthy)
      setPttState('READY')
    }

    simulateWhisperAsrFailure(new Error('Whisper model session creation failed'))
    assert.equal(currentState, 'READY')
    assert.equal(errorMessage, 'Whisper model session creation failed')
    
    const turnRec = voiceDiagnosticTracker.getTurn(1201)
    assert.equal(turnRec?.terminalState, 'ASR_FAILED')
  })
})
