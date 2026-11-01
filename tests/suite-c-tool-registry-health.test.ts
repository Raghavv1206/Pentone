import test from 'node:test'
import assert from 'node:assert/strict'
import { TOOL_REGISTRY, getToolSpec, isValidTool, requiresUserGesture } from '../lib/tool-registry'
import { validateToolCallSchema } from '../lib/tool-parser'

// Mock chrome APIs for testing handlers
if (typeof globalThis.chrome === 'undefined') {
  (globalThis as any).chrome = {
    tabs: {
      query: async () => [{ id: 101, url: 'https://www.youtube.com', title: 'YouTube' }],
      get: async (id: number) => ({ id, url: 'https://www.youtube.com', title: 'YouTube' }),
      update: async (id: number, opts: any) => ({ id, ...opts }),
      remove: async (id: number) => {},
      captureVisibleTab: async () => 'data:image/png;base64,mock'
    },
    scripting: {
      executeScript: async () => [{ result: { success: true, message: 'Mock execution' } }]
    },
    tabCapture: {
      getMediaStreamId: (opts: any, cb: (id: string) => void) => cb('mock-stream-id')
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {}
      }
    },
    runtime: {
      lastError: null,
      sendMessage: (msg: any, cb?: any) => { if (cb) cb({ success: true }) }
    }
  }
}

test('Suite C: Tool Registry & Execution Health Matrix', async (t) => {

  const EXPECTED_TOOLS = [
    'think',
    'captureScreenshot',
    'getPageTitle',
    'openTab',
    'closeTab',
    'getAccessibilitySnapshot',
    'findElements',
    'clickElement',
    'fillInput',
    'listen',
    'captureAudio',
    'writeContent',
    'summarizePage',
    'storeMemory',
    'translateText',
    'detectLanguage',
    'scrollUp',
    'scrollDown',
    'pressKey',
    'highlightSelector',
    'highlightText',
    'captureCurrentPage',
    'searchVault',
    'getVaultStats',
    'getPlaybook',
    'getTabs',
    'switchTab'
  ]

  await t.test('1. Tool Registry Inventory Completeness', () => {
    assert.equal(TOOL_REGISTRY.length, EXPECTED_TOOLS.length)
    for (const toolName of EXPECTED_TOOLS) {
      assert.ok(isValidTool(toolName), `Tool "${toolName}" must be registered in TOOL_REGISTRY`)
      const spec = getToolSpec(toolName)
      assert.ok(spec, `Spec must exist for "${toolName}"`)
      assert.ok(spec.description && spec.description.length > 5, `Description for "${toolName}" must be descriptive`)
      assert.ok(Array.isArray(spec.parameters), `Parameters for "${toolName}" must be an array`)
    }
  })

  await t.test('2. Schema validation rejects missing required arguments across tools', () => {
    // openTab requires url
    const openRes = validateToolCallSchema('openTab', {})
    assert.equal(openRes.valid, false)
    assert.ok(openRes.error?.includes('url'))

    // clickElement requires index
    const clickRes = validateToolCallSchema('clickElement', {})
    assert.equal(clickRes.valid, false)
    assert.ok(clickRes.error?.includes('index'))

    // findElements requires query
    const findRes = validateToolCallSchema('findElements', {})
    assert.equal(findRes.valid, false)
    assert.ok(findRes.error?.includes('query'))

    // fillInput requires index and value
    const fillRes = validateToolCallSchema('fillInput', { index: 1 })
    assert.equal(fillRes.valid, false)
    assert.ok(fillRes.error?.includes('value'))

    // translateText requires text, sourceLanguage, targetLanguage
    const transRes = validateToolCallSchema('translateText', { text: 'hello' })
    assert.equal(transRes.valid, false)

    // detectLanguage requires text
    const detectRes = validateToolCallSchema('detectLanguage', {})
    assert.equal(detectRes.valid, false)

    // writeContent requires task
    const writeRes = validateToolCallSchema('writeContent', {})
    assert.equal(writeRes.valid, false)
  })

  await t.test('3. Schema validation accepts valid arguments and enforces types', () => {
    const validClick = validateToolCallSchema('clickElement', { index: 5 })
    assert.equal(validClick.valid, true)
    assert.equal(validClick.toolCall?.arguments.index, 5)

    const validFind = validateToolCallSchema('findElements', { query: 'video results' })
    assert.equal(validFind.valid, true)
    assert.equal(validFind.toolCall?.arguments.query, 'video results')

    const validClose = validateToolCallSchema('closeTab', { index: 2 })
    assert.equal(validClose.valid, true)

    const validAudio = validateToolCallSchema('captureAudio', { duration: 10 })
    assert.equal(validAudio.valid, true)
    assert.equal(validAudio.toolCall?.arguments.duration, 10)
  })

  await t.test('4. UI context requirements (requiresUserGesture) are appropriately assigned', () => {
    assert.equal(requiresUserGesture('writeContent'), true)
    assert.equal(requiresUserGesture('translateText'), true)
    assert.equal(requiresUserGesture('detectLanguage'), true)
    assert.equal(requiresUserGesture('summarizePage'), true)
    assert.equal(requiresUserGesture('openTab'), false)
    assert.equal(requiresUserGesture('findElements'), false)
    assert.equal(requiresUserGesture('clickElement'), false)
  })
})
