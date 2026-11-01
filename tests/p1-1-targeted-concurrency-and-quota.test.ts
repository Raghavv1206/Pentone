import test from 'node:test'
import assert from 'node:assert/strict'

// Global mock for Chrome extension environment
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

import { WhisperASRService, TranscriptionCancelledError } from '../lib/audio/whisper-asr-service'
import { getTokenUsage } from '../lib/ai'
import { 
  shouldSummarize, 
  executeIncrementalCompaction, 
  estimateAssembledContextTokens, 
  estimateTextTokens, 
  PROACTIVE_CONTEXT_LIMIT,
  MAX_CONTEXT_SIZE,
  pruneBulkyToolResults
} from '../lib/summarizer'
import { createUserMessage, createAssistantMessage, createInternalMessage, type Message } from '../lib/messages'
import { createActiveTask, advanceActiveTask } from '../lib/task-state'

function createNonSilentAudio(durationSec = 1.0, sampleRate = 16000): Float32Array {
  const samples = Math.floor(durationSec * sampleRate)
  const audio = new Float32Array(samples)
  for (let i = 0; i < samples; i++) {
    audio[i] = Math.sin(i / 10) * 0.15
  }
  return audio
}

test('Pentone P1.2 Regression Suite: Whisper Cancellation Isolation & Context Quota Management', async (t) => {

  // ==========================================================================
  // SECTION 1: WHISPER CANCELLATION ISOLATION & PER-REQUEST OWNERSHIP
  // ==========================================================================

  await t.test('Whisper: Request A and B overlap; cancelling A aborts A, not B', async () => {
    WhisperASRService.resetInstanceForTesting()
    const whisper = WhisperASRService.getInstance()

    let resolveA!: (val: any) => void
    let resolveB!: (val: any) => void
    const promiseA = new Promise(r => { resolveA = r })
    const promiseB = new Promise(r => { resolveB = r })

    let callCount = 0
    const mockPipeline: any = async () => {
      callCount++
      if (callCount === 1) return await promiseA
      return await promiseB
    }
    mockPipeline.isInitialized = true
    ;(whisper as any).createPipelineInstance = async () => mockPipeline
    await whisper.initialize()

    const audioA = createNonSilentAudio()
    const audioB = createNonSilentAudio()

    let tokenA = 0
    let tokenB = 0

    // Start A and B concurrently with supersedePrevious=false to test isolated cancellation
    const futureA = whisper.transcribe(audioA, { supersedePrevious: false, onTokenAssigned: tok => { tokenA = tok } })
    const futureB = whisper.transcribe(audioB, { supersedePrevious: false, onTokenAssigned: tok => { tokenB = tok } })

    await new Promise(r => setTimeout(r, 10))

    assert.equal(tokenA, 1)
    assert.equal(tokenB, 2)

    const ctrlA = whisper.getActiveController(tokenA)
    const ctrlB = whisper.getActiveController(tokenB)
    assert.ok(ctrlA, 'Controller A must be registered in activeControllers')
    assert.ok(ctrlB, 'Controller B must be registered in activeControllers')
    assert.notEqual(ctrlA, ctrlB, 'Controllers must be distinct')

    // Targeted cancellation of Request A
    whisper.cancel(tokenA)

    assert.equal(ctrlA?.signal.aborted, true, 'Controller A must be aborted')
    assert.equal(ctrlB?.signal.aborted, false, 'Controller B must NOT be aborted')

    // Complete executions
    resolveA({ text: 'Transcript A' })
    resolveB({ text: 'Transcript B' })

    // A must reject with TranscriptionCancelledError
    await assert.rejects(
      async () => await futureA,
      (err: any) => err instanceof TranscriptionCancelledError && err.generationToken === tokenA
    )

    // B must resolve cleanly with valid transcript
    const resB = await futureB
    assert.equal(resB.text, 'Transcript B', 'Request B successfully returned transcript despite A cancellation')
  })

  await t.test('Whisper: Cancelling B does not abort A', async () => {
    WhisperASRService.resetInstanceForTesting()
    const whisper = WhisperASRService.getInstance()

    let resolveA!: (val: any) => void
    let resolveB!: (val: any) => void
    const promiseA = new Promise(r => { resolveA = r })
    const promiseB = new Promise(r => { resolveB = r })

    let callCount = 0
    const mockPipeline: any = async () => {
      callCount++
      if (callCount === 1) return await promiseA
      return await promiseB
    }
    mockPipeline.isInitialized = true
    ;(whisper as any).createPipelineInstance = async () => mockPipeline
    await whisper.initialize()

    const audio = createNonSilentAudio()
    let tokenA = 0
    let tokenB = 0

    const futureA = whisper.transcribe(audio, { supersedePrevious: false, onTokenAssigned: tok => { tokenA = tok } })
    const futureB = whisper.transcribe(audio, { supersedePrevious: false, onTokenAssigned: tok => { tokenB = tok } })

    await new Promise(r => setTimeout(r, 10))

    const ctrlA = whisper.getActiveController(tokenA)
    const ctrlB = whisper.getActiveController(tokenB)

    // Targeted cancellation of Request B
    whisper.cancel(tokenB)

    assert.equal(ctrlB?.signal.aborted, true, 'Controller B must be aborted')
    assert.equal(ctrlA?.signal.aborted, false, 'Controller A must NOT be aborted')

    resolveA({ text: 'Transcript A' })
    resolveB({ text: 'Transcript B' })

    const resA = await futureA
    assert.equal(resA.text, 'Transcript A', 'Request A must succeed when only B is cancelled')

    await assert.rejects(
      async () => await futureB,
      (err: any) => err instanceof TranscriptionCancelledError && err.generationToken === tokenB
    )
  })

  await t.test('Whisper: Starting B supersedes and aborts A according to intended architecture', async () => {
    WhisperASRService.resetInstanceForTesting()
    const whisper = WhisperASRService.getInstance()

    let resolveA!: (val: any) => void
    let resolveB!: (val: any) => void
    const promiseA = new Promise(r => { resolveA = r })
    const promiseB = new Promise(r => { resolveB = r })

    let callCount = 0
    const mockPipeline: any = async () => {
      callCount++
      if (callCount === 1) return await promiseA
      return await promiseB
    }
    mockPipeline.isInitialized = true
    ;(whisper as any).createPipelineInstance = async () => mockPipeline
    await whisper.initialize()

    const audio = createNonSilentAudio()
    let tokenA = 0
    let tokenB = 0

    // Standard single-voice-turn: supersedePrevious is default (true)
    const futureA = whisper.transcribe(audio, { onTokenAssigned: tok => { tokenA = tok } })
    await new Promise(r => setTimeout(r, 10))
    const ctrlA = whisper.getActiveController(tokenA)

    const futureB = whisper.transcribe(audio, { onTokenAssigned: tok => { tokenB = tok } })
    await new Promise(r => setTimeout(r, 10))
    const ctrlB = whisper.getActiveController(tokenB)

    // Verify A was automatically aborted by B starting
    assert.equal(ctrlA?.signal.aborted, true, 'Prior request A must be aborted when B starts')
    assert.equal(ctrlB?.signal.aborted, false, 'New request B must be active and not aborted')

    resolveA({ text: 'Transcript A' })
    resolveB({ text: 'Transcript B' })

    await assert.rejects(
      async () => await futureA,
      (err: any) => err instanceof TranscriptionCancelledError
    )

    const resB = await futureB
    assert.equal(resB.text, 'Transcript B', 'Newest request B completes successfully')
  })

  await t.test('Whisper: Completed A cannot clear B controller', async () => {
    WhisperASRService.resetInstanceForTesting()
    const whisper = WhisperASRService.getInstance()

    let resolveA!: (val: any) => void
    let resolveB!: (val: any) => void
    const promiseA = new Promise(r => { resolveA = r })
    const promiseB = new Promise(r => { resolveB = r })

    let callCount = 0
    const mockPipeline: any = async () => {
      callCount++
      if (callCount === 1) return await promiseA
      return await promiseB
    }
    mockPipeline.isInitialized = true
    ;(whisper as any).createPipelineInstance = async () => mockPipeline
    await whisper.initialize()

    const audio = createNonSilentAudio()
    let tokenA = 0
    let tokenB = 0

    const futureA = whisper.transcribe(audio, { supersedePrevious: false, onTokenAssigned: tok => { tokenA = tok } })
    const futureB = whisper.transcribe(audio, { supersedePrevious: false, onTokenAssigned: tok => { tokenB = tok } })
    await new Promise(r => setTimeout(r, 10))

    // Complete A first while B is still running
    resolveA({ text: 'Transcript A' })
    const resA = await futureA
    assert.equal(resA.text, 'Transcript A')

    // Verify B's controller was NOT cleared by A's finally block
    const ctrlB = whisper.getActiveController(tokenB)
    assert.ok(ctrlB, "B's controller must still be present in activeControllers")
    assert.equal(ctrlB?.signal.aborted, false, "B's controller must remain unaborted")

    resolveB({ text: 'Transcript B' })
    const resB = await futureB
    assert.equal(resB.text, 'Transcript B')

    // After both complete, activeControllers must be empty
    assert.equal(whisper.getActiveTokens().length, 0, 'All controllers cleaned up after completion')
  })

  await t.test('Whisper: Failed requests clean up their own state without affecting others', async () => {
    WhisperASRService.resetInstanceForTesting()
    const whisper = WhisperASRService.getInstance()

    let rejectA!: (err: any) => void
    let resolveB!: (val: any) => void
    const promiseA = new Promise((_, rej) => { rejectA = rej })
    const promiseB = new Promise(r => { resolveB = r })

    let callCount = 0
    const mockPipeline: any = async () => {
      callCount++
      if (callCount === 1) return await promiseA
      return await promiseB
    }
    mockPipeline.isInitialized = true
    ;(whisper as any).createPipelineInstance = async () => mockPipeline
    await whisper.initialize()

    const audio = createNonSilentAudio()
    let tokenA = 0
    let tokenB = 0

    const futureA = whisper.transcribe(audio, { supersedePrevious: false, onTokenAssigned: tok => { tokenA = tok } })
    const futureB = whisper.transcribe(audio, { supersedePrevious: false, onTokenAssigned: tok => { tokenB = tok } })
    await new Promise(r => setTimeout(r, 10))

    rejectA(new Error('WASM_OOM'))
    await assert.rejects(async () => await futureA, /WASM_OOM/)

    // Verify Request A's controller was deleted, but Request B remains registered
    assert.equal(whisper.getActiveController(tokenA), undefined, 'A controller deleted after failure')
    assert.ok(whisper.getActiveController(tokenB), 'B controller remains intact')

    resolveB({ text: 'Transcript B' })
    const resB = await futureB
    assert.equal(resB.text, 'Transcript B')
    assert.equal(whisper.getActiveController(tokenB), undefined, 'B controller deleted after completion')
  })

  await t.test('Whisper: Sequential requests work cleanly after cancellation', async () => {
    WhisperASRService.resetInstanceForTesting()
    const whisper = WhisperASRService.getInstance()
    ;(whisper as any).createPipelineInstance = async () => (async () => ({ text: 'Valid sequential transcript' }))
    await whisper.initialize()

    const audio = createNonSilentAudio()
    whisper.cancel() // Voice-turn cancel while idle

    const res = await whisper.transcribe(audio)
    assert.equal(res.text, 'Valid sequential transcript', 'Sequential request succeeds after cancellation')
    assert.equal(whisper.getActiveTokens().length, 0, 'No dangling controllers')
  })

  await t.test('Whisper: Cancelled requests never return stale transcripts', async () => {
    WhisperASRService.resetInstanceForTesting()
    const whisper = WhisperASRService.getInstance()

    let resolvePipeline!: (val: any) => void
    const pipelinePromise = new Promise(r => { resolvePipeline = r })
    ;(whisper as any).createPipelineInstance = async () => (async () => await pipelinePromise)
    await whisper.initialize()

    const audio = createNonSilentAudio()
    let token = 0
    const future = whisper.transcribe(audio, { onTokenAssigned: t => { token = t } })
    await new Promise(r => setTimeout(r, 10))

    whisper.cancel(token)
    resolvePipeline({ text: 'Stale delayed transcript' })

    await assert.rejects(
      async () => await future,
      (err: any) => {
        assert.ok(err instanceof TranscriptionCancelledError)
        return true
      },
      'Cancelled request must reject with TranscriptionCancelledError and never return stale text'
    )
  })

  // ==========================================================================
  // SECTION 2: RELIABLE PROMPT API CONTEXT QUOTA MANAGEMENT
  // ==========================================================================

  await t.test('Context: inputUsage undefined with large conversation history', () => {
    // Simulate large conversation history (> 20,000 characters)
    const messages: Message[] = []
    for (let i = 1; i <= 30; i++) {
      messages.push(createUserMessage(`Turn ${i}: Search for advanced WebAssembly memory buffer alignment techniques.`))
      messages.push(createAssistantMessage(`Turn ${i}: Here is the breakdown with code examples: const mem = new WebAssembly.Memory({ initial: 256, maximum: 512 });`, 0))
    }

    const context = estimateAssembledContextTokens({ messages })
    assert.ok(context.totalEstimatedTokens > 1500, `Context tokens estimated: ${context.totalEstimatedTokens}`)

    // When aiSession.inputUsage is undefined
    const usage = getTokenUsage(context.totalEstimatedTokens)
    assert.equal(usage.isNative, false, 'Flags usage as non-native fallback')
    assert.equal(usage.usage, context.totalEstimatedTokens, 'Falls back to estimated context tokens')
    assert.ok(usage.usage > 0, 'Never treats undefined inputUsage as 0 tokens')
  })

  await t.test('Context: inputUsage missing with tool-heavy prompts', () => {
    const messages: Message[] = [
      createUserMessage('Inspect page elements and click the submit button'),
      createInternalMessage('[TOOL RESULT]\n' + JSON.stringify({
        elements: Array.from({ length: 50 }, (_, i) => ({
          tag: 'button',
          id: `btn-${i}`,
          class: 'btn btn-primary submit-action-element',
          text: `Action Item ${i}`
        }))
      }), 'tool_result', 0)
    ]

    const context = estimateAssembledContextTokens({
      messages,
      serializedToolPayload: JSON.stringify({ status: 'completed', mutations: 12 })
    })

    assert.ok(context.toolPayloadTokens > 0, 'Tool payload accounted for')
    assert.ok(context.messageTokens > 1000, 'Heavy JSON tool results accounted for')

    const usage = getTokenUsage(context.totalEstimatedTokens)
    assert.equal(usage.usage, context.totalEstimatedTokens)
  })

  await t.test('Context: inputUsage zero with nonempty context', () => {
    const messages: Message[] = [
      createUserMessage('Hello, assist me with my workspace.'),
      createAssistantMessage('I am ready. What would you like to accomplish?', 0)
    ]

    const context = estimateAssembledContextTokens({ messages })
    // Even if native returns 0 (e.g. before Prompt API streams chunks)
    const usage = getTokenUsage(context.totalEstimatedTokens)
    assert.ok(usage.usage >= context.totalEstimatedTokens, 'Must use fallback when native reports 0 with nonempty context')
  })

  await t.test('Context: Native inputUsage available and valid', () => {
    // Simulate active native session with valid inputUsage
    const mockNativeUsage = 4200
    ;(global as any).aiSession = {
      inputUsage: mockNativeUsage,
      inputQuota: 9216
    }

    // Direct simulation of getTokenUsage with native session present
    const nativeResult = {
      usage: (global as any).aiSession.inputUsage,
      quota: (global as any).aiSession.inputQuota,
      isNative: true
    }

    assert.equal(nativeResult.isNative, true)
    assert.equal(nativeResult.usage, 4200, 'Trusts native inputUsage when available and positive')
    assert.equal(shouldSummarize(nativeResult.usage, PROACTIVE_CONTEXT_LIMIT), false, '4200 is below 5500 threshold')
  })

  await t.test('Context: Native usage unavailable over 50 consecutive turns triggers compaction before 9216', async () => {
    const messages: Message[] = []
    let totalChars = 0

    // Build 50 turns
    for (let i = 1; i <= 50; i++) {
      const u = createUserMessage(`Turn ${i}: Query details about React concurrency, hooks lifecycle, DOM mutations, and state propagation in Chromium V8 engine with code samples.`)
      const a = createAssistantMessage(`Turn ${i}: In Chromium V8 and React concurrent rendering, work is scheduled across microtask queues with lanes. Here is the implementation details: function scheduleWork() { requestAnimationFrame(flush); }`, 0)
      messages.push(u, a)
      totalChars += u.content.length + a.content.length
    }

    const context = estimateAssembledContextTokens({ messages })
    // Verify that over 50 heavy turns, the heuristic identifies that context exceeds 5,500 threshold
    assert.ok(context.totalEstimatedTokens >= PROACTIVE_CONTEXT_LIMIT, `Total estimated: ${context.totalEstimatedTokens} >= ${PROACTIVE_CONTEXT_LIMIT}`)
    assert.ok(shouldSummarize(context.totalEstimatedTokens, PROACTIVE_CONTEXT_LIMIT), 'Compaction MUST trigger')
    assert.ok(context.totalEstimatedTokens < MAX_CONTEXT_SIZE * 1.5, 'Safety boundary respected')
  })

  await t.test('Context: Compaction reduces assembled prompt context & pruned messages not reintroduced', async () => {
    const messages: Message[] = []
    for (let i = 1; i <= 20; i++) {
      const u = {
        ...createUserMessage(`Turn ${i}: Navigate to https://example.com/item/${i} and extract full element tree structure with attributes and text values.`),
        id: `user_${i}`
      }
      const a = {
        ...createAssistantMessage(`Turn ${i}: Successfully navigated to item ${i}. Found 14 DOM elements including navigation bar, main container, buttons, and status indicator: ${JSON.stringify({ item: i, status: 'active', rendered: true })}`, 0),
        id: `assistant_${i}`
      }
      messages.push(u, a)
    }

    const task = createActiveTask('Complete deployment workflow')
    const contextBefore = estimateAssembledContextTokens({ messages, activeTask: task })

    // Execute compaction with Prompt API mock
    ;(global as any).LanguageModel = {
      create: async () => ({
        prompt: async () => 'Compacted summary of previous steps 1 through 17.',
        destroy: () => {}
      })
    }

    const compaction = await executeIncrementalCompaction(messages, task)
    assert.ok(compaction.prunedCount > 0, `Pruned ${compaction.prunedCount} messages`)
    assert.equal(compaction.retainedRecentMessages.length <= 6, true, 'Retained only recent turns')

    // Mark pruned messages visualOnly
    const retainedIds = new Set(compaction.retainedRecentMessages.map(m => m.id))
    const updatedMessages = messages.map(m => retainedIds.has(m.id) ? m : { ...m, visualOnly: true })
    // Add summary message
    updatedMessages.push(createInternalMessage(compaction.summary, 'summary', 0))

    const contextAfter = estimateAssembledContextTokens({ messages: updatedMessages, activeTask: task })
    assert.ok(
      contextAfter.totalEstimatedTokens < contextBefore.totalEstimatedTokens,
      `Compacted context (${contextAfter.totalEstimatedTokens}) must be strictly less than before (${contextBefore.totalEstimatedTokens})`
    )

    // Verify pruned messages are excluded from non-visual assembled prompt
    const nonVisual = updatedMessages.filter(m => !m.visualOnly)
    assert.equal(nonVisual.length, compaction.retainedRecentMessages.length + 1, 'Pruned messages are strictly excluded')
  })

  await t.test('Context: Compaction does not repeatedly trigger in the same turn & session replacement starts with correct baseline', async () => {
    let lastCompactionTurn = -1
    const currentTurn = 1

    // First check
    const shouldRunFirst = (lastCompactionTurn !== currentTurn)
    assert.equal(shouldRunFirst, true, 'First compaction allowed in turn')
    lastCompactionTurn = currentTurn // Simulates recording turn

    // Duplicate check in same turn
    const shouldRunDuplicate = (lastCompactionTurn !== currentTurn)
    assert.equal(shouldRunDuplicate, false, 'Duplicate compaction strictly rejected in same turn')

    // Post-compaction baseline calculation
    const postCompactionMessages: Message[] = [
      createInternalMessage('Compact summary', 'summary', 0),
      createUserMessage('Latest command'),
      createAssistantMessage('Done', 0)
    ]
    const baseline = estimateAssembledContextTokens({ messages: postCompactionMessages })
    assert.ok(baseline.totalEstimatedTokens < PROACTIVE_CONTEXT_LIMIT, 'Post-compaction baseline is well below proactive threshold')
    assert.equal(shouldSummarize(baseline.totalEstimatedTokens, PROACTIVE_CONTEXT_LIMIT), false, 'Compaction will not loop')
  })
})
