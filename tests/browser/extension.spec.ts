import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
let context: BrowserContext, panel: Page, site: Page, server: Server, origin: string
const errors: string[] = []
async function runTool(toolName: string, parameters: any = {}) {
  await site.bringToFront()
  return panel.evaluate(async ({ toolName, parameters }) => {
    const runId = crypto.randomUUID()
    const result = await chrome.runtime.sendMessage({ type: 'run_tool', payload: { toolName, parameters, context: 'sidepanel', runId, request: 'Test this explicit browser tool' } })
    await chrome.runtime.sendMessage({ type: 'finish_tools', runId })
    return result
  }, { toolName, parameters })
}
test.beforeAll(async () => {
  const extension = resolve('build/chrome-mv3-prod')
  const profile = resolve('tests/evidence/browser-profile-' + Date.now())
  await mkdir(profile, { recursive: true })
  context = await chromium.launchPersistentContext(profile, {
    channel: (process.env.PENTONE_TEST_CHANNEL || 'msedge') as any, headless: true,
    viewport: { width: 430, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  })
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20000 })
  const id = new URL(worker.url()).host
  await worker.evaluate(() => chrome.storage.local.set({ pentone_offline_mode_selected: true, pentone_onboarding_complete: true, tts_audio_enabled: false }))
  // Fixtures and tests are local. Model downloads and external pages are excluded from this suite.
  await context.route(/^https?:/, route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html')
    res.end(`<!doctype html><html><head><title>Pentone Test Fixture</title></head><body>
    <h1>Local test form</h1><form><label>Name<input id="name" name="name"></label><label>Email<input id="email" type="email" name="email"></label>
    <label>Country<select id="country"><option>India</option><option>Canada</option></select></label>
    <button type="button" id="count" onclick="this.dataset.clicks=String(Number(this.dataset.clicks||0)+1)">Count click</button></form>
    <div id="editor" contenteditable="true">Edit here</div><p id="text">Select this useful text for highlighting.</p>
    <article>${'This local article describes reliable browser testing and predictable form handling. '.repeat(25)}</article>
    <script>window.keyCount=0;document.addEventListener('keydown',()=>window.keyCount++)</script>
    </body></html>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as any).port}`
  panel = await context.newPage()
  panel.on('pageerror', err => { errors.push(err.message); console.error('Extension page error:', err.message) })
  await panel.addLocatorHandler(panel.getByRole('button', { name: 'Dismiss alert' }).first(), async button => { await button.click() }, { noWaitAfter: true })
  await panel.goto(`chrome-extension://${id}/sidepanel.html`)
  await expect(panel.getByRole('button', { name: 'Profile', exact: true })).toBeVisible({ timeout: 20000 })
  site = await context.newPage(); site.on('pageerror', err => errors.push(err.message)); await site.goto(origin)
})
test.afterAll(async () => { await context?.close(); server?.close() })
test('all eight screens mount in light and dark themes at panel widths', async () => {
  test.setTimeout(120000)
  for (const width of [360, 430, 800]) {
    await panel.setViewportSize({ width, height: 900 })
    for (const theme of ['Dark', 'Light']) {
      const toggle = panel.getByTitle(`Switch to ${theme} theme`)
      if (await toggle.count()) await toggle.click()
      for (const name of ['Voice', 'Chat', 'History', 'Tools', 'Memory', 'Profile', 'Settings', 'Diagnostics']) {
        await panel.locator('nav').getByRole('button', { name, exact: true }).click()
        if (name === 'Settings') await expect(panel.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
        else if (name === 'Diagnostics') await expect(panel.getByText('DEBUG_CHAT', { exact: true })).toBeVisible()
        else await expect(panel.locator('header')).toBeVisible()
        await expect(panel.getByText('Something went wrong', { exact: true })).toHaveCount(0)
        if (width === 430) await panel.screenshot({ animations: 'disabled', path: `tests/evidence/${name.toLowerCase()}-${theme.toLowerCase()}.png` })
        if (name === 'Settings') await panel.getByTitle('Back to voice', { exact: true }).click()
        if (name === 'Diagnostics') await panel.getByTitle('Back to voice screen', { exact: true }).click()
      }
    }
  }
  expect(errors).toEqual([])
})
test('background tools modify real DOM, preserve explicit targets, and reject malformed inputs', async () => {
  expect((await runTool('fillInput', { query: 'email', value: 'test@example.com' })).success).toBe(true)
  await expect(site.locator('#email')).toHaveValue('test@example.com')
  expect((await runTool('fillInput', { query: 'missing', value: 'wrong' })).success).toBe(false)
  await expect(site.locator('#name')).toHaveValue('')
  const selected = await runTool('selectOption', { selector: '#country', query: 'Canada' })
  expect(selected.success, JSON.stringify(selected)).toBe(true)
  await expect(site.locator('#country')).toHaveValue('Canada')
  expect((await runTool('clickElement', { selector: '#count' })).success).toBe(true)
  await expect(site.locator('#count')).toHaveAttribute('data-clicks', '1')
  await site.locator('#email').focus()
  expect((await runTool('pressKey', { key: 'Enter' })).success).toBe(true)
  expect(await site.evaluate(() => (window as any).keyCount)).toBe(1)
  expect((await runTool('highlightSelector', { selector: '#text' })).success).toBe(true)
  expect((await runTool('highlightText', { text: 'useful text' })).success).toBe(true)
  expect((await runTool('closeTab', { query: 'no-such-tab-12345' })).success).toBe(false)
  expect(site.isClosed()).toBe(false)
  expect((await runTool('openTab', { url: 'javascript:alert(1)' })).success).toBe(false)
  expect((await runTool('fillInput', { value: 42 })).success).toBe(false)
  expect(errors).toEqual([])
})
test('100 real field writes, voice badges, screenshot capture and profile autofill', async () => {
  for (let i = 0; i < 100; i++) expect((await runTool('fillInput', { selector: '#name', value: `Person ${i}` })).success).toBe(true)
  await expect(site.locator('#name')).toHaveValue('Person 99')
  const badges = await runTool('voiceSurfer', { action: 'show' }); expect(badges.success, JSON.stringify(badges)).toBe(true)
  expect((await runTool('voiceSurfer', { action: 'hide' })).success).toBe(true)
  const screenshot = await runTool('captureScreenshot'); expect(screenshot.success).toBe(true); expect(screenshot.result).toMatch(/^data:image/)
  await panel.evaluate(() => chrome.storage.local.set({ pentone_autofill_profile: { personal: { fullName: 'Profile Person', email: 'profile@example.com' }, online: {}, workExperience: [], education: [], skills: [], demographics: {}, customAnswers: [] } }))
  const preview = await runTool('autofillForm', { section: 'personal', mode: 'preview' }); expect(preview.success, JSON.stringify(preview)).toBe(true)
  const filled = await runTool('autofillForm', { section: 'personal', mode: 'instant' }); expect(filled.success, JSON.stringify(filled)).toBe(true)
  await expect(site.locator('#email')).toHaveValue('profile@example.com')
  expect(errors).toEqual([])
})


test('tab navigation, page inspection, zoom, and memory persistence work through background messages', async () => {
  expect((await runTool('getPageTitle')).result).toContain('Pentone Test Fixture')
  expect((await runTool('getTabs')).success).toBe(true)
  expect((await runTool('getAccessibilitySnapshot')).success).toBe(true)
  const semanticSearch = await runTool('findElements', { query: 'button' })
  // The embedding model is intentionally unavailable in this offline fixture.
  expect(semanticSearch.success).toBe(false)
  expect(typeof semanticSearch.error).toBe('string')
  expect((await runTool('zoomPage', { action: 'set', factor: 125 })).success).toBe(true)
  const zoom = await panel.evaluate(async () => { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); return chrome.tabs.getZoom(tab.id!) })
  expect(zoom).toBe(1.25)
  expect((await runTool('zoomPage', { action: 'reset' })).success).toBe(true)
  expect((await runTool('scrollDown', { amount: 100 })).success).toBe(true)
  expect((await runTool('scrollUp', { amount: 100 })).success).toBe(true)
  await site.goto(origin + '/second')
  expect((await runTool('navigatePage', { action: 'back' })).success).toBe(true)
  await expect(site).toHaveURL(origin + '/')
  expect((await runTool('navigatePage', { action: 'forward' })).success).toBe(true)
  await expect(site).toHaveURL(origin + '/second')
  const newPage = context.waitForEvent('page')
  expect((await runTool('openTab', { url: origin + '/temporary' })).success).toBe(true)
  const temporary = await newPage
  await temporary.waitForLoadState()
  expect((await runTool('switchTab', { query: '/temporary' })).success).toBe(true)
  expect((await runTool('closeTab', { query: '/temporary' })).success).toBe(true)
  await expect.poll(() => temporary.isClosed()).toBe(true)
  expect((await runTool('storeMemory', { content: 'Browser persistence test', tags: ['test'] })).success).toBe(true)
  expect((await runTool('getMemories')).result).toContain('Browser persistence test')
  await panel.reload()
  await panel.locator('nav').getByRole('button', { name: 'Memory', exact: true }).click()
  await panel.getByPlaceholder('Filter memories...').fill('Browser persistence test')
  await expect(panel.getByText('Browser persistence test', { exact: true })).toBeVisible()
  await panel.getByTitle('Delete memory', { exact: true }).click()
  await expect(panel.getByText('Browser persistence test', { exact: true })).toHaveCount(0)
  expect((await runTool('getMemories')).result).not.toContain('Browser persistence test')
  expect(errors).toEqual([])
})

test('relative tab closure preserves the reference and tabs in other windows', async () => {
  const result = await panel.evaluate(async origin => {
    const w = await chrome.windows.create({ url: `${origin}/tab-mail`, focused: false })
    const ids = [w!.tabs![0].id!]
    for (const name of ['Docs', 'YouTube', 'GitHub']) ids.push((await chrome.tabs.create({ windowId: w!.id, url: `${origin}/tab-${name}`, active: false })).id!)
    return { windowId: w!.id!, ids }
  }, origin)
  try {
    await expect.poll(async () => panel.evaluate(async ids => (await Promise.all(ids.map(id => chrome.tabs.get(id)))).every(t => t.status === 'complete'), result.ids)).toBe(true)
    await panel.evaluate(async ids => {
      for (let i = 0; i < ids.length; i++) await chrome.scripting.executeScript({ target: { tabId: ids[i] }, func: title => { document.title = title }, args: [['Mail', 'Docs', 'YouTube', 'GitHub'][i]] })
    }, result.ids)
    const outcome = await panel.evaluate(async ({ windowId }) => {
      const runId = crypto.randomUUID()
      const request = 'close all tabs to the left of YouTube'
      const blocked = await chrome.runtime.sendMessage({ type: 'run_tool', payload: { toolName: 'closeTab', parameters: { all: true }, runId, request } })
      const closed = await chrome.runtime.sendMessage({ type: 'run_tool', payload: { toolName: 'closeTabsToLeft', parameters: { reference: 'YouTube', windowId }, runId, request } })
      const remaining = await chrome.tabs.query({ windowId })
      await chrome.runtime.sendMessage({ type: 'finish_tools', runId })
      return { blocked, closed, remaining: remaining.map(t => t.id) }
    }, result)
    expect(outcome.blocked.success).toBe(false)
    expect(outcome.closed.success, JSON.stringify(outcome.closed)).toBe(true)
    expect(outcome.remaining).toEqual(result.ids.slice(2))
    expect(site.isClosed()).toBe(false); expect(panel.isClosed()).toBe(false)
  } finally { await panel.evaluate(id => chrome.windows.remove(id), result.windowId) }
})

test('bundled page tools operate on accessible controls, forms and tables', async () => {
  await site.goto(origin + '/')
  const clicked = await runTool('clickByRole', { target: { role: 'button', name: 'Count click' } })
  expect(clicked.success, JSON.stringify(clicked)).toBe(true)
  await expect(site.locator('#count')).toHaveAttribute('data-clicks', '1')
  expect((await runTool('fillFormFields', { fields: [{ target: { name: 'Email' }, value: 'local@example.com' }] })).success).toBe(true)
  await expect(site.locator('#email')).toHaveValue('local@example.com')
  await site.evaluate(() => {
    const div = document.createElement('div')
    div.innerHTML = '<table id="test-table"><tr><th>Name</th><th>Value</th></tr><tr><td>Row</td><td>=1+1</td></tr></table><button id="skip-fixture">Skip ad</button><div role="dialog">Cookies<button id="accept-fixture">Accept all</button><button id="reject-fixture">Reject all</button></div>'
    document.body.append(div)
    document.querySelector('#skip-fixture')!.addEventListener('click', event => (event.target as Element).remove())
    document.querySelector('#reject-fixture')!.addEventListener('click', () => document.querySelector('[role="dialog"]')!.remove())
  })
  const table = await runTool('extractTable', { target: { selector: '#test-table' } })
  expect(table.success, JSON.stringify(table)).toBe(true); expect(table.data.csv).toContain("'=1+1")
  expect((await runTool('clickSkipButton', { timeoutMs: 1000 })).success).toBe(true)
  await expect(site.locator('#skip-fixture')).toHaveCount(0)
  expect((await runTool('rejectOptionalCookies')).success).toBe(true)
  await expect(site.locator('[role="dialog"]')).toHaveCount(0)
  expect((await runTool('readPageText')).result).toContain('Local test form')
  expect(errors).toEqual([])
})

test('Stop cancels a live wait before a delayed control appears', async () => {
  await site.goto(origin + '/')
  await site.bringToFront()
  const runId = await panel.evaluate(async () => {
    const runId = crypto.randomUUID()
    ;(window as any).pendingWait = chrome.runtime.sendMessage({ type: 'run_tool', payload: { toolName: 'clickWhenReady', parameters: { target: { name: 'Delayed action' }, timeoutMs: 10000 }, runId, request: 'Click Delayed action when ready' } })
    return runId
  })
  await expect.poll(() => panel.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: () => typeof (globalThis as any).__pentonePageAgent === 'function' })
    return result.result
  })).toBe(true)
  await panel.evaluate(runId => chrome.runtime.sendMessage({ type: 'cancel_tools', runId }), runId)
  const outcome = await panel.evaluate(() => (window as any).pendingWait)
  expect(outcome.success).toBe(false)
  await site.evaluate(() => {
    const button = document.createElement('button'); button.textContent = 'Delayed action'; button.id = 'delayed'
    button.addEventListener('click', () => button.dataset.clicked = 'yes'); document.body.append(button)
  })
  await expect(site.locator('#delayed')).not.toHaveAttribute('data-clicked', 'yes')
  expect(errors).toEqual([])
})

test('a consequential fixture action waits for confirmation in the extension UI', async () => {
  await site.goto(origin + '/')
  await site.evaluate(() => {
    const button = document.createElement('button'); button.textContent = 'Delete fixture item'; button.id = 'delete-fixture'
    button.addEventListener('click', () => button.dataset.clicked = 'yes'); document.body.append(button)
  })
  await site.bringToFront()
  const pending = await panel.evaluate(async () => {
    const payload = { toolName: 'clickByRole', parameters: { target: { name: 'Delete fixture item' } }, runId: crypto.randomUUID(), request: 'Delete the fixture item' }
    return { payload, response: await chrome.runtime.sendMessage({ type: 'run_tool', payload }) }
  })
  expect(pending.response.requiresConfirmation).toBe(true)
  await expect(site.locator('#delete-fixture')).not.toHaveAttribute('data-clicked', 'yes')
  panel.once('dialog', dialog => dialog.accept())
  const result = await panel.evaluate(async ({ payload, response }) => {
    if (!window.confirm(response.preview)) throw new Error('Fixture confirmation declined')
    const result = await chrome.runtime.sendMessage({ type: 'run_tool', payload: { ...payload, confirmationId: response.confirmationId } })
    await chrome.runtime.sendMessage({ type: 'finish_tools', runId: payload.runId })
    return result
  }, pending)
  expect(result.success, JSON.stringify(result)).toBe(true)
  await expect(site.locator('#delete-fixture')).toHaveAttribute('data-clicked', 'yes')
  expect(errors).toEqual([])
})

test('microphone first-use setup installs a local pack through the existing UI without an error alert', async () => {
  await panel.addInitScript(() => {
    const state = { ready: false, hold: false, starts: 0, installs: 0, local: false, locale: '', finish: null as null | (() => void) }
    ;(window as any).__speechFixture = state
    ;(window as any).SpeechRecognition = class {
      processLocally = false
      lang = ''
      onstart?: () => void
      onend?: () => void
      static async available(options: any) {
        if (!options.processLocally) throw new Error('Online speech is forbidden in this test')
        return state.ready ? 'available' : 'downloadable'
      }
      static install(options: any) {
        if (!options.processLocally) throw new Error('Local setup was not requested')
        state.installs++
        return new Promise<boolean>(resolve => {
          const finish = () => { state.ready = true; resolve(true) }
          if (state.hold) state.finish = finish
          else finish()
        })
      }
      start() { state.starts++; state.local = this.processLocally; state.locale = this.lang; queueMicrotask(() => this.onstart?.()) }
      stop() { queueMicrotask(() => this.onend?.()) }
      abort() { this.stop() }
    }
  })
  await panel.reload()
  await panel.locator('nav').getByRole('button', { name: 'Chat', exact: true }).click()
  await panel.getByTitle('Speak instruction', { exact: true }).click()
  await expect(panel.getByTitle('Stop listening', { exact: true })).toBeVisible()
  expect(await panel.evaluate(() => {
    const { starts, installs, local, locale } = (window as any).__speechFixture
    return { starts, installs, local, locale }
  })).toMatchObject({ starts: 1, installs: 1, local: true, locale: expect.stringMatching(/^en-/) })
  await expect(panel.getByText('Install the on-device speech language pack from Pentone Settings before using the microphone.')).toHaveCount(0)
  await panel.getByTitle('Stop listening', { exact: true }).click()
  expect(errors).toEqual([])
})

test('a pending speech download can be cancelled without a later microphone start', async () => {
  await panel.reload()
  await panel.locator('nav').getByRole('button', { name: 'Chat', exact: true }).click()
  await panel.evaluate(() => { (window as any).__speechFixture.hold = true })
  await panel.getByTitle('Speak instruction', { exact: true }).click()
  await expect(panel.getByRole('status')).toContainText('Downloading local speech')
  await panel.getByTitle('Cancel microphone setup', { exact: true }).click()
  await panel.evaluate(async () => { (window as any).__speechFixture.finish?.(); await Promise.resolve() })
  await expect(panel.getByTitle('Speak instruction', { exact: true })).toBeVisible()
  expect(await panel.evaluate(() => (window as any).__speechFixture.starts)).toBe(0)
  expect(errors).toEqual([])
})

test('onboarding lists all local resources and retries a failed model without redoing completed downloads', async () => {
  await panel.addInitScript(() => {
    const fixture = { calls: {} as Record<string, number>, ready: new Set<string>(), failWriter: true, destroyed: 0 }
    ;(window as any).__setupFixture = fixture
    for (const name of ['LanguageModel', 'Writer', 'Rewriter', 'Summarizer', 'LanguageDetector', 'Translator']) {
      ;(window as any)[name] = {
        async availability(options: any) {
          const key = name + (options?.expectedInputs?.[1]?.type || '') + (options?.sourceLanguage || '') + (options?.targetLanguage || '')
          return fixture.ready.has(key) ? 'available' : 'downloadable'
        },
        async create(options: any) {
          const key = name + (options?.expectedInputs?.[1]?.type || '') + (options?.sourceLanguage || '') + (options?.targetLanguage || '')
          fixture.calls[key] = (fixture.calls[key] || 0) + 1
          if (name === 'Writer' && fixture.failWriter) { fixture.failWriter = false; throw new DOMException('Fresh click needed', 'NotAllowedError') }
          fixture.ready.add(key)
          return { destroy() { fixture.destroyed++ } }
        }
      }
    }
  })
  await panel.evaluate(async () => {
    await chrome.storage.local.remove(['pentone_onboarding_complete', 'pentone_offline_mode_selected'])
    await chrome.storage.local.set({ pentone_setup_languages: ['hi'] })
    // Cache metadata fixtures avoid a model download in this offline UI suite.
    const cache = await caches.open('transformers-cache')
    for (const file of ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx']) {
      await cache.put('https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/' + file, new Response('fixture'))
    }
  })
  await panel.reload()
  await expect(panel.getByRole('heading', { name: 'Local AI Engine Setup', exact: true })).toBeVisible()
  const checklist = panel.getByRole('region', { name: 'Local AI setup checklist' }).last()
  for (const name of ['Gemini Nano · Assistant', 'Page summaries', 'Writing', 'Rewriting', 'Language detection', 'English → Hindi', 'Hindi → English', 'Microphone language pack', 'Spoken replies · Local system voice']) {
    await expect(checklist.getByRole('heading', { name, exact: true })).toBeAttached()
  }
  await expect(checklist.getByRole('button', { name: 'Download all supported models & packs', exact: true })).toBeEnabled()
  const permissionPage = context.waitForEvent('page', { timeout: 1500 }).catch(() => null)
  await checklist.getByRole('button', { name: 'Download all supported models & packs', exact: true }).click()
  // Setup may open the separate native permission tab. It never starts voice capture in the panel.
  const permission = await permissionPage
  if (permission) await permission.close()
  await expect(checklist.locator('#local-setup-writer')).toContainText('fresh click')
  await expect(checklist.locator('#local-setup-summarizer')).toContainText('Ready')
  await checklist.locator('#local-setup-writer').getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(checklist.locator('#local-setup-writer')).toContainText('Ready')
  expect(await panel.evaluate(() => (window as any).__setupFixture.calls.Summarizer)).toBe(1)
  expect(await panel.evaluate(() => (window as any).__setupFixture.calls.Writer)).toBe(2)
  expect(await panel.evaluate(() => (window as any).__speechFixture.starts)).toBe(0)
  await checklist.getByText('Libraries & files already included — no separate download', { exact: true }).click()
  await expect(checklist.getByText(/You do not need Node.js/)).toBeVisible()
  await panel.screenshot({ animations: 'disabled', path: 'tests/evidence/local-setup-checklist.png', fullPage: true })
  await panel.getByRole('button', { name: /Continue · finish setup later|Open Pentone/, exact: true }).click()
  expect(errors).toEqual([])
})

test('Voice setup alert opens the missing resource in Settings', async () => {
  await panel.locator('nav').getByRole('button', { name: 'Voice', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Open missing items in Settings' })).toBeVisible()
  await panel.getByRole('button', { name: 'Open missing items in Settings' }).click()
  await expect(panel.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  await expect(panel.locator('[id^="local-setup-"]:focus')).toHaveCount(1)
  await panel.screenshot({ animations: 'disabled', path: 'tests/evidence/local-setup-settings.png' })
  await panel.getByTitle('Back to voice', { exact: true }).click()
  expect(errors).toEqual([])
})
