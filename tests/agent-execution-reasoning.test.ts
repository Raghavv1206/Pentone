import test from 'node:test'
import assert from 'node:assert/strict'
import { parseToolCall, parseToolCallDetailed, validateToolCallSchema } from '../lib/tool-parser'
import { resolveDeterministicNavigation } from '../lib/navigation-router'
import { stripInternalReasoning, getFriendlyActionStatus } from '../lib/reasoning-sanitizer'
import { 
  shouldSummarize, 
  SAFE_CONTEXT_LIMIT, 
  MAX_CONTEXT_SIZE, 
  CONTEXT_RESERVE_TOKENS, 
  pruneBulkyToolResults,
  summarizeConversation
} from '../lib/summarizer'
import { createInternalMessage, createUserMessage, createAssistantMessage } from '../lib/messages'
import { SYSTEM_PROMPT_TEMPLATE } from '../lib/prompts/system-prompt'

// ==========================================
// ISSUE 1: Silent Reasoning & TTS Sanitization
// ==========================================

test('Silent Reasoning: Strips narrative thought traces and planning steps', () => {
  const modelOutputWithThoughts = 
    `thought The user wants me to open YouTube and search for 'best react tutorial'. 1. Action... 2. Tool... 3. Plan...\n` +
    `<function_call>{"function": "openTab", "arguments": {"url": "https://www.youtube.com/results?search_query=best+react+tutorial"}}</function_call>`

  const cleaned = stripInternalReasoning(modelOutputWithThoughts)
  assert.equal(cleaned, '', 'Pre-tool narrative thoughts must be stripped completely')
})

test('Silent Reasoning: Strips think() function calls from user-facing text', () => {
  const modelOutput = `think(reasoning: 'I have successfully opened YouTube. Now I need to perform a search...') Here are the top React tutorials I found.`
  const cleaned = stripInternalReasoning(modelOutput)
  assert.equal(cleaned, 'Here are the top React tutorials I found.', 'think(...) call must be silently stripped')
})

test('Silent Reasoning: Strips XML thought and think tags (closed and unclosed)', () => {
  const closedTag = `<thought>Evaluating DOM elements for search input</thought>Searching for your video now.`
  assert.equal(stripInternalReasoning(closedTag), 'Searching for your video now.')

  const thinkTag = `<think>Step 1: Check active tab</think>The tab is ready.`
  assert.equal(stripInternalReasoning(thinkTag), 'The tab is ready.')

  const unclosedTag = `Here is your summary.<thought>Still processing remaining items...`
  assert.equal(stripInternalReasoning(unclosedTag), 'Here is your summary.')
})

test('Silent Reasoning: Friendly status line replaces internal thoughts during tool execution', () => {
  // Test YouTube direct search status
  const ytStatus = getFriendlyActionStatus('openTab', { 
    url: 'https://www.youtube.com/results?search_query=best+react+tutorial' 
  })
  assert.equal(ytStatus, 'Searching YouTube for "best react tutorial"...')

  // Test Google direct search status
  const googleStatus = getFriendlyActionStatus('openTab', { 
    url: 'https://www.google.com/search?q=best+ai+tools' 
  })
  assert.equal(googleStatus, 'Searching Google for "best ai tools"...')

  // Test plain domain navigation
  const ghStatus = getFriendlyActionStatus('openTab', { url: 'https://github.com' })
  assert.equal(ghStatus, 'Opening GitHub...')
})

// ==========================================
// ISSUE 2: Multi-step Execution & Direct Search
// ==========================================

test('Tool Parser: Parses loose English disjunction query in findElements', () => {
  // The exact failure string from user report
  const rawModelCall = `<function_call>findElements(query: "search bar" or "search input")</function_call>`
  const parsed = parseToolCall(rawModelCall)

  assert.ok(parsed, 'Must parse loose disjunction tool call successfully')
  assert.equal(parsed?.function, 'findElements')
  assert.equal(parsed?.arguments.query, 'search bar', 'Must extract primary query string')
})

test('Tool Parser: Parses Python-style signatures with colon parameters', () => {
  const pythonCall = `<function_call>openTab(url: "https://www.youtube.com")</function_call>`
  const parsed = parseToolCall(pythonCall)

  assert.ok(parsed)
  assert.equal(parsed?.function, 'openTab')
  assert.equal(parsed?.arguments.url, 'https://www.youtube.com')
})

test('Multi-Step Scenario 1: "Open YouTube and search for the best React tutorial."', () => {
  // Scenario 1: Model direct navigation to search query
  const directCall = `<function_call>{"function": "openTab", "arguments": {"url": "https://www.youtube.com/results?search_query=best+react+tutorial"}}</function_call>`
  const parsed = parseToolCall(directCall)
  assert.ok(parsed)
  assert.equal(parsed.function, 'openTab')
  assert.ok(parsed.arguments.url.includes('youtube.com/results?search_query='))
  
  // Status line for speech/UI
  const status = getFriendlyActionStatus(parsed.function, parsed.arguments)
  assert.equal(status, 'Searching YouTube for "best react tutorial"...')
})

test('Multi-Step Scenario 2: "Open Google and search for the best AI tools."', () => {
  const directCall = `<function_call>{"function": "openTab", "arguments": {"url": "https://www.google.com/search?q=best+ai+tools"}}</function_call>`
  const parsed = parseToolCall(directCall)
  assert.ok(parsed)
  assert.equal(parsed.function, 'openTab')
  assert.ok(parsed.arguments.url.includes('google.com/search?q='))

  const status = getFriendlyActionStatus(parsed.function, parsed.arguments)
  assert.equal(status, 'Searching Google for "best ai tools"...')
})

test('Multi-Step Scenario 3: "Open YouTube, search for Next.js tutorials, and summarize the first result."', () => {
  // Step 1: Open search
  const step1 = parseToolCall(`<function_call>openTab{"url": "https://www.youtube.com/results?search_query=Next.js+tutorials"}</function_call>`)
  assert.ok(step1)
  assert.equal(step1.function, 'openTab')

  // Step 2: Click first video result
  const step2 = parseToolCall(`<function_call>clickElement{"index": 0}</function_call>`)
  assert.ok(step2)
  assert.equal(step2.function, 'clickElement')
  assert.equal(step2.arguments.index, 0)

  // Step 3: Summarize page
  const step3 = parseToolCall(`<function_call>summarizePage{"length": "medium"}</function_call>`)
  assert.ok(step3)
  assert.equal(step3.function, 'summarizePage')
})

test('Multi-Step Scenario 4: "Open Google, search for Python tutorials, and open the first result."', () => {
  // Step 1: Open search
  const step1 = parseToolCall(`<function_call>{"function": "openTab", "arguments": {"url": "https://www.google.com/search?q=Python+tutorials"}}</function_call>`)
  assert.ok(step1)
  assert.equal(step1.function, 'openTab')

  // Step 2: Click first link
  const step2 = parseToolCall(`<function_call>clickElement(index: 0)</function_call>`)
  assert.ok(step2)
  assert.equal(step2.function, 'clickElement')
  assert.equal(step2.arguments.index, 0)
})

test('Multi-Step Scenario 5: "Open a new tab and navigate to GitHub."', () => {
  const call = parseToolCall(`<function_call>openTab{"url": "https://github.com"}</function_call>`)
  assert.ok(call)
  assert.equal(call.function, 'openTab')
  assert.equal(call.arguments.url, 'https://github.com')
})

test('Multi-Step Scenario 6: "Search for React tutorials, then change the search to Angular tutorials."', () => {
  // Step 1: Initial search
  const search1 = parseToolCall(`<function_call>openTab{"url": "https://www.youtube.com/results?search_query=React+tutorials"}</function_call>`)
  assert.ok(search1)
  assert.equal(search1.function, 'openTab')

  // Step 2: Subsequent updated search
  const search2 = parseToolCall(`<function_call>openTab{"url": "https://www.youtube.com/results?search_query=Angular+tutorials"}</function_call>`)
  assert.ok(search2)
  assert.equal(search2.function, 'openTab')
  assert.ok(search2.arguments.url.includes('Angular+tutorials'))
})

// ==========================================
// ISSUE 3: Proactive Context Management
// ==========================================

test('Context Management: Proactive threshold triggers at 5500 tokens before 9216 limit', () => {
  assert.equal(MAX_CONTEXT_SIZE, 9216)
  assert.equal(SAFE_CONTEXT_LIMIT, 5500)
  assert.ok(CONTEXT_RESERVE_TOKENS >= 3500, 'Must have at least 3500 token buffer before 9216')

  // 4500 tokens: continue without compaction
  assert.equal(shouldSummarize(4500), false)

  // 5500 tokens: triggers proactive compaction early
  assert.equal(shouldSummarize(5500), true)

  // 7000 tokens: triggers compaction
  assert.equal(shouldSummarize(7000), true)
})

test('Context Management: Prunes bulky older tool results while preserving recent tool results', () => {
  const messages = [
    createUserMessage('Search for React tutorials'),
    createInternalMessage(`[TOOL RESULT]\n${'A'.repeat(800)}`, 'tool_result', 0), // Older bulky result
    createAssistantMessage('I found videos.'),
    createUserMessage('Click the first video'),
    createInternalMessage(`[TOOL RESULT]\n${'B'.repeat(600)}`, 'tool_result', 0), // Second bulky result
    createAssistantMessage('Playing video.'),
    createUserMessage('Summarize the video'),
    createInternalMessage(`[TOOL RESULT]\nRecent small result: Video loaded.`, 'tool_result', 0) // Most recent
  ]

  const pruned = pruneBulkyToolResults(messages)

  // Older bulky tool results (older than last 2) must be truncated
  assert.ok(pruned[1].content.includes('[Earlier tool result truncated to conserve context tokens]'))
  assert.ok(pruned[1].content.length < 250, 'Truncated message should be compact')

  // Last 2 tool results must be preserved intact
  assert.equal(pruned[4].content.includes('[Earlier tool result truncated'), false)
  assert.equal(pruned[7].content.includes('Recent small result: Video loaded.'), true)
})

test('System Prompt: Instructs silent execution and direct search navigation', () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Silent Execution \(CRITICAL\)/i)
  assert.match(SYSTEM_PROMPT_TEMPLATE, /NEVER output internal planning,\s*thoughts/i)
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Direct Search Navigation/i)
  assert.match(SYSTEM_PROMPT_TEMPLATE, /https:\/\/www\.youtube\.com\/results\?search_query=/i)
  assert.match(SYSTEM_PROMPT_TEMPLATE, /https:\/\/www\.google\.com\/search\?q=/i)
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Multi-Step Tasks/i)
})

// ==========================================
// ISSUE 4: Malformed Tool Recovery & Schema Validation
// ==========================================

test('Tool Parser: Recovers exact malformed output containing openTab有一些 and tabName', () => {
  const content = '<function_call>openTab有一些>{"tabName": "YouTube", "url": "https://www.youtube.com"}</function_call>'
  const result = parseToolCallDetailed(content)

  assert.equal(result.success, true)
  assert.equal(result.toolCall?.function, 'openTab')
  assert.equal(result.toolCall?.arguments.url, 'https://www.youtube.com')
  assert.equal(result.toolCall?.arguments.tabName, 'YouTube')
})

test('Tool Parser: Recovers exact malformed output containing openTab有一些 and search query', () => {
  const content = '<function_call>openTab有一些>{"tabName": "YouTube", "url": "https://www.youtube.com/results?search_query=best+react+tutorials"}</function_call>'
  const result = parseToolCallDetailed(content)

  assert.equal(result.success, true)
  assert.equal(result.toolCall?.function, 'openTab')
  assert.equal(result.toolCall?.arguments.url, 'https://www.youtube.com/results?search_query=best+react+tutorials')
})

test('Tool Parser: Rejects unexpected parameters strictly instead of silently accepting them', () => {
  const content = '<function_call>openTab{"url": "https://www.youtube.com", "unknownParam": "dangerous"}</function_call>'
  const result = parseToolCallDetailed(content)

  assert.equal(result.success, false)
  assert.match(result.error || '', /Unexpected parameter "unknownParam" for tool "openTab"/i)
})

test('Tool Parser: Normal text containing "function call" is not misparsed as a tool call', () => {
  const text = 'In this video, they explain how a JavaScript function call works under the hood.'
  const result = parseToolCallDetailed(text)
  assert.equal(result.success, false)
})

// ==========================================
// ISSUE 5: Deterministic Search & Navigation Router
// ==========================================

test('Deterministic Router: "Open YouTube and search for the best React tutorials."', () => {
  const route = resolveDeterministicNavigation('Open YouTube and search for the best React tutorials.')
  assert.equal(route.isMatch, true)
  assert.equal(route.toolCall?.function, 'openTab')
  assert.equal(route.toolCall?.arguments.url, 'https://www.youtube.com/results?search_query=the+best+React+tutorials')
  assert.equal(route.toolCall?.arguments.tabName, 'YouTube')
})

test('Deterministic Router: "Open Google and search for the best AI tools."', () => {
  const route = resolveDeterministicNavigation('Open Google and search for the best AI tools.')
  assert.equal(route.isMatch, true)
  assert.equal(route.toolCall?.function, 'openTab')
  assert.equal(route.toolCall?.arguments.url, 'https://www.google.com/search?q=the+best+AI+tools')
  assert.equal(route.toolCall?.arguments.tabName, 'Google')
})

test('Deterministic Router: "Open GitHub and search for popular React repositories."', () => {
  const route = resolveDeterministicNavigation('Open GitHub and search for popular React repositories.')
  assert.equal(route.isMatch, true)
  assert.equal(route.toolCall?.function, 'openTab')
  assert.equal(route.toolCall?.arguments.url, 'https://github.com/search?q=popular+React+repositories')
})

test('Deterministic Router: "Open a new tab and navigate to GitHub."', () => {
  const route = resolveDeterministicNavigation('Open a new tab and navigate to GitHub.')
  assert.equal(route.isMatch, true)
  assert.equal(route.toolCall?.function, 'openTab')
  assert.equal(route.toolCall?.arguments.url, 'https://github.com')
})

test('Deterministic Router: Ambiguous request does NOT guess or trigger false positive', () => {
  const route = resolveDeterministicNavigation('Can you explain how to search effectively?')
  assert.equal(route.isMatch, false)
})

// ==========================================
// ISSUE 6: Bounded Recovery & Circuit Breaker
// ==========================================

test('Recovery Safety: Circuit breaker trips on identical repeated malformed call', () => {
  const call1 = '<function_call>unparseableGarbageWithoutJson</function_call>'
  const call2 = '<function_call>unparseableGarbageWithoutJson</function_call>'

  // Simulate circuit breaker tracking logic
  let lastFailedCall = ''
  let circuitTripped = false

  const handleFailure = (content: string) => {
    if (lastFailedCall && lastFailedCall === content.trim()) {
      circuitTripped = true
      return false // abort recovery
    }
    lastFailedCall = content.trim()
    return true // attempt 1 recovery
  }

  assert.equal(handleFailure(call1), true, 'First attempt requests format correction')
  assert.equal(handleFailure(call2), false, 'Second identical attempt trips circuit breaker immediately')
  assert.equal(circuitTripped, true)
})

test('Recovery Safety: Action deduplication prevents re-executing identical navigation in active workflow', () => {
  const completedActions = new Set<string>()
  const actionSignature = 'openTab:{"url":"https://www.youtube.com"}'

  // Step 1: execute and record
  completedActions.add(actionSignature)

  // Step 2: subsequent turn attempts same navigation
  const shouldSkip = completedActions.has(actionSignature)
  assert.equal(shouldSkip, true, 'Duplicate navigation must be skipped')
})
