import { test, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
const mocks = vi.hoisted(() => ({ create: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() }))
vi.mock('@picovoice/porcupine-web', () => ({ PorcupineWorker: { create: mocks.create }, BuiltInKeyword: { Porcupine: 'Porcupine' } }))
vi.mock('@picovoice/web-voice-processor', () => ({ WebVoiceProcessor: { subscribe: mocks.subscribe, unsubscribe: mocks.unsubscribe } }))
import { useWakeWord } from '../lib/use-wake-word'
import { useWakeWordBuiltIn } from '../lib/use-wake-word-builtin'
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) })))
  mocks.subscribe.mockResolvedValue(undefined); mocks.unsubscribe.mockResolvedValue(undefined)
})
for (const [name, hook] of [['custom', useWakeWord], ['built-in', useWakeWordBuiltIn]] as const) {
  test(`${name}: late worker creation after stop is terminated without acquiring the microphone`, async () => {
    let complete: Function = () => {}
    const worker = { terminate: vi.fn() }
    mocks.create.mockImplementation(() => new Promise(resolve => { complete = resolve }))
    const { result } = renderHook(() => hook())
    let starting: Promise<void>
    await act(async () => { starting = result.current.start('test-key') })
    expect(mocks.create).toHaveBeenCalledTimes(1)
    await act(async () => result.current.stop())
    await act(async () => { complete(worker); await starting! })
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(mocks.subscribe).not.toHaveBeenCalled(); expect(result.current.isListening).toBe(false)
  })
  test(`${name}: successful start/stop releases the worker and microphone`, async () => {
    const worker = { terminate: vi.fn() }
    mocks.create.mockResolvedValue(worker)
    const { result } = renderHook(() => hook())
    await act(async () => result.current.start('test-key'))
    expect(result.current.isListening).toBe(true)
    await act(async () => result.current.stop())
    expect(mocks.unsubscribe).toHaveBeenCalledWith(worker)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(result.current.isListening).toBe(false)
  })
}
