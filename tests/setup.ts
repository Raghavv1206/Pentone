import { beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'

export let data: Record<string, any> = {}
export let tabs: any[] = []
export const storageListeners = new Set<Function>()
export const chromeMock: any = {
  runtime: { id: 'test-extension', getURL: (path: string) => `chrome-extension://test-extension/${path}`,
    getManifest: () => ({ version: '1.0.0' }), sendMessage: vi.fn(), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
  storage: { local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() }, onChanged: {
    addListener: (fn: Function) => storageListeners.add(fn), removeListener: (fn: Function) => storageListeners.delete(fn)
  } },
  tabs: { query: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
    sendMessage: vi.fn(), captureVisibleTab: vi.fn(), getZoom: vi.fn(), setZoom: vi.fn(), goBack: vi.fn(), goForward: vi.fn(), reload: vi.fn(),
    onActivated: { addListener: vi.fn(), removeListener: vi.fn() }, onUpdated: { addListener: vi.fn(), removeListener: vi.fn() } },
  scripting: { executeScript: vi.fn() }, sidePanel: { open: vi.fn(), setPanelBehavior: vi.fn() },
  tabCapture: { getMediaStreamId: vi.fn() }
}
Object.assign(chromeMock, {
  permissions: { contains: vi.fn(), request: vi.fn(), remove: vi.fn() },
  windows: { getAll: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() },
  tabGroups: { query: vi.fn(), update: vi.fn() },
  bookmarks: { search: vi.fn(), get: vi.fn(), getTree: vi.fn(), create: vi.fn(), move: vi.fn(), remove: vi.fn() },
  downloads: { search: vi.fn(), download: vi.fn(), pause: vi.fn(), resume: vi.fn(), cancel: vi.fn(), show: vi.fn() },
  history: { search: vi.fn(), getVisits: vi.fn(), deleteUrl: vi.fn() },
  sessions: { restore: vi.fn(), getRecentlyClosed: vi.fn() },
  webNavigation: { getAllFrames: vi.fn() }
})
Object.assign(chromeMock.tabs, { duplicate: vi.fn(), move: vi.fn(), group: vi.fn(), ungroup: vi.fn() })
function response(value: any, cb?: Function) {
  if (cb) queueMicrotask(() => cb(value))
  return Promise.resolve(value)
}
export function seed(values: Record<string, any>) { Object.assign(data, structuredClone(values)) }
export function setTabs(values: any[]) { tabs = values }
export async function inject({ func, args = [], files }: any): Promise<any[]> {
  if (files) {
    for (const file of files) (0, eval)(readFileSync(file === 'pentone-page-agent.js' ? 'tests/evidence/pentone-page-agent.js' : file, 'utf8'))
    return [{ frameId: 0, documentId: 'document-1' }]
  }
  // Chrome serializes injected functions. Re-evaluation catches accidental module-scope dependencies.
  if (args.some((value: unknown) => value === undefined)) throw new Error('Undefined injection argument')
  const isolated = (0, eval)(`(${func.toString()})`)
  return [{ frameId: 0, result: await isolated(...structuredClone(args)) }]
}
beforeEach(() => {
  vi.clearAllMocks()
  data = {}; tabs = [{ id: 1, windowId: 1, index: 0, active: true, title: 'Example', url: 'https://example.com/form' }]
  storageListeners.clear(); document.body.innerHTML = ''; document.title = 'Example'
  vi.stubGlobal('chrome', chromeMock)
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  chromeMock.runtime.lastError = undefined
  chromeMock.storage.local.get.mockImplementation((keys: any, cb?: Function) => {
    const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(data)
    return response(structuredClone(Object.fromEntries(names.filter((k: string) => k in data).map((k: string) => [k, data[k]]))), cb)
  })
  chromeMock.storage.local.set.mockImplementation((values: any, cb?: Function) => {
    const changes: any = {}; Object.entries(values).forEach(([key, value]) => {
      changes[key] = { oldValue: data[key], newValue: structuredClone(value) }; data[key] = structuredClone(value)
    })
    queueMicrotask(() => storageListeners.forEach(fn => fn(changes, 'local')))
    return response(undefined, cb)
  })
  chromeMock.storage.local.remove.mockImplementation((keys: any, cb?: Function) => {
    for (const key of [keys].flat()) delete data[key]
    return response(undefined, cb)
  })
  chromeMock.tabs.query.mockImplementation((query: any) => response(tabs.filter(t => (!query.active || t.active) && (query.windowId === undefined || t.windowId === query.windowId) && (!query.currentWindow || t.windowId === 1))))
  chromeMock.tabs.get.mockImplementation(async (id: number) => { const tab = tabs.find(t => t.id === id); if (!tab) throw new Error('Tab not found'); return tab })
  chromeMock.tabs.create.mockImplementation(async (opts: any) => { const tab = { ...opts, id: tabs.length + 1 }; tabs.push(tab); return tab })
  chromeMock.tabs.remove.mockImplementation(async (ids: any) => { tabs = tabs.filter(t => ![ids].flat().includes(t.id)) })
  chromeMock.tabs.update.mockImplementation(async (id: number, opts: any) => { const tab = tabs.find(t => t.id === id); if (!tab) throw new Error('Tab not found'); return Object.assign(tab, opts) })
  chromeMock.permissions.contains.mockResolvedValue(false)
  chromeMock.permissions.request.mockResolvedValue(false)
  chromeMock.windows.getAll.mockResolvedValue([])
  chromeMock.windows.get.mockRejectedValue(new Error('Window not found'))
  chromeMock.windows.create.mockRejectedValue(new Error('Windows unavailable'))
  chromeMock.windows.update.mockRejectedValue(new Error('Window not found'))
  chromeMock.tabs.duplicate.mockRejectedValue(new Error('Tab not found'))
  chromeMock.tabs.move.mockRejectedValue(new Error('Tab not found'))
  chromeMock.tabs.group.mockRejectedValue(new Error('Tab not found'))
  chromeMock.tabs.ungroup.mockResolvedValue(undefined)
  chromeMock.tabGroups.query.mockResolvedValue([])
  chromeMock.bookmarks.get.mockResolvedValue([])
  chromeMock.bookmarks.search.mockResolvedValue([])
  chromeMock.bookmarks.getTree.mockResolvedValue([])
  chromeMock.downloads.search.mockResolvedValue([])
  chromeMock.history.getVisits.mockResolvedValue([])
  chromeMock.history.search.mockResolvedValue([])
  chromeMock.sessions.getRecentlyClosed.mockResolvedValue([])
  chromeMock.webNavigation.getAllFrames.mockResolvedValue([])
  chromeMock.tabs.getZoom.mockResolvedValue(1); chromeMock.tabs.setZoom.mockResolvedValue(undefined)
  chromeMock.tabs.goBack.mockResolvedValue(undefined); chromeMock.tabs.goForward.mockResolvedValue(undefined); chromeMock.tabs.reload.mockResolvedValue(undefined)
  chromeMock.tabs.captureVisibleTab.mockResolvedValue('data:image/png;base64,AA==')
  chromeMock.tabs.sendMessage.mockImplementation((_id: any, _message: any, cb?: Function) => response(null, cb))
  chromeMock.runtime.sendMessage.mockImplementation((_message: any, cb?: Function) => response({ success: false, error: 'Unavailable in test' }, cb))
  chromeMock.tabCapture.getMediaStreamId.mockImplementation((_opts: any, cb: Function) => cb('test-stream'))
  chromeMock.scripting.executeScript.mockImplementation(inject)
  Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent }, set(value) { this.textContent = value } })
  for (const key of ['offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight']) Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => 100 })
  HTMLElement.prototype.getBoundingClientRect = () => ({ width: 100, height: 30, top: 0, left: 0, right: 100, bottom: 30, x: 0, y: 0, toJSON() {} })
  HTMLElement.prototype.scrollIntoView = vi.fn()
  window.scrollTo = vi.fn(); window.scrollBy = vi.fn()
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { enumerateDevices: vi.fn().mockResolvedValue([]), addEventListener: vi.fn(), removeEventListener: vi.fn() } })
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined); HTMLMediaElement.prototype.pause = vi.fn()
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })
