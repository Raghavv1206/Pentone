import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
const device = vi.hoisted(() => ({ id: 'default', locale: 'en-US' }))
vi.mock('../lib/media-device-context', () => ({ useMediaDevice: () => ({ selectedMicId: device.id }) }))
vi.mock('../lib/voice-selector', () => ({ getRecommendedSpeechLocale: () => device.locale }))
import { useSpeechRecognition } from '../lib/use-speech-recognition'
let instances: any[] = []
beforeEach(() => {
  device.id = 'default'; device.locale = 'en-US'; instances = []
  ;(window as any).SpeechRecognition = class {
    processLocally = false
    static available = vi.fn(async () => 'available')
    static install = vi.fn(async () => true)
    start = vi.fn(); stop = vi.fn(); abort = vi.fn()
    constructor() { instances.push(this) }
  }
})
afterEach(() => { delete (window as any).SpeechRecognition })

test('local recognition is required and is never replaced with online recognition', async () => {
  const { result } = renderHook(() => useSpeechRecognition())
  ;(window as any).SpeechRecognition.available.mockResolvedValue('unavailable')
  await expect(result.current.startListening()).rejects.toMatchObject({ name: 'SpeechSetupNotice' })
  expect(instances[0].processLocally).toBe(true); expect(instances[0].start).not.toHaveBeenCalled()
  ;(window as any).SpeechRecognition = class { start = vi.fn() }
  await expect(result.current.startListening()).rejects.toMatchObject({ name: 'SpeechSetupNotice' })
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

test('the microphone installs a missing local pack and starts using the selected locale', async () => {
  device.locale = 'en-IN'
  let installed = false
  const api = (window as any).SpeechRecognition
  api.available.mockImplementation(async () => installed ? 'available' : 'downloadable')
  api.install.mockImplementation(async () => { installed = true; return true })
  const { result } = renderHook(() => useSpeechRecognition())
  await act(async () => result.current.startListening())
  expect(api.install).toHaveBeenCalledExactlyOnceWith({ langs: ['en-IN'], processLocally: true })
  expect(instances[0].lang).toBe('en-IN'); expect(instances[0].processLocally).toBe(true)
  expect(instances[0].start).toHaveBeenCalledTimes(1)
  act(() => instances[0].onstart())
  expect(result.current.isStarting).toBe(false); expect(result.current.speechStatus).toBeNull()
})

test('stopping during installation never starts a late microphone session', async () => {
  const api = (window as any).SpeechRecognition
  let finish: (v: boolean) => void = () => {}
  api.available.mockResolvedValue('downloadable')
  api.install.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const { result } = renderHook(() => useSpeechRecognition())
  let starting: Promise<void>
  await act(async () => { starting = result.current.startListening() })
  expect(result.current.isStarting).toBe(true)
  expect(result.current.speechStatus).toContain('Downloading')
  await act(async () => result.current.stopListening())
  await act(async () => { finish(true); await starting! })
  expect(instances[0].start).not.toHaveBeenCalled()
  expect(result.current.isStarting).toBe(false)
})

test('duplicate starts while setup is pending create only one recognizer', async () => {
  const api = (window as any).SpeechRecognition
  let finish: (v: string) => void = () => {}
  api.available.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const { result } = renderHook(() => useSpeechRecognition())
  let starting: Promise<void>
  await act(async () => { starting = result.current.startListening(); await result.current.startListening() })
  await act(async () => { finish('available'); await starting! })
  expect(instances).toHaveLength(1); expect(instances[0].start).toHaveBeenCalledTimes(1)
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
