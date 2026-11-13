import { describe, test, expect, vi } from 'vitest'
import { chromeMock, data, seed, setTabs, inject } from './setup'
vi.mock('../lib/embeddings', () => ({ generateEmbedding: vi.fn(async () => [1, 0, 0]), cosineSimilarity: (a: number[], b: number[]) => a.reduce((n, v, i) => n + v * b[i], 0) }))
vi.mock('../lib/ai', () => ({ ensureSession: vi.fn(async () => { throw new Error('Model unavailable') }) }))
vi.mock('../lib/use-page-context', () => ({ getPageContext: vi.fn(async () => '') }))
import { TOOL_REGISTRY } from '../lib/tool-registry'
import { executeUITool } from '../lib/ui-tools'
import fillInput from '../lib/tools/fillInput'
import closeTab from '../lib/tools/closeTab'
import openTab, { isSameWebsite, getDomain } from '../lib/tools/openTab'
import switchTab from '../lib/tools/switchTab'
import selectOption from '../lib/tools/selectOption'
import pressKey from '../lib/tools/pressKey'
import findElements from '../lib/tools/findElements'
import getAccessibilitySnapshot from '../lib/tools/getAccessibilitySnapshot'
import storeMemory from '../lib/tools/storeMemory'
import clipToVault from '../lib/tools/clipToVault'
import autofillForm from '../lib/tools/autofillForm'
import { inspectPageForms } from '../lib/autofill/form-inspector'
import { executeFillInstructions } from '../lib/autofill/form-filler'
import { createEmptyProfile } from '../lib/autofill/profile-vault'
import { inspectSecurityRisk, showPhishingWarningModal } from '../lib/security/phishing-guard'
import { mutateMemories } from '../lib/memory-store'

const modules = import.meta.glob('../lib/tools/*.ts')
describe('all registered tools', () => {
  test('all tools have unique names, descriptions and modules', () => {
    expect(TOOL_REGISTRY.length).toBeGreaterThan(100)
    expect(new Set(TOOL_REGISTRY.map(t => t.name)).size).toBe(TOOL_REGISTRY.length)
    for (const tool of TOOL_REGISTRY) {
      expect(tool.description).toBeTruthy()
      expect(modules[`../lib/tools/${tool.name}.ts`]).toBeDefined()
    }
  })
  for (const spec of TOOL_REGISTRY) test(`${spec.name}: unavailable-page/API contract`, async () => {
    setTabs([])
    const mod: any = await modules[`../lib/tools/${spec.name}.ts`]()
    expect(mod.spec.name).toBe(spec.name)
    const args = Object.fromEntries(spec.parameters.filter(p => p.required).map(p => [p.name, p.type === 'number' ? 1 : 'test']))
    let result: any
    if (spec.requiresUserGesture) result = await executeUITool({ function: spec.name, arguments: args })
    else if (spec.name === 'listen') result = await new Promise(resolve => mod.default({ body: args }, { send: resolve }))
    else result = await mod.default(args)
    expect(result).toBeTruthy()
    if (result.success) expect(result.result).toBeDefined()
    else expect(typeof result.error).toBe('string')
  })
})

describe('DOM targeting and repeated operations', () => {
  test('query takes priority over focused field; missing targets leave inputs intact', async () => {
    document.body.innerHTML = '<input id="name" value="Original"><input id="email" type="email">'
    document.getElementById('name')!.focus()
    expect((await fillInput({ query: 'email', value: 'a@example.com' })).success).toBe(true)
    expect((document.getElementById('name') as HTMLInputElement).value).toBe('Original')
    expect((document.getElementById('email') as HTMLInputElement).value).toBe('a@example.com')
    expect((await fillInput({ query: 'missing', value: 'bad' })).success).toBe(false)
    expect((await fillInput({ index: 999, value: 'bad' })).success).toBe(false)
  })
  test('contenteditable, readonly, native setters, and missing injection results', async () => {
    document.body.innerHTML = '<div id="editor" contenteditable="true"></div><input id="readonly" readonly>'
    expect((await fillInput({ selector: '#editor', value: '<b>literal</b>' })).success).toBe(true)
    expect(document.getElementById('editor')!.textContent).toBe('<b>literal</b>')
    expect(document.querySelector('#editor b')).toBeNull()
    expect((await fillInput({ selector: '#readonly', value: 'bad' })).success).toBe(false)
    chromeMock.scripting.executeScript.mockResolvedValueOnce([])
    expect((await fillInput({ selector: '#editor', value: 'bad' })).success).toBe(false)
  })
  test('100 snapshot/reorder cycles have no stale element indices', async () => {
    document.body.innerHTML = '<button id="a">Alpha</button><button id="b">Beta</button>'
    for (let i = 0; i < 100; i++) {
      await (i % 2 ? findElements({ query: 'button' }) : getAccessibilitySnapshot({}))
      for (const el of Array.from(document.querySelectorAll('button'))) expect(Array.from(el.attributes).filter(a => /^data-pentone-\d+$/.test(a.name))).toHaveLength(1)
      document.body.prepend(document.body.lastElementChild!)
    }
  })
  test('select respects requested target and dispatches one keyboard event to focused input', async () => {
    document.body.innerHTML = '<select><option>A</option><option>B</option></select><input id="target">'
    expect((await selectOption({ selector: '#missing', query: 'B' })).success).toBe(false)
    expect((await selectOption({ query: 'B' })).success).toBe(true)
    const pressed = vi.fn(); window.addEventListener('keydown', pressed)
    document.getElementById('target')!.focus()
    const pressedResult = await pressKey({ key: 'Enter' })
    expect(pressedResult.success, pressedResult.error).toBe(true)
    expect(pressed).toHaveBeenCalledTimes(1)
    expect(pressed.mock.calls[0][0].target.id).toBe('target')
    window.removeEventListener('keydown', pressed)
  })
  test('inspector and filler agree across shadow roots and duplicate field names', async () => {
    document.body.innerHTML = '<form action="https://collector.example.net"><input name="email" type="email"></form><div id="host"></div>'
    document.getElementById('host')!.attachShadow({ mode: 'open' }).innerHTML = '<input name="email" type="email">'
    const [{ result }] = await inject({ func: inspectPageForms })
    expect(result.formActions).toEqual(['https://collector.example.net/'])
    expect(result.fields).toHaveLength(2)
    expect(new Set(result.fields.map((f: any) => f.selector)).size).toBe(2)
    const instructions = result.fields.map((f: any, i: number) => ({ fieldIndex: f.index, selector: f.selector, label: f.label, valueToFill: `test${i}@example.com`, confidence: 1, isAISynthesized: false }))
    const filled = (await inject({ func: executeFillInstructions, args: [instructions] }))[0].result
    expect(filled.filledCount).toBe(2)
    expect((document.getElementById('host')!.shadowRoot!.querySelector('input') as HTMLInputElement).value).toBe('test1@example.com')
  })
  test('autofill preview is read-only; personal section uses alias and fills matching fields', async () => {
    document.body.innerHTML = '<form><input id="email" type="email"><input name="company"></form>'
    const profile = createEmptyProfile(); profile.personal.email = 'test@example.com'
    seed({ pentone_autofill_profile: profile })
    const preview = await autofillForm({ mode: 'preview', section: 'personal' })
    expect(preview.success).toBe(true); expect((document.getElementById('email') as HTMLInputElement).value).toBe('')
    const fill = await autofillForm({ mode: 'instant', section: 'personal', useAlias: true })
    expect(fill.success).toBe(true)
    expect((document.getElementById('email') as HTMLInputElement).value).toContain('test+')
  })
})

describe('tab safety and memory stress', () => {
  test.each([{ query: 'missing' }, { query: '' }, { id: 'bad' }, { index: 0.5 }])('unmatched target %j never closes active tab', async args => {
    expect((await closeTab(args)).success).toBe(false); expect(chromeMock.tabs.remove).not.toHaveBeenCalled()
  })
  test.each(['javascript:alert(1)', 'data:text/html,test', 'file:///C:/secret', 'chrome://quit', 'about:config', 'https://user:pass@example.com', 'https://'])('rejects URL %s', async url => {
    expect((await openTab({ url })).success).toBe(false); expect(chromeMock.tabs.create).not.toHaveBeenCalled()
  })
  test('openTab reuses active tab when navigating to the same website and opens new tab for different website', async () => {
    setTabs([{ id: 10, windowId: 1, index: 0, active: true, title: 'YouTube Video', url: 'https://www.youtube.com/watch?v=123' }])
    const sameSiteResult = await openTab({ url: 'https://www.youtube.com' })
    expect(sameSiteResult.success).toBe(true)
    expect(sameSiteResult.result).toContain('Navigated current tab')
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(10, { url: 'https://www.youtube.com/' })

    // Different website opens a new tab
    const diffSiteResult = await openTab({ url: 'https://github.com' })
    expect(diffSiteResult.success).toBe(true)
    expect(diffSiteResult.result).toContain('Opened https://github.com/ in new tab')
    expect(chromeMock.tabs.create).toHaveBeenCalledWith({ url: 'https://github.com/', active: true })
  })
  test('switchTab supports previous, next, and directional tab switching', async () => {
    setTabs([
      { id: 1, windowId: 1, index: 0, active: false, title: 'First Tab', url: 'https://example.com' },
      { id: 2, windowId: 1, index: 1, active: true, title: 'Second Tab', url: 'https://youtube.com' },
      { id: 3, windowId: 1, index: 2, active: false, title: 'Third Tab', url: 'https://github.com' }
    ])
    // Switch to previous tab
    const prevResult = await switchTab({ action: 'previous' })
    expect(prevResult.success).toBe(true)
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(1, { active: true })

    // Reset tabs with Tab 2 active for next tab test
    setTabs([
      { id: 1, windowId: 1, index: 0, active: false, title: 'First Tab', url: 'https://example.com' },
      { id: 2, windowId: 1, index: 1, active: true, title: 'Second Tab', url: 'https://youtube.com' },
      { id: 3, windowId: 1, index: 2, active: false, title: 'Third Tab', url: 'https://github.com' }
    ])
    const nextResult = await switchTab({ action: 'next' })
    expect(nextResult.success).toBe(true)
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(3, { active: true })
  })
  test('200 concurrent saves preserve every memory and unique ID', async () => {
    const results = await Promise.all(Array.from({ length: 200 }, (_, i) => storeMemory({ content: `Memory ${i}`, tags: ['stress'] })))
    expect(results.every(result => result.success)).toBe(true)
    expect(data.agent_memories).toHaveLength(200)
    expect(new Set(data.agent_memories.map((m: any) => m.id)).size).toBe(200)
    await Promise.all(data.agent_memories.slice(0, 50).map((m: any) => mutateMemories(all => all.filter(item => item.id !== m.id))))
    expect(data.agent_memories).toHaveLength(150)
  })
  test('clip really stores text and does not inject markup', async () => {
    const result = await clipToVault({ text: '<img src=x onerror=alert(1)> a sample clip' })
    expect(result.success).toBe(true); expect(data.agent_memories[0].content).toContain('a sample clip')
    const shadow = document.getElementById('pentone-clip-toast')!.shadowRoot!
    expect(shadow.querySelector('img')).toBeNull(); expect(shadow.textContent).toContain('<img')
  })
  test('failed clip storage is reported as failure', async () => {
    chromeMock.storage.local.set.mockRejectedValueOnce(new Error('quota'))
    const result = await clipToVault({ text: 'This clip must fail' })
    expect(result.success).toBe(false); expect(document.getElementById('pentone-clip-toast')).toBeNull()
  })
  test('phishing report handles foreign forms and renders indicators literally', async () => {
    expect(inspectSecurityRisk('https://example.com', ['https://notexample.com/submit']).details.mismatchedFormActions).toHaveLength(1)
    expect(inspectSecurityRisk('https://google.com/search?q=тест').isSafe).toBe(true)
    const report = inspectSecurityRisk('https://paypa1.com')
    report.reasons = ['<img src=x onerror=alert(1)>']
    const outcome = showPhishingWarningModal(report)
    const shadow = document.getElementById('pentone-phishing-guard-host')!.shadowRoot!
    expect(shadow.querySelector('img')).toBeNull()
    ;(shadow.getElementById('p-btn-abort') as HTMLElement).click()
    expect(await outcome).toBe(false)
  })
})


describe('no-op and malformed tool regressions', () => {
  test('JSON argument braces, escaped quotes and nested tool properties are preserved', async () => {
    const { parseToolCall } = await import('../lib/tools')
    for (const value of ['{', '}', '{unbalanced', 'say "hello" with \\ paths', '<b>literal</b>']) {
      const call = { function: 'fillInput', arguments: { value, extra: { tool: 'keep this key' } } }
      expect(parseToolCall(`<function_call>${JSON.stringify(call)}</function_call>`)).toEqual(call)
      expect(parseToolCall('```json\n' + JSON.stringify(call) + '\n```')).toEqual(call)
    }
    expect(parseToolCall('<function_call>{"function":"getTabs","arguments":{}</function_call>')).toEqual({ function: 'getTabs', arguments: {} })
    expect(parseToolCall('{"tool":"getTabs"}')).toEqual({ function: 'getTabs', arguments: {} })
    for (const source of ['null', '{"function":42}', '{"function":"getTabs","arguments":[]}', '{"function":"getTabs","arguments":null}']) expect(parseToolCall(source)).toBeNull()
  })
  test('unmatched radios, invalid checkboxes, custom widgets and invalid numbers are not filled', async () => {
    document.body.innerHTML = '<label>No<input id="radio" type="radio" value="no"></label><input id="check" type="checkbox"><div id="custom" role="combobox"></div><input id="num" type="number">'
    const instructions = ['radio', 'check', 'custom', 'num'].map((id, i) => ({ fieldIndex: i, selector: '#' + id, label: id, valueToFill: i === 0 ? 'Yes' : 'invalid', confidence: 1, isAISynthesized: false }))
    const filled = (await inject({ func: executeFillInstructions, args: [instructions] }))[0].result
    expect(filled.filledCount).toBe(0); expect(filled.failedCount).toBe(4)
    expect((document.querySelector('#radio') as HTMLInputElement).checked).toBe(false)
    instructions[0].valueToFill = 'No'
    expect((await inject({ func: executeFillInstructions, args: [[instructions[0]]] }))[0].result.filledCount).toBe(1)
  })
  test('autofill ignores disabled select options', async () => {
    document.body.innerHTML = '<select id="select"><option>A</option><optgroup disabled><option>B</option></optgroup></select>'
    const instruction = { fieldIndex: 0, selector: '#select', label: 'Choice', valueToFill: 'B', confidence: 1, isAISynthesized: false }
    expect((await inject({ func: executeFillInstructions, args: [[instruction]] }))[0].result.filledCount).toBe(0)
    expect((document.querySelector('#select') as HTMLSelectElement).value).toBe('A')
  })
  test('navigation API errors and missing highlight results propagate as failures', async () => {
    const { default: navigatePage } = await import('../lib/tools/navigatePage')
    const { default: highlightText } = await import('../lib/tools/highlightText')
    chromeMock.tabs.goBack.mockRejectedValueOnce(new Error('No previous history'))
    expect((await navigatePage({ action: 'back' })).success).toBe(false)
    expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled()
    chromeMock.scripting.executeScript.mockResolvedValueOnce([{ result: undefined }])
    expect((await highlightText({ text: 'test' })).success).toBe(false)
  })
  test('media controls await playback and fullscreen failures', async () => {
    const { default: controlMedia } = await import('../lib/tools/controlMedia')
    document.body.innerHTML = '<video></video><button class="ytp-ad-skip-button">Skip</button>'
    const media = document.querySelector('video')!
    expect((await controlMedia({ action: 'mute' })).success).toBe(true); expect(media.muted).toBe(true)
    expect((await controlMedia({ action: 'speed', rate: 1.5 })).success).toBe(true); expect(media.playbackRate).toBe(1.5)
    expect((await controlMedia({ action: 'skipAd' })).success).toBe(true)
    vi.mocked(media.play).mockRejectedValueOnce(new Error('Autoplay blocked'))
    expect((await controlMedia({ action: 'play' })).success).toBe(false)
    media.requestFullscreen = vi.fn().mockRejectedValueOnce(new Error('User gesture required'))
    expect((await controlMedia({ action: 'fullscreen' })).success).toBe(false)
  })
  test('controlMedia handles restricted pages by querying open candidate tabs or returning helpful error', async () => {
    const { default: controlMedia } = await import('../lib/tools/controlMedia')
    const { setTabs } = await import('./setup')
    // Active tab is chrome://extensions, another tab is YouTube
    setTabs([
      { id: 1, active: true, windowId: 1, url: 'chrome://extensions', title: 'Extensions' },
      { id: 2, active: false, windowId: 1, url: 'https://www.youtube.com/watch?v=123', title: 'YouTube' }
    ])
    document.body.innerHTML = '<video></video>'
    const res = await controlMedia({ action: 'play' })
    expect(res.success).toBe(true)
    expect(res.result).toContain('Media playback started')

    // If no media is found anywhere
    document.body.innerHTML = ''
    setTabs([{ id: 1, active: true, windowId: 1, url: 'chrome://extensions', title: 'Extensions' }])
    const noMediaRes = await controlMedia({ action: 'play' })
    expect(noMediaRes.success).toBe(false)
    expect(noMediaRes.error).toContain('No active video or audio')
  })
})
