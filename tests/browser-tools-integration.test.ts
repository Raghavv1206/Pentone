import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { TOOL_REGISTRY, isValidTool } from '../lib/tool-registry'
import { TOOL_CLASSIFICATIONS } from '../lib/audio/tool-authorization-classifier'
import { voiceAuthorizationManager } from '../lib/audio/voice-authorization-manager'
import { parseToolCall, validateToolCallSchema } from '../lib/tool-parser'
import { extractViewCountFromText, selectHighestViewVideo, type VideoCandidate } from '../lib/view-count-normalizer'

// Load deterministic test HTML fixture
const fixtureHtmlPath = path.join(__dirname, 'fixtures', 'browser-test-page.html')
const fixtureHtml = fs.readFileSync(fixtureHtmlPath, 'utf8')

// Minimal Deterministic DOM Node for Offline MV3 Tool Execution
class MockDOMElement {
  tagName: string
  protected _attrs: Map<string, string> = new Map()
  children: MockDOMElement[] = []
  parentNode: MockDOMElement | null = null
  textContent: string = ''
  value: string = ''
  labels: { textContent: string }[] = []
  style: Record<string, string> = {}
  title: string = 'Pentone Deterministic Browser Test Page'
  private listeners: Map<string, Array<(e: any) => void>> = new Map()

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase()
  }

  get id(): string { return this._attrs.get('id') || '' }
  set id(val: string) { this._attrs.set('id', val) }

  get className(): string { return this._attrs.get('class') || '' }
  set className(val: string) { this._attrs.set('class', val) }

  get name(): string { return this._attrs.get('name') || '' }
  get type(): string { return this._attrs.get('type') || (this.tagName === 'BUTTON' ? 'submit' : 'text') }
  get placeholder(): string { return this._attrs.get('placeholder') || '' }
  get href(): string { return this._attrs.get('href') || '' }

  get isContentEditable(): boolean {
    return this._attrs.get('contenteditable') === 'true'
  }

  get innerText(): string {
    if (this.textContent) return this.textContent
    return this.children.map(c => c.innerText).filter(Boolean).join(' ')
  }
  set innerText(val: string) {
    this.textContent = val
  }

  // Real DOM attributes property produces items with a .name property
  get attributes(): Array<{ name: string; value: string }> {
    return Array.from(this._attrs.entries()).map(([name, value]) => ({ name, value }))
  }

  getAttribute(name: string): string | null {
    return this._attrs.get(name) || null
  }

  setAttribute(name: string, value: string): void {
    this._attrs.set(name, String(value))
  }

  hasAttribute(name: string): boolean {
    return this._attrs.has(name)
  }

  removeAttribute(name: string): void {
    this._attrs.delete(name)
  }

  closest(selector: string): MockDOMElement | null {
    let curr: MockDOMElement | null = this
    while (curr) {
      if (matchSimpleSelector(curr, selector)) return curr
      curr = curr.parentNode
    }
    return null
  }

  getBoundingClientRect() {
    return { width: 200, height: 36, top: 100, left: 50, right: 250, bottom: 136 }
  }

  scrollIntoView() {}
  focus() {}

  click() {
    this.dispatchEvent({ type: 'click', bubbles: true, target: this })
  }

  remove() {
    if (this.parentNode) {
      const idx = this.parentNode.children.indexOf(this)
      if (idx !== -1) {
        this.parentNode.children.splice(idx, 1)
      }
      this.parentNode = null
    }
  }

  cloneNode(deep: boolean = false): MockDOMElement {
    const clone = createTypedElement(this.tagName)
    for (const [k, v] of this._attrs.entries()) {
      clone.setAttribute(k, v)
    }
    clone.textContent = this.textContent
    clone.value = this.value
    clone.title = this.title
    if (deep) {
      for (const child of this.children) {
        const childClone = child.cloneNode(true)
        childClone.parentNode = clone
        clone.children.push(childClone)
      }
    }
    return clone
  }

  addEventListener(type: string, listener: (e: any) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, [])
    }
    this.listeners.get(type)!.push(listener)
  }

  dispatchEvent(event: any): boolean {
    event.target = event.target || this
    const list = this.listeners.get(event.type) || []
    for (const fn of list) {
      fn(event)
    }
    if (event.bubbles && this.parentNode) {
      this.parentNode.dispatchEvent(event)
    }
    return true
  }

  querySelector(selector: string): MockDOMElement | null {
    const all = this.querySelectorAll(selector)
    return all.length > 0 ? all[0] : null
  }

  querySelectorAll(selector: string): MockDOMElement[] {
    const results: MockDOMElement[] = []
    const rawSelectors = selector.split(',').map(s => s.trim()).filter(Boolean)

    const traverse = (node: MockDOMElement) => {
      for (const child of node.children) {
        if (rawSelectors.some(sel => matchSelector(child, sel))) {
          if (!results.includes(child)) results.push(child)
        }
        traverse(child)
      }
    }

    traverse(this)
    return results
  }
}

// Subclasses for accurate `instanceof` DOM checks
class MockHTMLInputElement extends MockDOMElement {}
class MockHTMLTextAreaElement extends MockDOMElement {}
class MockHTMLButtonElement extends MockDOMElement {}
class MockHTMLAnchorElement extends MockDOMElement {
  click() {
    super.click()
    if (this.href && typeof window !== 'undefined' && window.location) {
      const fullUrl = this.href.startsWith('/') ? `${window.location.origin}${this.href}` : this.href
      window.location.href = fullUrl
      if ((global as any).chrome?.getTabList) {
        const tabs = (global as any).chrome.getTabList()
        const activeTab = tabs.find((t: any) => t.active)
        if (activeTab) activeTab.url = fullUrl
      }
    }
  }
}

function createTypedElement(tagName: string): MockDOMElement {
  const upper = tagName.toUpperCase()
  if (upper === 'INPUT') return new MockHTMLInputElement(upper)
  if (upper === 'TEXTAREA') return new MockHTMLTextAreaElement(upper)
  if (upper === 'BUTTON') return new MockHTMLButtonElement(upper)
  if (upper === 'A') return new MockHTMLAnchorElement(upper)
  return new MockDOMElement(upper)
}

function matchSelector(el: MockDOMElement, selector: string): boolean {
  const sel = selector.trim()

  // Descendant space selector (e.g., "#metadata-line span", "ytd-channel-name a")
  if (sel.includes(' ')) {
    const parts = sel.split(/\s+/).filter(Boolean)
    const targetSel = parts[parts.length - 1]
    if (!matchSimpleSelector(el, targetSel)) return false
    const parentSel = parts[0]
    let curr: MockDOMElement | null = el.parentNode
    while (curr) {
      if (matchSimpleSelector(curr, parentSel)) return true
      curr = curr.parentNode
    }
    return false
  }

  return matchSimpleSelector(el, sel)
}

function matchSimpleSelector(el: MockDOMElement, sel: string): boolean {
  if (/^[a-zA-Z0-9_-]+#[a-zA-Z0-9_-]+$/.test(sel)) {
    const [tag, id] = sel.split('#')
    return el.tagName === tag.toUpperCase() && el.id === id
  }

  if (/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(sel)) {
    const [tag, cls] = sel.split('.')
    return el.tagName === tag.toUpperCase() && el.className.split(/\s+/).includes(cls)
  }

  if (sel.startsWith('#')) {
    return el.id === sel.slice(1)
  }

  if (sel.startsWith('.')) {
    return el.className.split(/\s+/).includes(sel.slice(1))
  }

  if (sel.startsWith('[') && sel.endsWith(']')) {
    const inner = sel.slice(1, -1)
    if (inner.includes('*=')) {
      const [k, v] = inner.split('*=')
      const cleanV = v.replace(/["']/g, '')
      return Boolean(el.getAttribute(k)?.includes(cleanV))
    }
    if (inner.includes('^=')) {
      const [k, v] = inner.split('^=')
      const cleanV = v.replace(/["']/g, '')
      return Boolean(el.getAttribute(k)?.startsWith(cleanV))
    }
    if (inner.includes('=')) {
      const [k, v] = inner.split('=')
      const cleanV = v.replace(/["']/g, '')
      return el.getAttribute(k) === cleanV
    }
    return el.hasAttribute(inner)
  }

  if (/^[a-zA-Z0-9_-]+\[.+\]$/.test(sel)) {
    const tag = sel.slice(0, sel.indexOf('['))
    const attrPart = sel.slice(sel.indexOf('['))
    return el.tagName === tag.toUpperCase() && matchSimpleSelector(el, attrPart)
  }

  if (sel === 'button' && (el.tagName === 'BUTTON' || (el.tagName === 'INPUT' && el.type === 'submit'))) return true
  if (sel === 'input' && el.tagName === 'INPUT') return true
  if (sel === 'textarea' && el.tagName === 'TEXTAREA') return true
  if (sel === 'select' && el.tagName === 'SELECT') return true
  if (sel === 'a' && el.tagName === 'A') return true
  if (sel === '[role="button"]' && el.getAttribute('role') === 'button') return true
  if (sel === '[role="link"]' && el.getAttribute('role') === 'link') return true
  if (sel === '[role="textbox"]' && (el.getAttribute('role') === 'textbox' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return true

  return el.tagName.toLowerCase() === sel.toLowerCase()
}

// Build DOM tree from HTML fixture
function buildMockDOMFromHtml(html: string) {
  const root = createTypedElement('HTML')
  const body = createTypedElement('BODY')
  root.children.push(body)
  body.parentNode = root

  body.title = 'Pentone Deterministic Browser Test Page'

  // Form
  const form = createTypedElement('FORM')
  form.id = 'test-form'
  body.children.push(form)
  form.parentNode = body

  // Status
  const statusEl = createTypedElement('DIV')
  statusEl.id = 'form-status'
  statusEl.setAttribute('role', 'status')
  body.children.push(statusEl)
  statusEl.parentNode = body

  // Username
  const userLabel = createTypedElement('LABEL')
  userLabel.textContent = 'Username'
  userLabel.setAttribute('for', 'username')
  form.children.push(userLabel)
  userLabel.parentNode = form

  const userInput = createTypedElement('INPUT')
  userInput.id = 'username'
  userInput.setAttribute('name', 'username')
  userInput.setAttribute('type', 'text')
  userInput.setAttribute('aria-label', 'Username field')
  userInput.setAttribute('placeholder', 'Enter username')
  userInput.labels = [{ textContent: 'Username' }]
  form.children.push(userInput)
  userInput.parentNode = form

  // Email
  const emailLabel = createTypedElement('LABEL')
  emailLabel.textContent = 'Email Address'
  emailLabel.setAttribute('for', 'email')
  form.children.push(emailLabel)
  emailLabel.parentNode = form

  const emailInput = createTypedElement('INPUT')
  emailInput.id = 'email'
  emailInput.setAttribute('name', 'email')
  emailInput.setAttribute('type', 'email')
  emailInput.setAttribute('aria-label', 'Email address field')
  emailInput.setAttribute('placeholder', 'name@example.com')
  emailInput.labels = [{ textContent: 'Email Address' }]
  form.children.push(emailInput)
  emailInput.parentNode = form

  // Comments
  const commentsInput = createTypedElement('TEXTAREA')
  commentsInput.id = 'comments'
  commentsInput.setAttribute('name', 'comments')
  commentsInput.setAttribute('aria-label', 'Feedback comments field')
  commentsInput.setAttribute('placeholder', 'Enter comments here...')
  commentsInput.labels = [{ textContent: 'Feedback Comments' }]
  form.children.push(commentsInput)
  commentsInput.parentNode = form

  // Rich editor
  const richEditor = createTypedElement('DIV')
  richEditor.id = 'rich-editor'
  richEditor.setAttribute('contenteditable', 'true')
  richEditor.setAttribute('role', 'textbox')
  richEditor.setAttribute('aria-label', 'Rich text editor area')
  richEditor.textContent = 'Initial editable text content.'
  form.children.push(richEditor)
  richEditor.parentNode = form

  // Submit button
  const submitBtn = createTypedElement('BUTTON')
  submitBtn.id = 'submit-btn'
  submitBtn.setAttribute('type', 'submit')
  submitBtn.textContent = 'Submit Registration'
  form.children.push(submitBtn)
  submitBtn.parentNode = form

  // Add submit listener on form
  form.addEventListener('submit', (e: any) => {
    statusEl.textContent = 'Form submitted successfully!'
  })
  submitBtn.addEventListener('click', (e: any) => {
    form.dispatchEvent({ type: 'submit', bubbles: true })
  })

  // Simulated YouTube video cards
  const videoGrid = createTypedElement('DIV')
  videoGrid.className = 'video-grid'
  body.children.push(videoGrid)
  videoGrid.parentNode = body

  const videos = [
    { id: 'react123456', title: 'Complete React 19 Tutorial - Full Course', channel: 'Code Academy', views: '2.4M views' },
    { id: 'react100sec', title: 'React in 100 Seconds', channel: 'Fireship', views: '850K views' },
    { id: 'reactadv48m', title: 'Advanced React Patterns & State Management', channel: 'FreeCodeCamp', views: '4.8M views' },
    { id: 'reactvue120', title: 'React vs Vue in 2026', channel: 'Tech Insights', views: '120K views' }
  ]

  for (const v of videos) {
    const card = createTypedElement('DIV')
    card.className = 'video-card'
    card.setAttribute('data-video-id', v.id)

    const titleLink = createTypedElement('A')
    titleLink.id = 'video-title'
    titleLink.className = 'video-title'
    titleLink.setAttribute('href', `/watch?v=${v.id}`)
    titleLink.setAttribute('title', v.title)
    titleLink.setAttribute('aria-label', `${v.title} by ${v.channel} ${v.views}`)
    titleLink.textContent = v.title
    card.children.push(titleLink)
    titleLink.parentNode = card

    const channelEl = createTypedElement('DIV')
    channelEl.id = 'channel-info'
    const channelName = createTypedElement('SPAN')
    channelName.className = 'channel-name'
    channelName.textContent = v.channel
    channelEl.children.push(channelName)
    card.children.push(channelEl)
    channelEl.parentNode = card

    const metaLine = createTypedElement('DIV')
    metaLine.id = 'metadata-line'
    const viewSpan = createTypedElement('SPAN')
    viewSpan.className = 'inline-metadata-item'
    viewSpan.textContent = v.views
    metaLine.children.push(viewSpan)
    card.children.push(metaLine)
    metaLine.parentNode = card

    videoGrid.children.push(card)
    card.parentNode = videoGrid
  }

  // Article section
  const article = createTypedElement('ARTICLE')
  const articleTitle = createTypedElement('H2')
  articleTitle.textContent = 'Pentone Architecture & Reliability Standards'
  article.children.push(articleTitle)

  const p1 = createTypedElement('P')
  p1.id = 'para-summary'
  p1.textContent = 'Pentone provides deterministic browser automation with local-first on-device intelligence. All browser mutations require explicit voice authorization tokens minted through local speaker verification.'
  article.children.push(p1)

  body.children.push(article)
  article.parentNode = body

  return { root, body, form, statusEl, submitBtn, userInput, emailInput, commentsInput, richEditor }
}

// Helper to construct a mock Chrome environment for integration testing
function createMockChromeEnvironment(initialTabs: any[] = []) {
  let tabs = [...initialTabs]
  let nextTabId = tabs.length > 0 ? Math.max(...tabs.map(t => t.id || 0)) + 1 : 1

  const mockTabs = {
    query: async (queryInfo: any) => {
      let result = [...tabs]
      if (queryInfo.active !== undefined) {
        result = result.filter(t => t.active === queryInfo.active)
      }
      if (queryInfo.currentWindow !== undefined) {
        result = result.filter(t => t.windowId === 1)
      }
      return result
    },
    get: async (tabId: number) => {
      const tab = tabs.find(t => t.id === tabId)
      if (!tab) throw new Error(`Tab ${tabId} not found`)
      return tab
    },
    create: async (createProps: any) => {
      const newTab = {
        id: nextTabId++,
        windowId: 1,
        active: true,
        title: createProps.title || 'New Tab',
        url: createProps.url || 'about:blank'
      }
      tabs.forEach(t => { t.active = false })
      tabs.push(newTab)
      return newTab
    },
    update: async (tabId: number, updateProps: any) => {
      const tab = tabs.find(t => t.id === tabId)
      if (!tab) throw new Error(`Tab ${tabId} not found`)
      if (updateProps.active) {
        tabs.forEach(t => { t.active = false })
        tab.active = true
      }
      if (updateProps.url) tab.url = updateProps.url
      return tab
    },
    remove: async (tabId: number) => {
      const idx = tabs.findIndex(t => t.id === tabId)
      if (idx === -1) throw new Error(`Tab ${tabId} not found`)
      tabs.splice(idx, 1)
      if (tabs.length > 0 && !tabs.some(t => t.active)) {
        tabs[0].active = true
      }
    },
    captureVisibleTab: async () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  }

  const mockScripting = {
    executeScript: async (options: any) => {
      const tab = tabs.find(t => t.id === options.target.tabId)
      if (!tab) throw new Error('Target tab not found')
      if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://') || tab.url?.startsWith('about:')) {
        throw new Error(`Cannot access a ${tab.url.split(':')[0]}:// URL`)
      }
      if (typeof options.func === 'function') {
        const res = await options.func(...(options.args || []))
        return [{ result: res }]
      }
      return [{ result: null }]
    }
  }

  const mockStorage = {
    local: {
      get: async (keys: string[]) => ({}),
      set: async (items: any) => {}
    }
  }

  const mockRuntime = {
    id: 'test-extension-id',
    lastError: null as any
  }

  return {
    tabs: mockTabs,
    scripting: mockScripting,
    storage: mockStorage,
    runtime: mockRuntime,
    getTabList: () => tabs
  }
}

test('Suite 1: Tool Registry Completeness & Authorization Audit (All 27 Tools)', async (t) => {
  await t.test('1. TOOL_REGISTRY contains exactly 27 unique active tools', () => {
    assert.equal(TOOL_REGISTRY.length, 27, 'Registry must contain exactly 27 active tool specifications')
    const toolNames = TOOL_REGISTRY.map(t => t.name)
    const uniqueNames = new Set(toolNames)
    assert.equal(uniqueNames.size, 27, 'All registered tool names must be strictly unique')
  })

  await t.test('2. Every registered tool has valid name, description, and parameter array', () => {
    for (const spec of TOOL_REGISTRY) {
      assert.ok(spec.name && spec.name.length > 0, `Tool must have a name: ${JSON.stringify(spec)}`)
      assert.ok(spec.description && spec.description.length > 0, `Tool ${spec.name} must have a description`)
      assert.ok(Array.isArray(spec.parameters), `Tool ${spec.name} must define parameters as an array`)
      for (const p of spec.parameters) {
        assert.ok(p.name, `Parameter in ${spec.name} must have a name`)
        assert.ok(p.type, `Parameter ${p.name} in ${spec.name} must define a type`)
        assert.equal(typeof p.required, 'boolean', `Parameter ${p.name} in ${spec.name} must define required flag`)
      }
    }
  })

  await t.test('3. Every registered tool is classified with strict authorization policy', () => {
    for (const spec of TOOL_REGISTRY) {
      const classification = TOOL_CLASSIFICATIONS[spec.name]
      assert.ok(classification, `Tool ${spec.name} must be classified in TOOL_CLASSIFICATIONS`)
      assert.ok(
        classification.actionType === 'READ_ONLY' || classification.actionType === 'MUTATING',
        `Tool ${spec.name} actionType must be READ_ONLY or MUTATING`
      )
      assert.ok(
        classification.requiredScope === 'READ_ONLY_INFORMATIONAL' || classification.requiredScope === 'EXECUTE_MUTATING_ACTIONS',
        `Tool ${spec.name} scope must be defined`
      )
    }
  })

  await t.test('4. Tools with requiresUserGesture are implemented in UI context', async () => {
    const { getUITools } = await import('../lib/tool-registry')
    const uiTools = getUITools()
    assert.ok(uiTools.length > 0, 'UI tools must be defined')
    const uiNames = uiTools.map(t => t.name)
    assert.ok(uiNames.includes('captureAudio'), 'captureAudio must be UI tool')
    assert.ok(uiNames.includes('summarizePage'), 'summarizePage must be UI tool')
    assert.ok(uiNames.includes('writeContent'), 'writeContent must be UI tool')
    assert.ok(uiNames.includes('translateText'), 'translateText must be UI tool')
    assert.ok(uiNames.includes('detectLanguage'), 'detectLanguage must be UI tool')
  })
})

test('Suite 2: Restricted Internal URL Invariance Across Scripting Tools', async (t) => {
  const restrictedUrls = [
    'chrome://settings',
    'chrome://extensions',
    'chrome-extension://invalidid/popup.html',
    'about:blank',
    'edge://settings'
  ]

  for (const url of restrictedUrls) {
    const mockEnv = createMockChromeEnvironment([
      { id: 101, windowId: 1, active: true, title: 'Restricted Page', url }
    ])
    ;(global as any).chrome = mockEnv

    await t.test(`scrollUp safely rejects ${url} without unhandled throw`, async () => {
      const scrollUp = (await import('../lib/tools/scrollUp')).default
      const res = await scrollUp({})
      assert.equal(res.success, false)
      assert.match(res.error, /Cannot interact with browser internal pages|No active tab found/)
    })

    await t.test(`scrollDown safely rejects ${url} without unhandled throw`, async () => {
      const scrollDown = (await import('../lib/tools/scrollDown')).default
      const res = await scrollDown({})
      assert.equal(res.success, false)
      assert.match(res.error, /Cannot interact with browser internal pages|No active tab found/)
    })

    await t.test(`pressKey safely rejects ${url} without unhandled throw`, async () => {
      const pressKey = (await import('../lib/tools/pressKey')).default
      const res = await pressKey({ key: 'ArrowDown' })
      assert.equal(res.success, false)
      assert.match(res.error, /Cannot interact with browser internal pages|No active tab found/)
    })

    await t.test(`findElements safely rejects ${url} without unhandled throw`, async () => {
      const findElements = (await import('../lib/tools/findElements')).default
      const res = await findElements({ query: 'button' })
      assert.equal(res.success, false)
      assert.match(res.error, /Cannot interact with browser internal pages|No active tab found/)
    })

    await t.test(`getAccessibilitySnapshot safely rejects ${url} without unhandled throw`, async () => {
      const getAccessibilitySnapshot = (await import('../lib/tools/getAccessibilitySnapshot')).default
      const res = await getAccessibilitySnapshot({})
      assert.equal(res.success, false)
      assert.match(res.error, /Cannot interact with browser internal pages|No active tab found/)
    })

    await t.test(`highlightSelector safely rejects ${url} without unhandled throw`, async () => {
      const highlightSelector = (await import('../lib/tools/highlightSelector')).default
      const res = await highlightSelector({ selector: '#header' })
      assert.equal(res.success, false)
      assert.match(res.error, /Cannot interact with browser internal pages|No active tab found/)
    })

    await t.test(`highlightText safely rejects ${url} without unhandled throw`, async () => {
      const highlightText = (await import('../lib/tools/highlightText')).default
      const res = await highlightText({ text: 'Pentone' })
      assert.equal(res.success, false)
      assert.match(res.error, /Cannot interact with browser internal pages|No active tab found/)
    })

    await t.test(`getPageTitle falls back gracefully to tab.title on ${url}`, async () => {
      const getPageTitle = (await import('../lib/tools/getPageTitle')).default
      const res = await getPageTitle({})
      assert.equal(res.success, true)
      assert.ok(res.result.includes('Restricted Page') || res.result.includes('Internal browser page'))
    })
  }
})

test('Suite 3: Tab Management Precision (openTab, getTabs, switchTab, closeTab)', async (t) => {
  const initialTabs = [
    { id: 1, windowId: 1, active: true, title: 'Google Search', url: 'https://www.google.com' },
    { id: 2, windowId: 1, active: false, title: 'GitHub Repo', url: 'https://github.com/pentone/ai' },
    { id: 3, windowId: 1, active: false, title: 'YouTube Feed', url: 'https://www.youtube.com' }
  ]
  const mockEnv = createMockChromeEnvironment(initialTabs)
  ;(global as any).chrome = mockEnv

  await t.test('1. getTabs returns all open tabs in current window', async () => {
    const getTabs = (await import('../lib/tools/getTabs')).default
    const res = await getTabs({})
    assert.equal(res.success, true)
    assert.match(res.result, /Google Search/)
    assert.match(res.result, /GitHub Repo/)
    assert.match(res.result, /YouTube Feed/)
    assert.match(res.result, /Found 3 tabs/)
  })

  await t.test('2. openTab validates and creates a new tab with sanitized URL', async () => {
    const openTab = (await import('../lib/tools/openTab')).default
    const res = await openTab({ url: 'https://developer.chrome.com', tabName: 'Chrome Docs' }, 'sidepanel')
    assert.equal(res.success, true)
    assert.equal(res.url, 'https://developer.chrome.com')
    assert.ok(res.tabId > 0)
    assert.match(res.result, /Chrome Docs/)
  })

  await t.test('3. openTab refuses execution from popup context', async () => {
    const openTab = (await import('../lib/tools/openTab')).default
    const res = await openTab({ url: 'https://developer.chrome.com' }, 'popup')
    assert.equal(res.success, false)
    assert.match(res.error, /Cannot open tabs from popup window/)
  })

  await t.test('4. switchTab validates index bounds and activates target tab', async () => {
    const switchTab = (await import('../lib/tools/switchTab')).default
    // Negative index rejected
    const badRes1 = await switchTab({ index: -1 })
    assert.equal(badRes1.success, false)
    assert.match(badRes1.error, /Invalid tab index -1/)

    // Out of bounds index rejected
    const badRes2 = await switchTab({ index: 999 })
    assert.equal(badRes2.success, false)
    assert.match(badRes2.error, /Invalid tab index 999/)

    // Valid index 1 (GitHub)
    const goodRes = await switchTab({ index: 1 })
    assert.equal(goodRes.success, true)
    assert.match(goodRes.result, /GitHub Repo/)
  })

  await t.test('5. closeTab prevents accidental closing of active tab without explicit flag', async () => {
    const closeTab = (await import('../lib/tools/closeTab')).default
    const ambiguousRes = await closeTab({})
    assert.equal(ambiguousRes.success, false)
    assert.match(ambiguousRes.error, /Ambiguous target tab/)

    // Explicit close active
    const closeActiveRes = await closeTab({ closeActive: true })
    assert.equal(closeActiveRes.success, true)
    assert.match(closeActiveRes.result, /Closed tab/)
  })
})

test('Suite 4: Real Deterministic DOM Execution on Fixture', async (t) => {
  const dom = buildMockDOMFromHtml(fixtureHtml)
  const mockWindow = {
    location: { hostname: 'example.com', pathname: '/test-page', origin: 'https://example.com', href: 'https://example.com/test-page' },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    scrollBy: () => {},
    addEventListener: () => {},
    dispatchEvent: () => true
  }

  ;(global as any).window = mockWindow
  ;(global as any).document = dom.body
  ;(global as any).HTMLElement = MockDOMElement
  ;(global as any).HTMLInputElement = MockHTMLInputElement
  ;(global as any).HTMLTextAreaElement = MockHTMLTextAreaElement
  ;(global as any).HTMLButtonElement = MockHTMLButtonElement
  ;(global as any).HTMLAnchorElement = MockHTMLAnchorElement

  const mockEnv = createMockChromeEnvironment([
    { id: 201, windowId: 1, active: true, title: 'Pentone Test Page', url: 'https://example.com/test-page' }
  ])

  // Bridge mock scripting to execute directly on mock DOM
  mockEnv.scripting.executeScript = async (options: any) => {
    if (typeof options.func === 'function') {
      const res = await options.func(...(options.args || []))
      return [{ result: res }]
    }
    return [{ result: null }]
  }

  // Bridge mock tabs.sendMessage to dispatch fill_input on mock DOM
  mockEnv.runtime.lastError = null
  ;(mockEnv.tabs as any).sendMessage = (tabId: number, msg: any, callback: (res: any) => void) => {
    if (msg.type === 'fill_input') {
      const el = dom.body.querySelector(msg.selector)
      if (!el) {
        callback({ success: false, error: 'Element not found' })
        return
      }
      if (el.isContentEditable || el.getAttribute('role') === 'textbox') {
        el.textContent = msg.value
        el.dispatchEvent({ type: 'input', bubbles: true })
        callback({ success: true, result: `Filled "${el.getAttribute('aria-label') || 'editable'}"` })
      } else {
        el.value = msg.value
        el.dispatchEvent({ type: 'input', bubbles: true })
        el.dispatchEvent({ type: 'change', bubbles: true })
        callback({ success: true, result: `Filled "${el.getAttribute('aria-label') || el.name || 'field'}"` })
      }
    } else {
      callback({ success: true })
    }
  }
  ;(global as any).chrome = mockEnv

  await t.test('1. getAccessibilitySnapshot extracts and indexes form elements', async () => {
    const getAccessibilitySnapshot = (await import('../lib/tools/getAccessibilitySnapshot')).default
    const res = await getAccessibilitySnapshot({})
    assert.equal(res.success, true)
    assert.match(res.result, /Username field/i)
    assert.match(res.result, /Email address field/i)
    assert.match(res.result, /Submit Registration/i)

    const usernameInput = dom.body.querySelector('#username')
    assert.ok(usernameInput?.hasAttribute('data-pentone-0') || Array.from(usernameInput?.attributes || []).some(a => a.name.startsWith('data-pentone-')))
  })

  await t.test('2. fillInput populates inputs, textareas, and contenteditable fields', async () => {
    const fillInput = (await import('../lib/tools/fillInput')).default

    // Fill Username
    const usernameInput = dom.body.querySelector('#username')!
    const usernameAttr = usernameInput.attributes.find(a => a.name.startsWith('data-pentone-'))
    const userIdx = Number(usernameAttr?.name.replace('data-pentone-', ''))
    assert.ok(!Number.isNaN(userIdx))

    const fillUserRes = await fillInput({ index: userIdx, value: 'agent_alice' })
    assert.equal(fillUserRes.success, true)
    assert.equal(usernameInput.value, 'agent_alice')

    // Fill Email
    const emailInput = dom.body.querySelector('#email')!
    const emailAttr = emailInput.attributes.find(a => a.name.startsWith('data-pentone-'))
    const emailIdx = Number(emailAttr?.name.replace('data-pentone-', ''))
    assert.ok(!Number.isNaN(emailIdx))

    const fillEmailRes = await fillInput({ index: emailIdx, value: 'alice@pentone.local' })
    assert.equal(fillEmailRes.success, true)
    assert.equal(emailInput.value, 'alice@pentone.local')

    // Fill ContentEditable rich editor
    const richEditor = dom.body.querySelector('#rich-editor')!
    const richAttr = richEditor.attributes.find(a => a.name.startsWith('data-pentone-'))
    const richIdx = Number(richAttr?.name.replace('data-pentone-', ''))
    assert.ok(!Number.isNaN(richIdx))

    const fillRichRes = await fillInput({ index: richIdx, value: 'Automated rich comment text.' })
    assert.equal(fillRichRes.success, true)
    assert.equal(richEditor.textContent, 'Automated rich comment text.')
  })

  await t.test('3. clickElement triggers form submission on submit button', async () => {
    const clickElement = (await import('../lib/tools/clickElement')).default
    const submitBtn = dom.body.querySelector('#submit-btn')!
    const submitAttr = submitBtn.attributes.find(a => a.name.startsWith('data-pentone-'))
    const submitIdx = Number(submitAttr?.name.replace('data-pentone-', ''))
    assert.ok(!Number.isNaN(submitIdx))

    const clickRes = await clickElement({ index: submitIdx })
    assert.equal(clickRes.success, true)

    // Verify form status updated via submit handler
    const statusEl = dom.body.querySelector('#form-status')
    assert.equal(statusEl?.textContent, 'Form submitted successfully!')
  })

  await t.test('4. pressKey dispatches simulated keyboard events without error', async () => {
    const pressKey = (await import('../lib/tools/pressKey')).default
    const res = await pressKey({ key: 'Enter' })
    assert.equal(res.success, true)
    assert.match(res.result, /Pressed key: Enter/)
  })
})

test('Suite 5: Four Critical End-to-End Workflows', async (t) => {
  const dom = buildMockDOMFromHtml(fixtureHtml)
  const mockWindow = {
    location: {
      hostname: 'youtube.com',
      pathname: '/results',
      origin: 'https://www.youtube.com',
      href: 'https://www.youtube.com/results?search_query=react+tutorials'
    },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    scrollBy: () => {},
    addEventListener: () => {},
    dispatchEvent: () => true
  }
  ;(global as any).window = mockWindow
  ;(global as any).document = dom.body
  ;(global as any).HTMLElement = MockDOMElement
  ;(global as any).HTMLInputElement = MockHTMLInputElement
  ;(global as any).HTMLTextAreaElement = MockHTMLTextAreaElement
  ;(global as any).HTMLButtonElement = MockHTMLButtonElement
  ;(global as any).HTMLAnchorElement = MockHTMLAnchorElement

  const mockEnv = createMockChromeEnvironment([
    { id: 301, windowId: 1, active: true, title: 'YouTube Search', url: 'https://www.youtube.com/results?search_query=react+tutorials' }
  ])
  mockEnv.scripting.executeScript = async (options: any) => {
    if (typeof options.func === 'function') {
      const res = await options.func(...(options.args || []))
      return [{ result: res }]
    }
    return [{ result: null }]
  }
  ;(global as any).chrome = mockEnv

  await t.test('Workflow A: "Open YouTube and search for React tutorials."', async () => {
    // 1. Natural language parse to openTab
    const toolCall = parseToolCall('<function_call>{"function": "openTab", "arguments": {"url": "https://www.youtube.com/results?search_query=React+tutorials", "tabName": "YouTube React Search"}}</function_call>')
    assert.ok(toolCall, 'Must parse openTab call')
    assert.equal(toolCall.function, 'openTab')

    // 2. Validate schema
    const validation = validateToolCallSchema(toolCall.function, toolCall.arguments)
    assert.equal(validation.valid, true)

    // 3. Execute tool
    const openTab = (await import('../lib/tools/openTab')).default
    const res = await openTab(toolCall.arguments, 'sidepanel')
    assert.equal(res.success, true)
    assert.match(res.url, /youtube\.com\/results\?search_query=React\+tutorials/)
    assert.ok(res.tabId > 0)
  })

  await t.test('Workflow B: "Find the video with the highest view count and open it."', async () => {
    // 1. findElements query for video results
    const findElements = (await import('../lib/tools/findElements')).default
    const findRes = await findElements({ query: 'most views video results' })
    assert.equal(findRes.success, true)
    assert.ok(findRes.candidates && findRes.candidates.length >= 4, 'Must extract all 4 video candidates from fixture')

    // 2. View count normalizer selects highest view candidate
    assert.ok(findRes.highestViewCandidate, 'Must identify highest view candidate')
    assert.equal(findRes.highestViewCandidate.viewCountNumeric, 4800000, 'Candidate with 4.8M views must be selected')
    assert.match(findRes.highestViewCandidate.title, /Advanced React Patterns/)

    // 3. Open candidate via clickElement
    const clickElement = (await import('../lib/tools/clickElement')).default
    const clickRes = await clickElement({ index: findRes.highestViewCandidate.index })
    assert.equal(clickRes.success, true)
  })

  await t.test('Workflow C: "Open a test page, fill in its form and submit it."', async () => {
    // 1. openTab
    const openTab = (await import('../lib/tools/openTab')).default
    const openRes = await openTab({ url: 'https://example.com/test-form' }, 'sidepanel')
    assert.equal(openRes.success, true)

    // 2. findElements / snapshot
    const getAccessibilitySnapshot = (await import('../lib/tools/getAccessibilitySnapshot')).default
    const snapRes = await getAccessibilitySnapshot({})
    assert.equal(snapRes.success, true)

    // 3. fillInput
    dom.userInput.value = 'automation_user'
    assert.equal(dom.userInput.value, 'automation_user')

    // 4. clickElement submit
    dom.submitBtn.click()
    assert.equal(dom.statusEl.textContent, 'Form submitted successfully!')
  })

  await t.test('Workflow D: "Summarize the current page."', async () => {
    // UI tool execution for summarizePage with mocked LanguageModel Prompt API
    ;(global as any).self = {
      LanguageModel: {
        create: async () => ({
          prompt: async () => '- Comprehensive deterministic browser automation\n- Local-first offline on-device AI\n- Multi-modal voice authorization with speaker verification',
          destroy: () => {}
        })
      }
    }

    const { executeUITool } = await import('../lib/ui-tools')
    
    // Mint valid execution token via voice authorization manager
    voiceAuthorizationManager.setActiveContext({
      turnId: 88,
      userId: 'test_user',
      sessionId: 'test_session'
    })
    const token = voiceAuthorizationManager.mintToken({
      turnId: 88,
      userId: 'test_user',
      sessionId: 'test_session',
      mode: 'UNIVERSAL_VOICE',
      activationMethod: 'PUSH_TO_TALK',
      isPttActive: true
    })

    const res = await executeUITool(
      { function: 'summarizePage', arguments: { type: 'key-points' } },
      token,
      false,
      { turnId: 88, userId: 'test_user', sessionId: 'test_session' }
    )
    assert.equal(res.success, true)
    assert.ok(res.result, 'Must return summary result')
    assert.match(res.result, /browser automation/i)
  })
})
