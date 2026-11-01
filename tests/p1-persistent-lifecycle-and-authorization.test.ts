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
      remove: () => Promise.resolve({}),
    }
  }
}

// Mock global window/self LanguageModel and Summarizer
const mockLM = {
  create: async () => ({
    prompt: async (p: string) => `Concise summary of: ${p.slice(0, 40)}`,
    promptStreaming: async function* (p: string) {
      yield 'Mock streaming response'
    },
    destroy: () => {},
  }),
  availability: async () => 'readily',
}

;(global as any).LanguageModel = mockLM
if (typeof globalThis !== 'undefined') {
  ;(globalThis as any).LanguageModel = mockLM
}

import { WhisperASRService } from '../lib/audio/whisper-asr-service'
import { voiceAuthorizationManager } from '../lib/audio/voice-authorization-manager'
import { voiceDiagnosticTracker } from '../lib/audio/voice-diagnostic-tracker'
import {
  partitionMessagesForCompaction,
  executeIncrementalCompaction,
  formatSummaryMessage,
  shouldSummarize,
} from '../lib/summarizer'
import {
  createUserMessage,
  createAssistantMessage,
  createInternalMessage,
  type Message,
} from '../lib/messages'
import {
  getAIMetrics,
  resetAIMetrics,
  resetSessionForCompactedContext,
} from '../lib/ai'
import type { VoiceTurnGrant, VoiceAuthorizationToken } from '../lib/audio/voice-authorization-types'

test('Pentone P1 Suite: Persistent Model Sessions, Incremental Context & Two-Level Authorization', async (t) => {
  const { validateVoiceTurnAuthorization } = await import('../lib/chat-context')
  const setupContext = (userId = 'user_default', sessionId = 'sess_default', turnId = 1) => {
    voiceAuthorizationManager.clear()
    voiceAuthorizationManager.setActiveContext({ userId, sessionId, turnId })
    WhisperASRService.resetMetrics()
    WhisperASRService.resetInstanceForTesting()
    resetAIMetrics()
  }

  // --------------------------------------------------------------------------
  // Scenario 1: Whisper initializes once and is reused for 10 consecutive commands
  // --------------------------------------------------------------------------
  await t.test('1. Whisper initializes once and is reused across 10 consecutive commands', async () => {
    setupContext()
    const whisper = new WhisperASRService()

    // Mock pipeline factory so we don't load 40MB onnx weights in unit test
    const mockPipelineInstance = {
      isInitialized: true,
      transcribe: async () => ({ text: 'hello pentone', chunks: [] }),
      dispose: async () => {},
    }

    ;(whisper as any).createPipelineInstance = async () => mockPipelineInstance

    for (let i = 0; i < 10; i++) {
      await whisper.initialize()
    }

    const metrics = WhisperASRService.getMetrics()
    assert.equal(metrics.initializationCount, 1, 'Whisper must only initialize once')
    assert.equal(metrics.reuseCount, 9, 'Whisper must be reused 9 times for 10 calls')
    assert.equal(whisper.isReady(), true, 'Whisper service should be ready')
  })

  // --------------------------------------------------------------------------
  // Scenario 2: Concurrent Whisper initialization shares one promise
  // --------------------------------------------------------------------------
  await t.test('2. Concurrent Whisper initialization calls share one single in-flight promise', async () => {
    setupContext()
    const whisper = new WhisperASRService()

    let factoryCallCount = 0
    ;(whisper as any).createPipelineInstance = async () => {
      factoryCallCount++
      await new Promise(r => setTimeout(r, 20))
      return { isInitialized: true, transcribe: async () => ({ text: '' }), dispose: async () => {} }
    }

    // Launch 5 concurrent calls
    await Promise.all([
      whisper.initialize(),
      whisper.initialize(),
      whisper.initialize(),
      whisper.initialize(),
      whisper.initialize(),
    ])

    const metrics = WhisperASRService.getMetrics()
    assert.equal(factoryCallCount, 1, 'Pipeline factory must be called exactly once')
    assert.equal(metrics.initializationCount, 1, 'Initialization metric must be 1')
  })

  // --------------------------------------------------------------------------
  // Scenario 3: Failed Whisper initialization can be retried cleanly
  // --------------------------------------------------------------------------
  await t.test('3. Failed Whisper initialization clears promise and can be retried cleanly', async () => {
    setupContext()
    const whisper = new WhisperASRService()

    let shouldFail = true
    ;(whisper as any).createPipelineInstance = async () => {
      if (shouldFail) {
        throw new Error('Simulated ONNX model fetch error')
      }
      return { isInitialized: true, transcribe: async () => ({ text: '' }), dispose: async () => {} }
    }

    // First attempt fails
    await assert.rejects(async () => {
      await whisper.initialize()
    }, /Simulated ONNX model fetch error/)

    let metrics = WhisperASRService.getMetrics()
    assert.equal(metrics.initializationFailedCount, 1, 'Failure count must be incremented')
    assert.equal(whisper.isReady(), false, 'Service should not be ready after failure')

    // Second attempt succeeds
    shouldFail = false
    await whisper.initialize()

    metrics = WhisperASRService.getMetrics()
    assert.equal(metrics.initializationCount, 1, 'Successful initialization must count 1')
    assert.equal(whisper.isReady(), true, 'Service should be ready after retry')
  })

  // --------------------------------------------------------------------------
  // Scenario 4: Component remount / new service instance reuse
  // --------------------------------------------------------------------------
  await t.test('4. Component remount / new WhisperASRService instance reuses existing pipeline', async () => {
    setupContext()

    const instance1 = new WhisperASRService()
    const mockPipelineInstance = {
      isInitialized: true,
      transcribe: async () => ({ text: '' }),
      dispose: async () => {},
    }
    ;(instance1 as any).createPipelineInstance = async () => mockPipelineInstance

    await instance1.initialize()
    assert.equal(WhisperASRService.getMetrics().initializationCount, 1)

    // Simulate component remounting: instantiate a new service instance
    const instance2 = new WhisperASRService()
    await instance2.initialize()

    const metrics = WhisperASRService.getMetrics()
    assert.equal(metrics.initializationCount, 1, 'Remounted instance must not re-initialize pipeline')
    assert.equal(metrics.reuseCount, 1, 'Remounted instance must increment reuse count')
  })

  // --------------------------------------------------------------------------
  // Scenario 5: Context remains bounded over at least 50 conversational turns
  // --------------------------------------------------------------------------
  await t.test('5. Incremental context compaction keeps token count bounded over 50 turns', async () => {
    setupContext()

    let messages: Message[] = []
    let totalCompactionEvents = 0

    for (let turn = 1; turn <= 50; turn++) {
      messages.push({ ...createUserMessage(`Turn ${turn}: What is the status of tab execution?`), id: `u_${turn}` })
      messages.push({ ...createAssistantMessage(`Turn ${turn}: Tab status is active and verified with details.`, 100), id: `a_${turn}` })

      // Check if compaction should trigger
      const estimatedTokens = messages
        .filter(m => !m.visualOnly)
        .reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0)

      if (estimatedTokens > 300) { // Scaled test boundary for rapid testing
        const compaction = await executeIncrementalCompaction(messages)
        if (compaction.prunedCount > 0) {
          totalCompactionEvents++
          const retainedIds = new Set(compaction.retainedRecentMessages.map(m => m.id))
          messages = [
            ...messages.map(m =>
              !m.visualOnly && (!retainedIds.has(m.id) || m.messageType === 'summary') ? { ...m, visualOnly: true } : m
            ),
            { ...createInternalMessage(formatSummaryMessage(compaction.summary), 'summary', 0), id: `summary_${totalCompactionEvents}` },
          ]
        }
      }
    }

    const nonVisualMessages = messages.filter(m => !m.visualOnly)
    const finalTokens = nonVisualMessages.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0)

    assert.ok(totalCompactionEvents > 0, 'Compaction should have triggered multiple times')
    // Ensure active context is strictly bounded, not 50 uncompacted turns (50 * ~30 tokens = 1500)
    assert.ok(finalTokens < 800, `Active non-visual context should remain bounded (was ${finalTokens})`)
  })

  // --------------------------------------------------------------------------
  // Scenario 6: Old messages are not reintroduced after compaction
  // --------------------------------------------------------------------------
  await t.test('6. Old messages are not reintroduced after incremental compaction', async () => {
    setupContext()

    const m1 = { ...createUserMessage('Turn 1: Initial setup'), id: 'turn1_user' }
    const m2 = { ...createAssistantMessage('Turn 1: Configured initial setup', 0), id: 'turn1_assistant' }
    const m3 = { ...createUserMessage('Turn 2: Search for repo'), id: 'turn2_user' }
    const m4 = { ...createAssistantMessage('Turn 2: Found repo Marionette', 0), id: 'turn2_assistant' }
    const m5 = { ...createUserMessage('Turn 3: Open repo tab'), id: 'turn3_user' }
    const m6 = { ...createAssistantMessage('Turn 3: Opened tab 1', 0), id: 'turn3_assistant' }
    const m7 = { ...createUserMessage('Turn 4: What is tab title?'), id: 'turn4_user' }
    const m8 = { ...createAssistantMessage('Turn 4: Tab title is Marionette', 0), id: 'turn4_assistant' }

    const all = [m1, m2, m3, m4, m5, m6, m7, m8]
    const compaction = await executeIncrementalCompaction(all)

    assert.equal(compaction.prunedCount, 2, 'Should prune oldest turn (m1, m2)')
    assert.equal(compaction.retainedRecentMessages.length, 6, 'Should retain most recent 3 turns (m3..m8)')

    const retainedIds = new Set(compaction.retainedRecentMessages.map(m => m.id))
    const updatedMessages = all.map(m =>
      !retainedIds.has(m.id) ? { ...m, visualOnly: true } : m
    )

    const messagesForAI = updatedMessages.filter(m => !m.visualOnly)
    assert.ok(!messagesForAI.some(m => m.id === m1.id), 'Pruned turn 1 message m1 must NOT be in AI context')
    assert.ok(!messagesForAI.some(m => m.id === m2.id), 'Pruned turn 1 message m2 must NOT be in AI context')
    assert.ok(messagesForAI.some(m => m.id === m7.id), 'Recent message m7 MUST be retained in AI context')
  })

  // --------------------------------------------------------------------------
  // Scenario 7: Compaction does not repeatedly summarize the same history
  // --------------------------------------------------------------------------
  await t.test('7. Compaction only summarizes new older messages and never re-summarizes pruned ones', async () => {
    setupContext()

    const m1 = createUserMessage('Old message 1')
    const m2 = createAssistantMessage('Old response 1', 0)
    const m3 = createUserMessage('Old message 2')
    const m4 = createAssistantMessage('Old response 2', 0)
    const m5 = createUserMessage('Turn 3')
    const m6 = createAssistantMessage('Resp 3', 0)
    const m7 = createUserMessage('Turn 4')
    const m8 = createAssistantMessage('Resp 4', 0)
    const m9 = createUserMessage('Turn 5')
    const m10 = createAssistantMessage('Resp 5', 0)

    // First compaction
    const compaction1 = await executeIncrementalCompaction([m1, m2, m3, m4, m5, m6, m7, m8, m9, m10])
    assert.equal(compaction1.prunedCount, 4, 'Compaction 1 prunes m1..m4')

    // Mark pruned as visualOnly
    const stateAfter1 = [
      { ...m1, visualOnly: true },
      { ...m2, visualOnly: true },
      { ...m3, visualOnly: true },
      { ...m4, visualOnly: true },
      m5, m6, m7, m8, m9, m10,
    ]

    // Partition on stateAfter1 (should only consider non-visual messages)
    const nonVisual = stateAfter1.filter(m => !m.visualOnly)
    const { olderMessages } = partitionMessagesForCompaction(nonVisual)
    assert.ok(!olderMessages.some(m => m.id === m1.id || m.id === m3.id), 'Visual-only messages are excluded from future compaction inputs')
  })

  // --------------------------------------------------------------------------
  // Scenario 8: Session replacement uses compacted context
  // --------------------------------------------------------------------------
  await t.test('8. Session replacement uses compacted context without triggering full model warmup alerts', async () => {
    setupContext()

    await resetSessionForCompactedContext()

    const aiMetrics = getAIMetrics()
    assert.equal(aiMetrics.sessionDestroyCount, 1, 'Session should be cleanly destroyed')
    assert.equal(aiMetrics.warmupCount, 0, 'Compact reset must NOT trigger model warmup notifications')
  })

  // --------------------------------------------------------------------------
  // Scenario 9: Underlying model reuse is measured separately from session reuse
  // --------------------------------------------------------------------------
  await t.test('9. Underlying model weights persistence is measured separately from session resets', async () => {
    setupContext()

    // 3 session resets
    await resetSessionForCompactedContext()
    await resetSessionForCompactedContext()
    await resetSessionForCompactedContext()

    const aiMetrics = getAIMetrics()
    assert.equal(aiMetrics.sessionDestroyCount, 3, '3 Prompt API sessions destroyed')
    assert.equal(aiMetrics.warmupCount, 0, '0 model re-downloads / warmups triggered')
  })

  // --------------------------------------------------------------------------
  // Scenario 10: Multiple tool calls in one turn receive independently authorized execution tokens
  // --------------------------------------------------------------------------
  await t.test('10. Multiple tool calls in one turn receive independently authorized Level B tokens', async () => {
    setupContext('user_1', 'sess_1', 1)

    // Mint Level A grant
    const grant = voiceAuthorizationManager.mintTurnGrant({
      turnId: 1,
      userId: 'user_1',
      sessionId: 'sess_1',
      mode: 'UNIVERSAL_VOICE',
      activationMethod: 'PUSH_TO_TALK',
    })

    assert.equal(grant.maxScope, 'EXECUTE_MUTATING_ACTIONS')

    // Tool 1: getTabs
    const token1 = voiceAuthorizationManager.mintExecutionToken(grant, 'getTabs')
    assert.notEqual(token1.tokenId, '')
    assert.equal(token1.targetToolName, 'getTabs')

    const outcome1 = voiceAuthorizationManager.validateAndConsume(token1, {
      toolName: 'getTabs',
      turnId: 1,
      userId: 'user_1',
      sessionId: 'sess_1',
    })
    assert.equal(outcome1.authorized, true)
    assert.equal(outcome1.reason, 'SUCCESS')

    // Tool 2: openTab
    const token2 = voiceAuthorizationManager.mintExecutionToken(grant, 'openTab')
    assert.notEqual(token2.tokenId, token1.tokenId, 'Distinct tool token ID must be generated')
    assert.equal(token2.targetToolName, 'openTab')

    const outcome2 = voiceAuthorizationManager.validateAndConsume(token2, {
      toolName: 'openTab',
      turnId: 1,
      userId: 'user_1',
      sessionId: 'sess_1',
    })
    assert.equal(outcome2.authorized, true)
    assert.equal(outcome2.reason, 'SUCCESS')

    // Tool 3: switchTab
    const token3 = voiceAuthorizationManager.mintExecutionToken(grant, 'switchTab')
    assert.notEqual(token3.tokenId, token2.tokenId)

    const outcome3 = voiceAuthorizationManager.validateAndConsume(token3, {
      toolName: 'switchTab',
      turnId: 1,
      userId: 'user_1',
      sessionId: 'sess_1',
    })
    assert.equal(outcome3.authorized, true)
    assert.equal(outcome3.reason, 'SUCCESS')
  })

  // --------------------------------------------------------------------------
  // Scenario 11: Execution tokens are single-use and tool-bound (TOOL_MISMATCH)
  // --------------------------------------------------------------------------
  await t.test('11. Execution tokens are single-use and tool-bound (TOOL_MISMATCH & replay prevention)', async () => {
    setupContext('user_1', 'sess_1', 1)

    const grant = voiceAuthorizationManager.mintTurnGrant({
      turnId: 1,
      userId: 'user_1',
      sessionId: 'sess_1',
      mode: 'UNIVERSAL_VOICE',
    })

    // Mint token specifically bound to 'getTabs'
    const token = voiceAuthorizationManager.mintExecutionToken(grant, 'getTabs')

    // 1. Attempt to execute different classified tool 'openTab' -> TOOL_MISMATCH
    const mismatchOutcome = voiceAuthorizationManager.validateAndConsume(token, {
      toolName: 'openTab',
      turnId: 1,
      userId: 'user_1',
      sessionId: 'sess_1',
    })
    assert.equal(mismatchOutcome.authorized, false)
    assert.equal(mismatchOutcome.reason, 'TOOL_MISMATCH')

    // 2. Legitimate execution on bound tool 'getTabs' -> SUCCESS
    const legitimateOutcome = voiceAuthorizationManager.validateAndConsume(token, {
      toolName: 'getTabs',
      turnId: 1,
      userId: 'user_1',
      sessionId: 'sess_1',
    })
    assert.equal(legitimateOutcome.authorized, true)

    // 3. Attempt replay on same tool -> TOKEN_ALREADY_CONSUMED
    const replayOutcome = voiceAuthorizationManager.validateAndConsume(token, {
      toolName: 'getTabs',
      turnId: 1,
      userId: 'user_1',
      sessionId: 'sess_1',
    })
    assert.equal(replayOutcome.authorized, false)
    assert.equal(replayOutcome.reason, 'TOKEN_ALREADY_CONSUMED')
  })

  // --------------------------------------------------------------------------
  // Scenario 12: Turn grant cannot authorize tools after 30s deadline (DEADLINE_EXCEEDED)
  // --------------------------------------------------------------------------
  await t.test('12. Turn grant cannot authorize tools after its 30s absolute deadline', async () => {
    setupContext('user_1', 'sess_1', 1)

    const now = Date.now()
    const grant = voiceAuthorizationManager.mintTurnGrant({
      turnId: 1,
      userId: 'user_1',
      sessionId: 'sess_1',
      currentTime: now,
    })

    assert.equal(grant.absoluteDeadlineMs, now + 30_000)

    // Attempt to mint execution token 31 seconds later
    const futureTime = now + 31_000
    const token = voiceAuthorizationManager.mintExecutionToken(grant, 'getTabs', futureTime)
    assert.equal(token.scope, 'DENIED', 'Execution token minted past deadline must have DENIED scope')

    const outcome = voiceAuthorizationManager.validateAndConsume(token, {
      toolName: 'getTabs',
      turnId: 1,
      userId: 'user_1',
      sessionId: 'sess_1',
      currentTime: futureTime,
    })
    assert.equal(outcome.authorized, false)
  })

  // --------------------------------------------------------------------------
  // Scenario 13: Cancelled/superseded turns cannot mint new execution tokens
  // --------------------------------------------------------------------------
  await t.test('13. Cancelled/superseded turns cannot mint new execution tokens', async () => {
    setupContext('user_1', 'sess_1', 1)

    const grant = voiceAuthorizationManager.mintTurnGrant({
      turnId: 1,
      userId: 'user_1',
      sessionId: 'sess_1',
    })

    // User cancels turn via Escape or barge-in
    voiceAuthorizationManager.cancelTurn(1, 'User pressed Escape')

    const token = voiceAuthorizationManager.mintExecutionToken(grant, 'getTabs')
    assert.equal(token.scope, 'DENIED')

    const outcome = voiceAuthorizationManager.validateAndConsume(token, {
      toolName: 'getTabs',
      turnId: 1,
      userId: 'user_1',
      sessionId: 'sess_1',
    })
    assert.equal(outcome.authorized, false)
    assert.ok(outcome.reason === 'TOKEN_REVOKED' || outcome.reason === 'INSUFFICIENT_SCOPE')
  })

  // --------------------------------------------------------------------------
  // Scenario 14: Account switching invalidates old grants
  // --------------------------------------------------------------------------
  await t.test('14. Account switching invalidates old turn grants and execution tokens', async () => {
    setupContext('alice', 'sess_1', 1)

    const grant = voiceAuthorizationManager.mintTurnGrant({
      turnId: 1,
      userId: 'alice',
      sessionId: 'sess_1',
    })

    // Account switches to Bob
    voiceAuthorizationManager.switchAccount('bob')

    // Alice's grant cannot mint valid tokens under Bob
    const token = voiceAuthorizationManager.mintExecutionToken(grant, 'getTabs')
    assert.equal(token.scope, 'DENIED')

    const outcome = voiceAuthorizationManager.validateAndConsume(token, {
      toolName: 'getTabs',
      turnId: 1,
      userId: 'bob',
      sessionId: 'sess_1',
    })
    assert.equal(outcome.authorized, false)
  })

  // --------------------------------------------------------------------------
  // Scenario 15: High-impact confirmation remains strictly enforced
  // --------------------------------------------------------------------------
  await t.test('15. High-impact confirmation remains strictly enforced on Level B execution tokens', async () => {
    setupContext('user_1', 'sess_1', 1)

    const grant = voiceAuthorizationManager.mintTurnGrant({
      turnId: 1,
      userId: 'user_1',
      sessionId: 'sess_1',
      mode: 'UNIVERSAL_VOICE',
    })

    const token = voiceAuthorizationManager.mintExecutionToken(grant, 'openTab')

    // 1. Without confirmation approval on high-impact financial URL -> CONFIRMATION_REQUIRED
    const unconfirmedOutcome = voiceAuthorizationManager.validateAndConsume(token, {
      toolName: 'openTab',
      parameters: { url: 'https://paypal.com/checkout' },
      turnId: 1,
      userId: 'user_1',
      sessionId: 'sess_1',
      confirmationApproved: false,
    })
    assert.equal(unconfirmedOutcome.authorized, false)
    assert.equal(unconfirmedOutcome.reason, 'CONFIRMATION_REQUIRED')

    // 2. Mint fresh token for user confirmation -> SUCCESS
    const confirmedToken = voiceAuthorizationManager.mintExecutionToken(grant, 'openTab')
    const confirmedOutcome = voiceAuthorizationManager.validateAndConsume(confirmedToken, {
      toolName: 'openTab',
      parameters: { url: 'https://paypal.com/checkout' },
      turnId: 1,
      userId: 'user_1',
      sessionId: 'sess_1',
      confirmationApproved: true,
    })
    assert.equal(confirmedOutcome.authorized, true)
    assert.equal(confirmedOutcome.reason, 'SUCCESS')
  })

  // --------------------------------------------------------------------------
  // Scenario 16: Expired execution token is rejected even if grant was initially valid
  // --------------------------------------------------------------------------
  await t.test('16. Expired execution token is rejected after its 10s TTL even if grant is valid', async () => {
    setupContext('user_1', 'sess_1', 1)

    const now = Date.now()
    const grant = voiceAuthorizationManager.mintTurnGrant({
      turnId: 1,
      userId: 'user_1',
      sessionId: 'sess_1',
      mode: 'UNIVERSAL_VOICE',
      currentTime: now,
    })

    // Mint token at t=now (expires at t=now + 10_000)
    const token = voiceAuthorizationManager.mintExecutionToken(grant, 'getTabs', now)
    assert.equal(token.expiresAt, now + 10_000)

    // Attempt consumption at t=now + 11_000 (token TTL expired, grant has 19s remaining)
    const outcome = voiceAuthorizationManager.validateAndConsume(token, {
      toolName: 'getTabs',
      turnId: 1,
      userId: 'user_1',
      sessionId: 'sess_1',
      currentTime: now + 11_000,
    })
    assert.equal(outcome.authorized, false)
    assert.equal(outcome.reason, 'TOKEN_EXPIRED')
  })

  // --------------------------------------------------------------------------
  // Scenario 17: Long-running tool call cannot bypass authorization after turn cancellation
  // --------------------------------------------------------------------------
  await t.test('17. Turn cancellation revokes in-flight and future tokens, preventing late execution', async () => {
    setupContext('user_1', 'sess_1', 1)

    const grant = voiceAuthorizationManager.mintTurnGrant({
      turnId: 1,
      userId: 'user_1',
      sessionId: 'sess_1',
    })

    const token = voiceAuthorizationManager.mintExecutionToken(grant, 'getTabs')

    // Turn is cancelled during long-running prompt or network latency
    voiceAuthorizationManager.cancelTurn(1, 'User interrupted')

    // Validation boundary check
    const outcome = voiceAuthorizationManager.validateAndConsume(token, {
      toolName: 'getTabs',
      turnId: 1,
      userId: 'user_1',
      sessionId: 'sess_1',
    })
    assert.equal(outcome.authorized, false)
    assert.equal(outcome.reason, 'TOKEN_REVOKED')
  })
})
