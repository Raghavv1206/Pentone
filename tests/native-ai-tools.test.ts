import { test, expect, vi, afterEach } from 'vitest'
import { executeUITool } from '../lib/ui-tools'
const cases = [
  { name: 'translateText', api: 'Translator', method: 'translate', args: { text: 'Hello', sourceLanguage: 'en', targetLanguage: 'es' }, output: 'Hola' },
  { name: 'detectLanguage', api: 'LanguageDetector', method: 'detect', args: { text: 'Hello world' }, output: [{ detectedLanguage: 'en', confidence: 0.99 }] },
  { name: 'writeContent', api: 'Writer', method: 'write', args: { task: 'Write a greeting' }, output: 'Hello there' }
]
afterEach(() => { for (const item of cases) delete (window as any)[item.api] })
for (const item of cases) {
  test(`${item.name}: successful native session returns content and is destroyed`, async () => {
    const session = { [item.method]: vi.fn(async () => item.output), destroy: vi.fn() }
    ;(window as any)[item.api] = { availability: async () => 'available', create: async () => session }
    const result = await executeUITool({ function: item.name, arguments: item.args })
    expect(result.success).toBe(true); expect(result.result.length).toBeGreaterThan(0)
    expect(session[item.method]).toHaveBeenCalledTimes(1); expect(session.destroy).toHaveBeenCalledTimes(1)
  })
  test(`${item.name}: inference rejection also releases the session`, async () => {
    const session = { [item.method]: vi.fn().mockRejectedValue(new Error('Inference failed')), destroy: vi.fn() }
    ;(window as any)[item.api] = { availability: async () => 'available', create: async () => session }
    const result = await executeUITool({ function: item.name, arguments: item.args })
    expect(result.success).toBe(false); expect(session.destroy).toHaveBeenCalledTimes(1)
  })
}

test('concurrent auxiliary AI tasks use independent sessions and release them', async () => {
  const { promptLocalTask } = await import('../lib/local-ai-task')
  const sessions: any[] = []
  ;(window as any).LanguageModel = { availability: async () => 'available', create: vi.fn(async () => {
    const session = { prompt: vi.fn(async (text: string) => text), destroy: vi.fn() }
    sessions.push(session); return session
  }) }
  try {
    expect(await Promise.all([promptLocalTask('first task'), promptLocalTask('second task')])).toEqual(['first task', 'second task'])
    expect(sessions).toHaveLength(2)
    expect(sessions.every(session => session.destroy.mock.calls.length === 1)).toBe(true)
  } finally { delete (window as any).LanguageModel }
})
