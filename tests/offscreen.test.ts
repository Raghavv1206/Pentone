import { test, expect, vi, afterEach } from 'vitest'
import { chromeMock } from './setup'
import { ensureOffscreenDocument } from '../lib/offscreen'
afterEach(() => { delete chromeMock.offscreen; delete chromeMock.runtime.getContexts })
test('100 concurrent requests share one creation and await the ready listener', async () => {
  chromeMock.offscreen = { hasDocument: vi.fn(async () => false), createDocument: vi.fn(async () => {}) }
  chromeMock.runtime.sendMessage.mockRejectedValueOnce(new Error('Not ready')).mockResolvedValue({ alive: true })
  const results = await Promise.all(Array.from({ length: 100 }, () => ensureOffscreenDocument()))
  expect(results.every(Boolean)).toBe(true)
  expect(chromeMock.offscreen.createDocument).toHaveBeenCalledTimes(1)
  expect(chromeMock.runtime.sendMessage).toHaveBeenCalledTimes(2)
})
test('an existing offscreen document is probed without creating another', async () => {
  chromeMock.offscreen = { createDocument: vi.fn() }
  chromeMock.runtime.getContexts = vi.fn(async () => [{}])
  chromeMock.runtime.sendMessage.mockResolvedValue({ alive: true })
  expect(await ensureOffscreenDocument()).toBe(true)
  expect(chromeMock.offscreen.createDocument).not.toHaveBeenCalled()
})
test('failed startup does not permanently block a retry', async () => {
  chromeMock.offscreen = { createDocument: vi.fn().mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue(undefined) }
  expect(await ensureOffscreenDocument()).toBe(false)
  chromeMock.runtime.sendMessage.mockResolvedValue({ alive: true })
  expect(await ensureOffscreenDocument()).toBe(true)
})
