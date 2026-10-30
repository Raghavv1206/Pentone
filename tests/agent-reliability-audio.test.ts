import test from 'node:test'
import assert from 'node:assert/strict'

// 1. Voice Recognition & Technical Vocabulary
import { 
  analyzeSpokenInput, 
  detectPhoneticCollisions, 
  containsTechnicalTerm 
} from '../lib/intent-validator'

// 2. Structured Active-Task State
import { 
  createActiveTask, 
  advanceActiveTask, 
  recordTaskData, 
  formatTaskStateForPrompt, 
  formatTaskStateForSummary 
} from '../lib/task-state'

// 3. Tool Schema & Parser Alignment
import { 
  validateToolCallSchema, 
  parseToolCall 
} from '../lib/tool-parser'
import { getToolSpec } from '../lib/tool-registry'

// 4. Navigation Router & Compound Task Handling
import { resolveDeterministicNavigation } from '../lib/navigation-router'

// 5. Context Preservation & Summarizer
import { summarizeConversation } from '../lib/summarizer'
import { createAssistantMessage, createUserMessage } from '../lib/messages'

// 6. Half-Duplex Audio Synchronization
import { isMicHardwareBusy, releaseMicHardwareLock } from '../lib/use-speech-recognition'

// =========================================================================
// TEST SUITE: PENTONE AGENT RELIABILITY, INTENT ACCURACY & AUDIO STABILITY
// =========================================================================

test('Voice & Vocabulary: Detects "reactor to real" phonetic collision for React tutorials', () => {
  const input = 'reactor to real'
  const collisions = detectPhoneticCollisions(input)
  assert.ok(collisions.length > 0, 'Should detect at least one phonetic collision')
  assert.equal(collisions[0].canonicalTerm, 'React tutorials')

  const analysis = analyzeSpokenInput(input)
  assert.equal(analysis.originalTranscript, input)
  assert.equal(analysis.hasPhoneticCollision, true)
  assert.equal(analysis.shouldClarify, true)
  assert.ok(analysis.suggestedClarification?.includes('React tutorials'))
})

test('Voice & Vocabulary: Identifies developer terms and frameworks in spoken input', () => {
  assert.equal(containsTechnicalTerm('please open github and search for react'), true)
  assert.equal(containsTechnicalTerm('show me typescript tutorials'), true)
  assert.equal(containsTechnicalTerm('what is python programming'), true)
  assert.equal(containsTechnicalTerm('how are you today'), false)
})

test('Voice & Vocabulary: Hinglish phonetic variations disambiguated with preserved transcript', () => {
  const hinglishInput = 'reactor to real sikhao'
  const analysis = analyzeSpokenInput(hinglishInput)
  assert.equal(analysis.originalTranscript, hinglishInput)
  assert.equal(analysis.hasPhoneticCollision, true)
  assert.ok(analysis.suggestedQuery?.includes('React tutorials'))
})

test('Deterministic Navigation: Ambiguous phonetic collision triggers clarification instead of false routing', () => {
  const result = resolveDeterministicNavigation('reactor to real')
  assert.equal(result.isMatch, false)
  assert.equal(result.isAmbiguous, true)
  assert.ok(result.clarificationPrompt?.includes('React tutorials'))
})

test('Deterministic Navigation: Compound request splits search query cleanly from subsequent actions', () => {
  const compoundInput = 'Open YouTube search for the best React tutorials, identify the first three visible video results and summarize their titles'
  const result = resolveDeterministicNavigation(compoundInput)
  assert.equal(result.isMatch, true)
  assert.equal(result.isCompoundTask, true)
  assert.ok(result.toolCall)
  assert.equal(result.toolCall.function, 'openTab')
  // URL should strictly contain the search query, NOT the subsequent instructions
  const url = new URL(result.toolCall.arguments.url)
  assert.equal(url.searchParams.get('search_query'), 'the best React tutorials')
})

test('Active Task State: Decomposes compound request into structured steps', () => {
  const input = 'Open YouTube search for the best React tutorials, identify the first three visible video results and summarize their titles'
  const task = createActiveTask(input)
  
  assert.equal(task.steps.length, 3)
  assert.equal(task.steps[0].action, 'openTab')
  assert.equal(task.steps[1].action, 'findElements')
  assert.equal(task.steps[2].action, 'summarizeTitles')
  assert.equal(task.status, 'in_progress')
  assert.deepEqual(task.pendingActions, ['openTab', 'findElements', 'summarizeTitles'])
  assert.deepEqual(task.completedActions, [])
})

test('Active Task State: Advances step upon action completion and records extracted data', () => {
  const input = 'Open YouTube search for the best React tutorials, identify the first three visible video results and summarize their titles'
  let task = createActiveTask(input)

  // Step 1 completes: openTab
  task = advanceActiveTask(task, 'openTab', 'Tab opened successfully')
  assert.equal(task.currentStepIndex, 1)
  assert.deepEqual(task.completedActions, ['openTab'])
  assert.deepEqual(task.pendingActions, ['findElements', 'summarizeTitles'])
  assert.equal(task.status, 'in_progress')

  // Step 2 completes: findElements and records video titles
  task = recordTaskData(task, 'visibleVideoTitles', [
    'React Full Course 2026',
    'React in 100 Seconds',
    'Mastering React Hooks'
  ])
  task = advanceActiveTask(task, 'findElements', { found: 3 })
  assert.equal(task.currentStepIndex, 2)
  assert.equal(task.extractedData.visibleVideoTitles.length, 3)
  assert.deepEqual(task.completedActions, ['openTab', 'findElements'])
  assert.deepEqual(task.pendingActions, ['summarizeTitles'])

  // Step 3 completes: summarizeTitles
  task = advanceActiveTask(task, 'summarizeTitles', 'Summary presented to user')
  assert.equal(task.status, 'completed')
  assert.equal(task.pendingActions.length, 0)
})

test('Active Task State: Formats task plan for prompt injection and summary compaction', () => {
  const input = 'Open YouTube search for the best React tutorials, identify the first three visible video results and summarize their titles'
  let task = createActiveTask(input)
  task = advanceActiveTask(task, 'openTab', 'Tab opened')
  task = recordTaskData(task, 'foundVideos', 3)

  const promptSnippet = formatTaskStateForPrompt(task)
  assert.ok(promptSnippet.includes('Active Task Plan'))
  assert.ok(promptSnippet.includes('Completed: openTab'))
  assert.ok(promptSnippet.includes('Pending: findElements'))
  assert.ok(promptSnippet.includes('foundVideos: 3'))

  const summarySnippet = formatTaskStateForSummary(task)
  assert.ok(summarySnippet.includes('[ACTIVE TASK IN PROGRESS]'))
  assert.ok(summarySnippet.includes('Completed Actions: openTab'))
  assert.ok(summarySnippet.includes('Pending Actions: findElements, summarizeTitles'))
})

test('Tool Parser & Schema: captureScreenshot accepts optional type parameter without schema rejection', () => {
  const spec = getToolSpec('captureScreenshot')
  assert.ok(spec, 'captureScreenshot spec must exist')
  const typeParam = spec.parameters.find(p => p.name === 'type')
  assert.ok(typeParam, 'type parameter must be registered in captureScreenshot spec')
  assert.equal(typeParam.required, false)

  // Validation with viewport
  const validViewport = validateToolCallSchema('captureScreenshot', { type: 'viewport' })
  assert.equal(validViewport.valid, true)
  assert.equal(validViewport.toolCall?.arguments.type, 'viewport')

  // Validation with fullPage
  const validFullPage = validateToolCallSchema('captureScreenshot', { type: 'fullPage' })
  assert.equal(validFullPage.valid, true)
  assert.equal(validFullPage.toolCall?.arguments.type, 'fullPage')

  // Empty arguments default cleanly to viewport
  const validEmpty = validateToolCallSchema('captureScreenshot', {})
  assert.equal(validEmpty.valid, true)
  assert.equal(validEmpty.toolCall?.arguments.type, 'viewport')

  // Unexpected argument strictly rejected
  const invalidArg = validateToolCallSchema('captureScreenshot', { invalidParam: true })
  assert.equal(invalidArg.valid, false)
})

test('Tool Parser: Shorthand captureScreenshot syntax parsed cleanly', () => {
  const shorthandViewport = 'captureScreenshot{type: "viewport"}'
  const parsed1 = parseToolCall(shorthandViewport)
  assert.ok(parsed1)
  assert.equal(parsed1.function, 'captureScreenshot')
  assert.equal(parsed1.arguments.type, 'viewport')

  const shorthandFull = 'captureScreenshot{type: "fullPage"}'
  const parsed2 = parseToolCall(shorthandFull)
  assert.ok(parsed2)
  assert.equal(parsed2.function, 'captureScreenshot')
  assert.equal(parsed2.arguments.type, 'fullPage')

  const shorthandEmpty = 'captureScreenshot{}'
  const parsed3 = parseToolCall(shorthandEmpty)
  assert.ok(parsed3)
  assert.equal(parsed3.function, 'captureScreenshot')
  assert.equal(parsed3.arguments.type, 'viewport')
})

test('Context Preservation: Conversation compaction retains active multi-step task state', async () => {
  const messages = [
    createUserMessage('Find something on google'),
    createAssistantMessage('I found it on google'),
    createUserMessage('Open YouTube search for the best React tutorials, identify the first three visible video results and summarize their titles'),
    createAssistantMessage('<function_call>{"function": "openTab", "arguments": {"url": "https://www.youtube.com/results?search_query=the+best+React+tutorials", "tabName": "YouTube"}}</function_call>')
  ]

  let task = createActiveTask(messages[2].content)
  task = advanceActiveTask(task, 'openTab')

  // Mock global LanguageModel for compaction
  const originalScope = (globalThis as any).LanguageModel
  ;(globalThis as any).LanguageModel = {
    create: async () => ({
      prompt: async () => 'Earlier the user searched Google. Then requested YouTube React tutorial search.',
      destroy: () => {}
    })
  }

  try {
    const summary = await summarizeConversation(messages, task)
    assert.ok(summary.includes('[ACTIVE TASK IN PROGRESS]'), 'Summary must contain active task banner')
    assert.ok(summary.includes('Completed Actions: openTab'), 'Completed actions must be preserved')
    assert.ok(summary.includes('Pending Actions: findElements, summarizeTitles'), 'Pending actions must be preserved')
  } finally {
    ;(globalThis as any).LanguageModel = originalScope
  }
})

test('Audio Lifecycle: Hardware busy state and lock release work deterministically', () => {
  // Test initial lock release state
  releaseMicHardwareLock()
  assert.equal(isMicHardwareBusy(), false, 'Hardware should not be busy initially')
})
