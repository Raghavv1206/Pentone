import React from 'react'
import { test, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { chromeMock, data, seed } from './setup'
const mocks = vi.hoisted(() => ({ execute: vi.fn(), stream: vi.fn(), speak: vi.fn(), start: vi.fn(), stop: vi.fn(), alert: vi.fn(), listening: false, starting: false }))
vi.mock('../lib/ai', () => ({ streamResponse: mocks.stream, getTokenUsage: () => ({ usage: 0, quota: 4096 }), destroySession: vi.fn(), interrupt: vi.fn(), getFilledSystemPrompt: () => '', preloadModel: vi.fn(async () => true), setConversationContext: vi.fn() }))
vi.mock('../lib/tools', () => ({ executeTool: mocks.execute, detectInvalidToolFormat: () => null, parseToolCall: (text: string) => { const match = text.match(/<function_call>(.*?)<\/function_call>/s); return match ? JSON.parse(match[1]) : null } }))
vi.mock('../lib/tool-registry', () => ({ getToolSpec: () => ({}), getSpokenLine: () => 'Working' }))
vi.mock('../lib/ui-tools', () => ({ executeUITool: vi.fn(), validateUITools: vi.fn() }))
vi.mock('../lib/tts-context', () => ({ useTTS: () => ({ waitUntilReady: async () => {}, handleNewText: mocks.speak, stop: vi.fn() }) }))
vi.mock('../lib/use-sound-effects', () => ({ useSoundEffects: () => ({ play: vi.fn() }) }))
vi.mock('../lib/prompts/system-prompt', () => ({ getMemoryReminder: async () => '', getActiveTabHeader: async () => '' }))
vi.mock('../lib/intent-detector', () => ({ detectIntents: (text: string) => text === 'two actions' ? [1, 2].map(i => ({ confirmationText: 'Working', toolCall: { function: `tool${i}`, arguments: {} } })) : [], isModelRefusal: () => false, isCreatorQuestion: () => false }))
vi.mock('../lib/ui-test-runner', () => ({ checkForTestTrigger: () => false, getNextTestChunk: vi.fn(), getTestStepDelay: () => 0 }))
vi.mock('../lib/use-speech-recognition', () => ({ useSpeechRecognition: () => ({ isListening: mocks.listening, isStarting: mocks.starting, speechStatus: mocks.starting ? 'Downloading local speech' : null, transcript: '', startListening: mocks.start, stopListening: mocks.stop }) }))
vi.mock('../lib/alert-context', () => ({ useAlert: () => ({ showAlert: mocks.alert }), openPermissionsPage: vi.fn(), openAIFlagsPage: vi.fn() }))
import { ChatProvider, useChatContext } from '../lib/chat-context'
import { useVoiceInput } from '../lib/use-voice-input'
import { SpeechSetupNotice } from '../lib/local-speech'
const wrapper = ({ children }: any) => <ChatProvider>{children}</ChatProvider>
beforeEach(() => {
  mocks.listening = false; mocks.starting = false; mocks.start.mockResolvedValue(undefined); mocks.stop.mockResolvedValue('')
  mocks.stream.mockImplementation(async (_text, chunk) => { chunk('Finished'); return 1 })
  mocks.execute.mockResolvedValue({ success: true, result: 'Done' })
})
test('does not erase stored chat before async hydration finishes', async () => {
  const saved = [{ id: 'saved', role: 'user', content: 'Keep this', contextCount: 0 }]
  seed({ chat_messages: saved })
  let release: Function = () => {}
  chromeMock.storage.local.get.mockImplementationOnce((_keys: any, cb: Function) => { release = () => cb({ chat_messages: saved }) })
  const { result } = renderHook(() => useChatContext(), { wrapper })
  await new Promise(resolve => setTimeout(resolve, 200))
  expect(data.chat_messages).toEqual(saved)
  await act(async () => release())
  expect(result.current.state.messages[0].content).toBe('Keep this')
})
test.each(['stop', 'reset'])('%s while first tool is pending prevents the second action', async mode => {
  let finish: Function = () => {}
  mocks.execute.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const { result } = renderHook(() => useChatContext(), { wrapper })
  await waitFor(() => expect(result.current.isInitialLoadComplete).toBe(true))
  let running: Promise<void>
  act(() => { running = result.current.sendMessage('two actions') })
  await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1))
  act(() => mode === 'stop' ? result.current.interruptChat() : result.current.resetChat())
  await act(async () => { finish({ success: true, result: 'late result' }); await running! })
  expect(mocks.execute).toHaveBeenCalledTimes(1)
  expect(result.current.state.messages.some(m => m.content.includes('late result'))).toBe(false)
  expect(result.current.state.isProcessing).toBe(false)
})
test('a cancelled task cannot clear flags belonging to a new task', async () => {
  let finishOld: Function = () => {}, finishNew: Function = () => {}
  mocks.execute.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
  const { result } = renderHook(() => useChatContext(), { wrapper })
  await waitFor(() => expect(result.current.isInitialLoadComplete).toBe(true))
  let oldTask: Promise<void>, newTask: Promise<void>
  act(() => { oldTask = result.current.sendMessage('two actions') })
  await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1))
  act(() => result.current.interruptChat())
  mocks.stream.mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve }))
  act(() => { newTask = result.current.sendMessage('new request') })
  await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(1))
  await act(async () => { finishOld({ success: true, result: 'late' }); await oldTask! })
  expect(result.current.state.isProcessing).toBe(true)
  await act(async () => { finishNew(0); await newTask! })
})
test('microphone click starts recognition once and reports async startup errors', async () => {
  const { result } = renderHook(() => useVoiceInput(), { wrapper })
  await act(async () => { await result.current.handleMicClick() })
  expect(mocks.start).toHaveBeenCalledTimes(1)
  await act(async () => { await result.current.handleMicClick() })
  expect(mocks.start).toHaveBeenCalledTimes(1)
  await new Promise(resolve => setTimeout(resolve, 170))
  mocks.start.mockRejectedValueOnce(new Error('Microphone startup failed'))
  await act(async () => { await result.current.handleMicClick() })
  expect(mocks.alert).toHaveBeenCalledWith('error', 'Error', 'Microphone startup failed')
})

test('expected speech setup states show an informational retry instead of a generic error', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.start.mockRejectedValueOnce(new SpeechSetupNotice('Click to finish local speech setup', 'en-IN'))
  const { result } = renderHook(() => useVoiceInput(), { wrapper })
  await act(async () => result.current.startVoiceInput())
  expect(mocks.alert).toHaveBeenCalledWith('info', 'Microphone setup', 'Click to finish local speech setup', expect.objectContaining({ label: 'Set up microphone' }))
  expect(log).not.toHaveBeenCalled()
  await act(async () => { mocks.alert.mock.calls[0][3].onClick() })
  expect(mocks.start).toHaveBeenLastCalledWith(expect.any(Function), expect.any(Function), { installLocale: 'en-IN' })
  log.mockRestore()
})

test('the mic can cancel setup while the original start promise is pending', async () => {
  let finish: Function = () => {}
  mocks.start.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const { result, rerender } = renderHook(() => useVoiceInput(), { wrapper })
  let pending: unknown
  act(() => { pending = result.current.handleMicClick() })
  mocks.starting = true; rerender()
  await act(async () => result.current.handleMicClick())
  expect(mocks.stop).toHaveBeenCalledTimes(1)
  await act(async () => { finish(); await pending })
})
