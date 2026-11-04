import { TOOL_REGISTRY } from '../lib/tool-registry'
import { validateToolCallSchema } from '../lib/tool-parser'
import { classifyTool, evaluateHighImpact } from '../lib/audio/tool-authorization-classifier'
import { test } from 'node:test'
import assert from 'node:assert'

test('All 26 Browser Tools: Registration, Classification & Parameter Contracts', () => {
  const tools = TOOL_REGISTRY
  assert.ok(tools.length >= 26, `Must have at least 26 registered tools (got ${tools.length})`)

  const testParams: Record<string, any> = {
    think: { reasoning: 'Valid reasoning string' },
    getPageTitle: {},
    captureScreenshot: {},
    getAccessibilitySnapshot: {},
    findElements: { query: 'submit button' },
    listen: { seconds: 2 },
    captureAudio: { duration: 2 },
    writeContent: { task: 'Draft response' },
    summarizePage: {},
    getMemories: {},
    translateText: { text: 'Hello world', sourceLanguage: 'en', targetLanguage: 'es' },
    detectLanguage: { text: 'Hello world' },
    captureCurrentPage: {},
    searchVault: { query: 'research notes' },
    getVaultStats: {},
    getPlaybook: { id: 'fill-form' },
    getTabs: {},
    openTab: { url: 'https://example.com' },
    closeTab: { index: 0 },
    clickElement: { index: 1 },
    fillInput: { index: 1, value: 'test value' },
    scrollUp: {},
    scrollDown: {},
    pressKey: { key: 'Enter' },
    highlightSelector: { selector: 'button' },
    highlightText: { text: 'search' },
    storeMemory: { content: 'User prefers Python for programming' },
    switchTab: { index: 0 }
  }

  for (const tool of tools) {
    // 1. Classification check
    const classification = classifyTool(tool.name)
    assert.ok(classification, `Tool '${tool.name}' must have a valid classification`)
    assert.ok(['READ_ONLY', 'MUTATING'].includes(classification.actionType))

    // 2. Schema validation check
    const params = testParams[tool.name] || {}
    const validation = validateToolCallSchema(tool.name, params)
    assert.ok(validation.valid, `Schema validation for tool '${tool.name}' with params ${JSON.stringify(params)} failed: ${validation.error}`)

    // 3. High impact check function exists
    const impact = evaluateHighImpact(tool.name, params)
    assert.ok(typeof impact.isHighImpact === 'boolean')
  }
})
