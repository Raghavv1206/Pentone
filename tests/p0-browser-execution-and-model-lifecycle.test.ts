import test from 'node:test'
import assert from 'node:assert/strict'

import { 
  parseViewCountSnippet, 
  extractViewCountFromText, 
  selectHighestViewVideo, 
  type VideoCandidate 
} from '../lib/view-count-normalizer'
import { validateToolCallSchema, parseToolCallDetailed } from '../lib/tool-parser'
import { verifyNavigationState } from '../lib/tools/clickElement'
import { 
  createActiveTask, 
  advanceActiveTask, 
  formatTaskStateForPrompt, 
  formatTaskStateForSummary, 
  isContinuityOrReplacementInstruction 
} from '../lib/task-state'
import { 
  buildTaskCheckpoint, 
  persistTaskCheckpoint, 
  getActiveTaskCheckpoint, 
  clearTaskCheckpoint, 
  formatCheckpointForCompactedSession 
} from '../lib/task-checkpoint'
import { 
  getAIMetrics, 
  resetAIMetrics, 
  recordCompactionMetrics, 
  recordTaskRecoveryEvent 
} from '../lib/ai'
import { 
  checkPromptAPIAvailability, 
  createResilientSession, 
  getPromptAPILifecycleMetrics, 
  resetPromptAPILifecycleMetrics 
} from '../lib/ai-config'
import { 
  voiceAuthorizationManager 
} from '../lib/audio/voice-authorization-manager'
import { 
  classifyTool 
} from '../lib/audio/tool-authorization-classifier'
import { 
  WhisperASRService 
} from '../lib/audio/whisper-asr-service'
import { 
  executeIncrementalCompaction, 
  estimateAssembledContextTokens, 
  partitionMessagesForCompaction, 
  pruneBulkyToolResults 
} from '../lib/summarizer'
import { createUserMessage, createAssistantMessage, createInternalMessage } from '../lib/messages'

test('P0 Browser Execution: View Count Normalization & Extraction', async (t) => {
  await t.test('1. Normalizes standard K/M/B abbreviations', () => {
    assert.equal(parseViewCountSnippet('1.2K views').numeric, 1200)
    assert.equal(parseViewCountSnippet('450K views').numeric, 450000)
    assert.equal(parseViewCountSnippet('2.3M views').numeric, 2300000)
    assert.equal(parseViewCountSnippet('1.5B views').numeric, 1500000000)
    assert.equal(parseViewCountSnippet('85K').numeric, 85000)
  })

  await t.test('2. Normalizes raw integers, comma formats, and zero views', () => {
    assert.equal(parseViewCountSnippet('1,234,567 views').numeric, 1234567)
    assert.equal(parseViewCountSnippet('85 views').numeric, 85)
    assert.equal(parseViewCountSnippet('0 views').numeric, 0)
    assert.equal(parseViewCountSnippet('No views').numeric, 0)
  })

  await t.test('3. Normalizes localized and non-English formats (Lakh, Crore, European, CJK)', () => {
    assert.equal(parseViewCountSnippet('1.5 Lakh views').numeric, 150000)
    assert.equal(parseViewCountSnippet('2.4 Crore views').numeric, 24000000)
    assert.equal(parseViewCountSnippet('1,2 M de vues').numeric, 1200000)
    assert.equal(parseViewCountSnippet('2,5 Mio. Aufrufe').numeric, 2500000)
    assert.equal(parseViewCountSnippet('12万回視聴').numeric, 120000)
  })

  await t.test('4. Extracts view count from composite YouTube aria-label without confusing dates or duration', () => {
    const aria1 = 'React in 100 Seconds by Fireship 3 years ago 2 minutes, 28 seconds 2,345,678 views'
    const res1 = extractViewCountFromText(aria1)
    assert.equal(res1.numeric, 2345678)

    const aria2 = 'React Tutorial for Beginners by Programming with Mosh 2 years ago 1 hour, 18 minutes 3.4M views'
    const res2 = extractViewCountFromText(aria2)
    assert.equal(res2.numeric, 3400000)

    const aria3 = 'Next.js 14 Full Course by freeCodeCamp 6 months ago 11 hours, 55 minutes 450K views'
    const res3 = extractViewCountFromText(aria3)
    assert.equal(res3.numeric, 450000)
  })

  await t.test('5. Missing view counts are never invented', () => {
    const noViewsText = 'React Tutorial by Some Channel 2 years ago 15 minutes'
    const res = extractViewCountFromText(noViewsText)
    assert.equal(res.numeric, null)
    assert.equal(res.confidence, 'none')
  })

  await t.test('6. Highest-view candidate is selected correctly among candidates', () => {
    const candidates: VideoCandidate[] = [
      { index: 0, title: 'Video A', viewCountRaw: '1.2M views', viewCountNumeric: 1200000, confidence: 'high', visibility: true },
      { index: 1, title: 'Video B', viewCountRaw: '450K views', viewCountNumeric: 450000, confidence: 'high', visibility: true },
      { index: 2, title: 'Video C', viewCountRaw: '8.9M views', viewCountNumeric: 8900000, confidence: 'high', visibility: true },
      { index: 3, title: 'Video D', viewCountRaw: '2.3M views', viewCountNumeric: 2300000, confidence: 'high', visibility: true }
    ]

    const highest = selectHighestViewVideo(candidates)
    assert.ok(highest)
    assert.equal(highest.index, 2)
    assert.equal(highest.title, 'Video C')
    assert.equal(highest.viewCountNumeric, 8900000)
  })
})

test('P0 Browser Execution: Tool Schema Validation & Structured Error Recovery', async (t) => {
  await t.test('7. Unknown tool name returns structured TOOL_NAME_LOOKUP error', () => {
    const res = validateToolCallSchema('nonExistentTool', {})
    assert.equal(res.valid, false)
    assert.ok(res.structuredError)
    assert.equal(res.structuredError.failureStage, 'TOOL_NAME_LOOKUP')
    assert.equal(res.structuredError.toolName, 'nonExistentTool')
  })

  await t.test('8. Unexpected parameters are rejected strictly with SCHEMA_VALIDATION error', () => {
    const res = validateToolCallSchema('clickElement', { index: 1, unexpectedParam: 'bad' })
    assert.equal(res.valid, false)
    assert.ok(res.structuredError)
    assert.equal(res.structuredError.failureStage, 'SCHEMA_VALIDATION')
    assert.equal(res.structuredError.invalidArgument, 'unexpectedParam')
  })

  await t.test('9. Missing required parameter returns SCHEMA_VALIDATION error', () => {
    const res = validateToolCallSchema('clickElement', {})
    assert.equal(res.valid, false)
    assert.ok(res.structuredError)
    assert.equal(res.structuredError.failureStage, 'SCHEMA_VALIDATION')
    assert.equal(res.structuredError.invalidArgument, 'index')
  })

  await t.test('10. Invalid parameter types return TYPE_MISMATCH error', () => {
    const res = validateToolCallSchema('clickElement', { index: 'notANumber' })
    assert.equal(res.valid, false)
    assert.ok(res.structuredError)
    assert.equal(res.structuredError.failureStage, 'TYPE_MISMATCH')
    assert.equal(res.structuredError.invalidArgument, 'index')
  })

  await t.test('11. Security rules enforce non-negative integers for element indices', () => {
    const resNegative = validateToolCallSchema('clickElement', { index: -5 })
    assert.equal(resNegative.valid, false)
    assert.equal(resNegative.structuredError?.failureStage, 'SECURITY_RULE')

    const resDecimal = validateToolCallSchema('clickElement', { index: 2.7 })
    assert.equal(resDecimal.valid, false)
    assert.equal(resDecimal.structuredError?.failureStage, 'SECURITY_RULE')
  })

  await t.test('12. Valid tool calls parse and sanitize cleanly', () => {
    const res = validateToolCallSchema('clickElement', { index: 2 })
    assert.equal(res.valid, true)
    assert.equal(res.toolCall?.function, 'clickElement')
    assert.equal(res.toolCall?.arguments.index, 2)
  })

  await t.test('13. Detailed parser extracts candidate and returns structuredError on schema failure', () => {
    const raw = '<function_call>{"function": "clickElement", "arguments": {"index": 3, "foo": "bar"}}</function_call>'
    const parsed = parseToolCallDetailed(raw)
    assert.equal(parsed.success, false)
    assert.ok(parsed.structuredError)
    assert.equal(parsed.structuredError.failureStage, 'SCHEMA_VALIDATION')
    assert.equal(parsed.structuredError.invalidArgument, 'foo')
  })

  await t.test('13b. Bounded navigation verification detects YouTube SPA navigation to watch URL', async () => {
    // Setup chrome mock for tabs and scripting
    const origChrome = (globalThis as any).chrome
    let queryCallCount = 0
    ;(globalThis as any).chrome = {
      tabs: {
        query: async () => {
          queryCallCount++
          // First call: still on search page. Second call: reached watch URL
          const url = queryCallCount > 1 ? 'https://www.youtube.com/watch?v=SqcY0GlETPk' : 'https://www.youtube.com/results?search_query=react'
          return [{ id: 101, url }]
        }
      },
      scripting: {
        executeScript: async () => [{ result: 'https://www.youtube.com/watch?v=SqcY0GlETPk' }]
      }
    }

    try {
      const outcome = await verifyNavigationState(101, 'https://www.youtube.com/results?search_query=react', 'https://www.youtube.com/watch?v=SqcY0GlETPk', 1000, 20)
      assert.equal(outcome.verified, true)
      assert.equal(outcome.timedOut, false)
      assert.equal(outcome.finalUrl, 'https://www.youtube.com/watch?v=SqcY0GlETPk')
    } finally {
      ;(globalThis as any).chrome = origChrome
    }
  })

  await t.test('13c. Bounded navigation verification times out if target URL was not reached', async () => {
    const origChrome = (globalThis as any).chrome
    ;(globalThis as any).chrome = {
      tabs: {
        query: async () => [{ id: 102, url: 'https://www.youtube.com/results?search_query=react' }]
      },
      scripting: {
        executeScript: async () => [{ result: 'https://www.youtube.com/results?search_query=react' }]
      }
    }

    try {
      // 100ms max timeout with 20ms poll interval
      const outcome = await verifyNavigationState(102, 'https://www.youtube.com/results?search_query=react', 'https://www.youtube.com/watch?v=NonExistent', 100, 20)
      assert.equal(outcome.verified, false)
      assert.equal(outcome.timedOut, true)
    } finally {
      ;(globalThis as any).chrome = origChrome
    }
  })
})

test('P0 Task Continuity & Checkpoint Architecture', async (t) => {
  await t.test('14. Creates structured YouTube video analysis task from user command', () => {
    const task = createActiveTask('Analyze this page and open the video with most views.')
    assert.equal(task.pendingActions[0], 'findElements')
    assert.equal(task.steps.length, 3)
    assert.equal(task.extractedData.selectionCriteria, 'highest_views')
  })

  await t.test('15. Builds and formats task checkpoint preserving browser continuity', () => {
    const task = createActiveTask('Analyze this page and open the video with most views.')
    const advanced = advanceActiveTask(task, 'findElements', {
      candidates: [
        { index: 1, title: 'React Guide', viewCountRaw: '5M views', viewCountNumeric: 5000000 }
      ],
      highestViewCandidate: { index: 1, title: 'React Guide', viewCountRaw: '5M views', viewCountNumeric: 5000000 }
    })

    const checkpoint = buildTaskCheckpoint(advanced, undefined, { url: 'https://www.youtube.com/results?search_query=react', title: 'YouTube' })
    assert.equal(checkpoint.searchCompleted, false)
    assert.equal(checkpoint.resultsExtracted, true)
    assert.equal(checkpoint.selectedCandidate?.title, 'React Guide')
    assert.equal(checkpoint.completedSteps[0], 'findElements')

    const formatted = formatCheckpointForCompactedSession(checkpoint)
    assert.ok(formatted.includes('ACTIVE TASK RESUMPTION CHECKPOINT'))
    assert.ok(formatted.includes('React Guide'))
    assert.ok(formatted.includes('Completed Browser Actions: findElements'))
  })

  await t.test('16. Context compaction incorporates task checkpoint without losing state', async () => {
    const task = createActiveTask('Analyze this page and open the video with most views.')
    const taskWithData = advanceActiveTask(task, 'findElements', {
      highestViewCandidate: { index: 2, title: 'Best Tutorial', viewCountRaw: '9M views', viewCountNumeric: 9000000 }
    })

    const messages = [
      createUserMessage('Open YouTube and search for react'),
      createInternalMessage('[TOOL RESULT]\nOpened YouTube in new tab', 'tool_result'),
      createUserMessage('Analyze this page and open the video with most views.'),
      createAssistantMessage('<function_call>{"function": "findElements", "arguments": {"query": "video results"}}</function_call>'),
      createInternalMessage('[TOOL RESULT]\nFound 10 videos...', 'tool_result')
    ]

    const breakdown = estimateAssembledContextTokens({
      messages,
      activeTask: taskWithData,
      activeTabUrl: 'https://www.youtube.com/results?search_query=react'
    })

    assert.ok(breakdown.totalEstimatedTokens > 0)
    assert.ok(breakdown.taskTokens > 0)

    const summaryBlock = formatTaskStateForSummary(taskWithData)
    assert.ok(summaryBlock.includes('ACTIVE TASK IN PROGRESS'))
    assert.ok(summaryBlock.includes('Best Tutorial'))
  })
})

test('P0 Model Lifecycle, Compaction & Whisper Initialization Metrics', async (t) => {
  await t.test('17. Measures Prompt API availability checks and underlying model init separately', async () => {
    resetAIMetrics()
    resetPromptAPILifecycleMetrics()

    // Mock window with LanguageModel
    const originalWindow = (globalThis as any).window
    ;(globalThis as any).window = {
      LanguageModel: {
        availability: async () => 'readily',
        create: async () => ({ destroy: () => {} })
      }
    }

    try {
      const avail = await checkPromptAPIAvailability({ multimodal: false })
      assert.equal(avail, 'readily')

      const session = await createResilientSession({ multimodal: false })
      assert.ok(session)

      const metrics = getAIMetrics()
      assert.equal(metrics.availabilityCheckCount, 1)
      assert.equal(metrics.modelInitializationCount, 1)
    } finally {
      ;(globalThis as any).window = originalWindow
    }
  })

  await t.test('18. Tracks compaction metrics (tokens before/after and duration) cleanly', () => {
    resetAIMetrics()
    recordCompactionMetrics(7200, 2400, 85)
    recordTaskRecoveryEvent()

    const metrics = getAIMetrics()
    assert.equal(metrics.compactionCount, 1)
    assert.equal(metrics.tokensBeforeCompaction, 7200)
    assert.equal(metrics.tokensAfterCompaction, 2400)
    assert.equal(metrics.compactionDurationMs, 85)
    assert.equal(metrics.taskRecoveryCount, 1)
  })

  await t.test('19. Whisper concurrent initialization shares a single promise', async () => {
    const whisper = new WhisperASRService()
    whisper.resetMetrics()

    let initCallCount = 0
    WhisperASRService.pipelineFactoryOverride = async () => {
      initCallCount++
      await new Promise(r => setTimeout(r, 20))
      return { transcribe: async () => ({ text: 'ok' }) }
    }

    try {
      // Launch 3 concurrent inits
      await Promise.all([
        whisper.initialize(),
        whisper.initialize(),
        whisper.initialize()
      ])

      assert.equal(initCallCount, 1, 'Concurrent initialization must call factory exactly once')
      assert.equal(whisper.getMetrics().initCount, 1)

      // Subsequent initialization reuses cached pipeline
      await whisper.initialize()
      assert.equal(whisper.getMetrics().reuseCount, 1)
    } finally {
      WhisperASRService.pipelineFactoryOverride = undefined
    }
  })
})

test('P0 Voice Authorization Gate Integrity Preservation', async (t) => {
  await t.test('20. Two-level authorization enforces single-use Level B execution tokens', () => {
    voiceAuthorizationManager.clear()

    voiceAuthorizationManager.setActiveContext({
      userId: 'user_p0',
      sessionId: 'sess_p0',
      turnId: 1
    })

    const grant = voiceAuthorizationManager.mintTurnGrant({
      turnId: 1,
      userId: 'user_p0',
      sessionId: 'sess_p0',
      mode: 'UNIVERSAL_VOICE',
      activationMethod: 'PUSH_TO_TALK'
    })

    assert.ok(grant)
    assert.equal(grant.maxScope, 'EXECUTE_MUTATING_ACTIONS')

    // Mint token for openTab
    const token1 = voiceAuthorizationManager.mintExecutionToken(grant, 'openTab')
    assert.equal(token1.targetToolName, 'openTab')

    // Consume token 1
    const outcome1 = voiceAuthorizationManager.validateAndConsume(token1, {
      toolName: 'openTab',
      parameters: { url: 'https://www.youtube.com' },
      turnId: 1,
      userId: 'user_p0',
      sessionId: 'sess_p0'
    })
    assert.equal(outcome1.authorized, true)

    // Replay of token 1 fails immediately
    const replayOutcome = voiceAuthorizationManager.validateAndConsume(token1, {
      toolName: 'openTab',
      parameters: { url: 'https://www.youtube.com' },
      turnId: 1,
      userId: 'user_p0',
      sessionId: 'sess_p0'
    })
    assert.equal(replayOutcome.authorized, false)
    assert.equal(replayOutcome.reason, 'TOKEN_ALREADY_CONSUMED')

    // Mint independent token 2 for clickElement
    const token2 = voiceAuthorizationManager.mintExecutionToken(grant, 'clickElement')
    assert.notEqual(token1.tokenId, token2.tokenId)
    assert.equal(token2.targetToolName, 'clickElement')

    const outcome2 = voiceAuthorizationManager.validateAndConsume(token2, {
      toolName: 'clickElement',
      parameters: { index: 2 },
      turnId: 1,
      userId: 'user_p0',
      sessionId: 'sess_p0'
    })
    assert.equal(outcome2.authorized, true)
  })

  await t.test('21. High-impact destructive tools require confirmation and task checkpoints never mint authority', () => {
    voiceAuthorizationManager.clear()

    voiceAuthorizationManager.setActiveContext({
      userId: 'user_p0',
      sessionId: 'sess_p0',
      turnId: 2
    })

    const grant = voiceAuthorizationManager.mintTurnGrant({
      turnId: 2,
      userId: 'user_p0',
      sessionId: 'sess_p0',
      mode: 'UNIVERSAL_VOICE',
      activationMethod: 'PUSH_TO_TALK'
    })

    const token = voiceAuthorizationManager.mintExecutionToken(grant, 'openTab')

    // Attempt sensitive banking endpoint without confirmation
    const outcome = voiceAuthorizationManager.validateAndConsume(token, {
      toolName: 'openTab',
      parameters: { url: 'https://banking.example.com/transfer' },
      turnId: 2,
      userId: 'user_p0',
      sessionId: 'sess_p0',
      confirmationApproved: false
    })
    assert.equal(outcome.authorized, false)
    assert.equal(outcome.reason, 'CONFIRMATION_REQUIRED')
  })
})
