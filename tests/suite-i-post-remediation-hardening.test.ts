import { test } from 'node:test'
import assert from 'node:assert/strict'

import { PTTStateMachine, isEditableElement } from '../lib/audio/ptt-state-machine'
import { TOOL_REGISTRY, isValidTool, getToolSpec } from '../lib/tool-registry'
import { getSystemPrompt } from '../lib/prompts/system-prompt'
import { generateToolDocumentation } from '../lib/tool-docs'
import { classifyTool, evaluateHighImpact } from '../lib/audio/tool-authorization-classifier'
import { extractYouTubeVideoId, verifyNavigationState } from '../lib/tools/clickElement'
import { extractViewCountFromText, selectHighestViewVideo } from '../lib/view-count-normalizer'

// Global mock for chrome API
if (typeof (global as any).chrome === 'undefined') {
  ;(global as any).chrome = {}
}
;(global as any).chrome.tabs = {
  query: async () => [{ id: 1, title: 'Test Tab', url: 'https://example.com', active: true }],
  get: async (id: number) => ({ id, title: `Tab ${id}`, url: 'https://example.com' }),
  remove: async () => {}
}
;(global as any).chrome.scripting = {
  executeScript: async () => [{ result: [] }]
}

test('1. System Prompt Tool Documentation Completeness & Context Budget', async () => {
  // Test generating system prompt with TOOL_REGISTRY
  const prompt = await getSystemPrompt(TOOL_REGISTRY)

  assert.ok(prompt.length > 500, 'System prompt must not be empty')
  assert.ok(!prompt.includes('{{TOOLS}}'), 'System prompt must not leave {{TOOLS}} placeholder unresolved')

  // Verify all 27 tools from TOOL_REGISTRY are present in the rendered prompt
  for (const tool of TOOL_REGISTRY) {
    const signature = `- ${tool.name}(`
    assert.ok(
      prompt.includes(signature),
      `Rendered system prompt must contain documentation for tool '${tool.name}'`
    )

    // Verify required parameters appear in the signature
    for (const param of tool.parameters || []) {
      if (param.required) {
        // e.g., "query: string" or "index: number"
        const paramPattern = new RegExp(`- ${tool.name}\\([^)]*\\b${param.name}:`)
        assert.ok(
          paramPattern.test(prompt),
          `Tool '${tool.name}' must document required parameter '${param.name}' in prompt`
        )
      }
    }
  }

  // Token budget test: prompt character length should remain well within model context window (~1500 tokens / 6000 chars)
  assert.ok(prompt.length < 10000, `Assembled system prompt length (${prompt.length} chars) must fit context budget`)
})

test('2. 100% Parity: Tool Registry vs Security Classification Matrix', () => {
  assert.equal(TOOL_REGISTRY.length, 27, 'Must have exactly 27 registered tools')

  for (const tool of TOOL_REGISTRY) {
    const classification = classifyTool(tool.name)
    assert.ok(
      classification !== null,
      `Tool '${tool.name}' must be explicitly classified in TOOL_CLASSIFICATIONS (cannot fail closed)`
    )
    assert.equal(
      classification?.name,
      tool.name,
      `Classification name must match registry name for '${tool.name}'`
    )
    assert.ok(
      classification?.actionType === 'READ_ONLY' || classification?.actionType === 'MUTATING',
      `Tool '${tool.name}' must have valid actionType`
    )
  }
})

test('3. closeTab Guard: Rejects Ambiguous Target Without closeActive Flag', async () => {
  const closeTabModule = await import('../lib/tools/closeTab')
  const closeTabHandler = closeTabModule.default

  // Mock chrome.tabs
  let removedTabId: number | null = null
  ;(global as any).chrome.tabs = {
    query: async (queryInfo: any) => [{ id: 101, title: 'Active Tab', active: true }],
    get: async (tabId: number) => ({ id: tabId, title: `Tab ${tabId}` }),
    remove: async (tabId: number) => { removedTabId = tabId }
  }

  // Case A: Calling closeTab without index, id, or closeActive MUST FAIL to prevent silent closure
  const ambiguousResult = await closeTabHandler({})
  assert.equal(ambiguousResult.success, false)
  assert.ok(
    ambiguousResult.error?.includes('Ambiguous target tab'),
    'Must reject ambiguous closeTab call'
  )
  assert.equal(removedTabId, null, 'Active tab must NOT have been removed')

  // Case B: Explicit closeActive: true allows closing active tab
  const explicitResult = await closeTabHandler({ closeActive: true })
  assert.equal(explicitResult.success, true)
  assert.equal(removedTabId, 101, 'Active tab 101 should be removed when closeActive is true')

  // Case C: High impact evaluation requires confirmation for ambiguous/active closures
  const impact = evaluateHighImpact('closeTab', { closeActive: true })
  assert.equal(impact.isHighImpact, true)
})

test('4. captureAudio: Explicit Separation from Microphone & User Gesture Enforcement', () => {
  const spec = getToolSpec('captureAudio')
  assert.ok(spec, 'captureAudio spec must exist')
  assert.equal(spec?.requiresUserGesture, true, 'captureAudio must require user gesture')
  assert.ok(
    spec?.description.includes('NOT microphone input'),
    'captureAudio description must distinguish tab audio from mic capture'
  )
})

test('5. YouTube Video ID Navigation Verification', async () => {
  // Test YouTube video ID extraction helper
  const targetUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  const targetId = extractYouTubeVideoId(targetUrl)
  assert.equal(targetId, 'dQw4w9WgXcQ')

  // Mock chrome tabs and scripting
  let currentMockUrl = 'https://www.youtube.com/results?search_query=rickroll'
  ;(global as any).chrome.tabs = {
    query: async () => [{ id: 42, url: currentMockUrl, active: true }]
  }
  ;(global as any).chrome.scripting = {
    executeScript: async () => [{ result: currentMockUrl }]
  }

  // Test 1: Navigation to a DIFFERENT video ID must NOT count as verified
  const wrongVideoPromise = verifyNavigationState(
    42,
    currentMockUrl,
    targetUrl,
    300,
    50
  )
  // Simulate navigation to WRONG video
  setTimeout(() => {
    currentMockUrl = 'https://www.youtube.com/watch?v=OTHER_VIDEO_99'
  }, 100)

  const wrongOutcome = await wrongVideoPromise
  assert.equal(wrongOutcome.verified, false, 'Must NOT verify navigation if video ID does not match target')

  // Test 2: Navigation to the EXACT video ID verifies successfully
  currentMockUrl = 'https://www.youtube.com/results?search_query=rickroll'
  const correctVideoPromise = verifyNavigationState(
    42,
    currentMockUrl,
    targetUrl,
    500,
    50
  )
  setTimeout(() => {
    currentMockUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  }, 100)

  const correctOutcome = await correctVideoPromise
  assert.equal(correctOutcome.verified, true, 'Must verify navigation when exact video ID matches')
  assert.equal(correctOutcome.finalUrl, targetUrl)
})

test('6. PTT State Machine Lifecycle Edge Cases', async () => {
  let startCount = 0
  let stopCount = 0
  let cancelCount = 0

  const sm = new PTTStateMachine({
    holdThresholdMs: 50, // Short threshold for fast testing
    maxRecordingMs: 500,
    processingTimeoutMs: 1000,
    onStartRecording: async () => {
      startCount++
    },
    onStopRecording: async () => {
      stopCount++
    },
    onCancel: () => {
      cancelCount++
    }
  })

  // Test unmount / destroy during PRESS_PENDING
  sm.handleKeyDown({ code: 'Space', repeat: false })
  assert.equal(sm.getPhase(), 'PRESS_PENDING')
  sm.destroy()
  assert.equal(cancelCount, 1, 'Destroying during PRESS_PENDING must trigger cancel')

  // Re-instantiate for rapid re-triggering test
  const sm2 = new PTTStateMachine({
    holdThresholdMs: 50,
    maxRecordingMs: 500,
    processingTimeoutMs: 1000,
    onStartRecording: async () => { startCount++ },
    onStopRecording: async () => { stopCount++ },
    onCancel: () => { cancelCount++ }
  })

  // Start hold
  sm2.handleKeyDown({ code: 'Space', repeat: false })
  await new Promise(r => setTimeout(r, 80))
  assert.equal(sm2.getPhase(), 'RECORDING')

  // Keyup finishes recording
  sm2.handleKeyUp({ code: 'Space' })
  await sm2.waitForIdle()
  assert.equal(sm2.getPhase(), 'IDLE')
  assert.equal(stopCount, 1, 'Finalization must occur exactly once')

  // New turn can immediately begin
  sm2.handleKeyDown({ code: 'Space', repeat: false })
  assert.equal(sm2.getPhase(), 'PRESS_PENDING')
  sm2.cancel()
  assert.equal(sm2.getPhase(), 'CANCELLED')
  await new Promise(r => setTimeout(r, 450))
  assert.equal(sm2.getPhase(), 'IDLE')
})
