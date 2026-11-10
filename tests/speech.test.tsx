import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
const device = vi.hoisted(() => ({ id: 'default' }))
vi.mock('../lib/media-device-context', () => ({ useMediaDevice: () => ({ selectedMicId: device.id }) }))
vi.mock('../lib/voice-selector', () => ({ getRecommendedSpeechLocale: () => 'en-US' }))
import { useSpeechRecognition } from '../lib/use-speech-recognition'
let instances: any[] = []
beforeEach(() => {
  device.id = 'default'; instances = []
  ;(window as any).SpeechRecognition = class {
    processLocally = false
    static available = vi.fn(async () => 'available')
    start = vi.fn(); stop = vi.fn(); abort = vi.fn()
    constructor() { instances.push(this) }
  }
})
afterEach(() => { delete (window as any).SpeechRecognition })

test('local recognition is required and is never replaced with online recognition', async () => {
  const { result } = renderHook(() => useSpeechRecognition())
  ;(window as any).SpeechRecognition.available.mockResolvedValue('unavailable')
  await expect(result.current.startListening()).rejects.toThrow('on-device speech language pack')
  expect(instances[0].processLocally).toBe(true); expect(instances[0].start).not.toHaveBeenCalled()
  ;(window as any).SpeechRecognition = class { start = vi.fn() }
  await expect(result.current.startListening()).rejects.toThrow('On-device speech recognition is unavailable')
})

test('stopping while local availability is pending never starts recognition', async () => {
  let release: Function = () => {}
  ;(window as any).SpeechRecognition.available.mockImplementation(() => new Promise(resolve => { release = resolve }))
  const { result } = renderHook(() => useSpeechRecognition())
  const start = result.current.startListening()
  await act(async () => result.current.stopListening())
  await act(async () => { release('available'); await start })
  expect(instances[0].start).not.toHaveBeenCalled()
})
test('permission errors reach the caller and never submit partial transcripts', async () => {
  const { result } = renderHook(() => useSpeechRecognition())
  const end = vi.fn(), error = vi.fn()
  await act(async () => result.current.startListening(end, error))
  act(() => instances[0].onstart())
  act(() => instances[0].onerror({ error: 'not-allowed' }))
  act(() => instances[0].onend())
  expect(result.current.isListening).toBe(false)
  expect(error).toHaveBeenCalledWith(expect.objectContaining({ name: 'MicrophonePermissionError' }))
  expect(end).not.toHaveBeenCalled()
})
test('late recognition events cannot stop a newer recording', async () => {
  const { result, unmount } = renderHook(() => useSpeechRecognition())
  await act(async () => result.current.startListening())
  const oldEnd = instances[0].onend
  await act(async () => result.current.stopListening())
  await act(async () => result.current.startListening())
  act(() => instances[1].onstart())
  act(() => oldEnd())
  expect(result.current.isListening).toBe(true)
  unmount(); expect(instances[1].abort).toHaveBeenCalledTimes(1)
})
test('selected microphone track is passed to speech recognition and released on stop', async () => {
  device.id = 'usb-mic'
  const track = { readyState: 'live', stop: vi.fn() }
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] }
  navigator.mediaDevices.getUserMedia = vi.fn().mockResolvedValue(stream)
  const { result } = renderHook(() => useSpeechRecognition())
  await act(async () => result.current.startListening())
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: 'usb-mic' } }, video: false })
  expect(instances[0].start).toHaveBeenCalledWith(track)
  await act(async () => result.current.stopListening())
  expect(track.stop).toHaveBeenCalledTimes(1)
})
test('stopping during microphone permission prompt releases late tracks', async () => {
  device.id = 'usb-mic'
  let release: Function = () => {}
  navigator.mediaDevices.getUserMedia = vi.fn().mockImplementation(() => new Promise(resolve => { release = resolve }))
  const track = { readyState: 'live', stop: vi.fn() }
  const { result } = renderHook(() => useSpeechRecognition())
  let start: Promise<void>
  act(() => { start = result.current.startListening() })
  await act(async () => {})
  await act(async () => result.current.stopListening())
  await act(async () => { release({ getTracks: () => [track], getAudioTracks: () => [track] }); await start! })
  expect(instances[0].start).not.toHaveBeenCalled(); expect(track.stop).toHaveBeenCalledTimes(1)
})
