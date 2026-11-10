import React from 'react'
import { test, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { TTSProvider, useTTS } from '../lib/tts-context'
const voice = { voiceURI: 'local-test', name: 'Test English', lang: 'en-US', localService: true, default: true } as SpeechSynthesisVoice
let spoken: any[] = []
beforeEach(() => {
  spoken = []; vi.useFakeTimers()
  vi.stubGlobal('SpeechSynthesisUtterance', class { text: string; constructor(text: string) { this.text = text } })
  vi.stubGlobal('speechSynthesis', { getVoices: () => [voice], addEventListener: vi.fn(), removeEventListener: vi.fn(), cancel: vi.fn(),
    speak: vi.fn((utterance: any) => { spoken.push(utterance) }), resume: vi.fn(), pause: vi.fn(), speaking: true, paused: false })
})
const wrapper = ({ children }: any) => <TTSProvider>{children}</TTSProvider>
test('100 queued utterances drain in order without lingering timers', async () => {
  const { result } = renderHook(() => useTTS(), { wrapper })
  await act(async () => {})
  act(() => { for (let i = 0; i < 100; i++) result.current.handleNewText(`Sentence number ${i}.`, true) })
  let ready = false
  const pending = result.current.waitUntilReady().then(() => { ready = true })
  expect(ready).toBe(false)
  for (let i = 0; i < 100; i++) act(() => { spoken[i].onend() })
  await pending
  expect(spoken).toHaveLength(100); expect(result.current.queueLength).toBe(0)
  expect(result.current.isSpeaking).toBe(false); expect(vi.getTimerCount()).toBe(0)
})
test('old speech events cannot clear a new queue; unmount releases waiters', async () => {
  const { result, unmount } = renderHook(() => useTTS(), { wrapper })
  await act(async () => {})
  act(() => result.current.speak('Old sentence.'))
  const oldEnd = spoken[0].onend, oldError = spoken[0].onerror
  act(() => result.current.speak('New sentence.'))
  act(() => { oldEnd(); oldError({ error: 'interrupted' }) })
  expect(result.current.isSpeaking).toBe(true)
  const pending = result.current.waitUntilReady()
  unmount(); await pending
  expect(vi.getTimerCount()).toBe(0)
})
test('stopping a voice preview resolves its promise and removes timeout', async () => {
  const { result } = renderHook(() => useTTS(), { wrapper })
  await act(async () => {})
  let preview: Promise<boolean>
  act(() => { preview = result.current.previewVoice('local-test') })
  act(() => result.current.stop())
  expect(await preview!).toBe(false); expect(vi.getTimerCount()).toBe(0)
})
