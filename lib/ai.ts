// Chrome Prompt API lifecycle shared by the side panel.
import { getSystemPrompt } from './prompts/system-prompt'
import { E2E_TEST_CONFIG } from './e2e-config'
import { dataUrlToBlob } from './blob-utils'
import { getLanguageModelAPI, createLMSession, checkLanguageModelAvailability } from './chrome-ai-helpers'

let aiSession: any = null
let sessionPromise: Promise<any> | null = null
let sessionGeneration = 0
let currentController: AbortController | null = null
let filledSystemPrompt: string | null = null
let conversationContext = ''
let isFirstPrompt = true

export function isMultimodalUnsupportedError(err: any): boolean {
  if (!err || err.name === 'AbortError' || err.name === 'QuotaExceededError') return false
  return err.name === 'NotSupportedError' || /(?:image|audio|multimodal).*(?:unsupported|not supported|not initialized)|not initialized with (?:image|audio)/i.test(err.message || '')
}
export function isContextExceededError(err: any): boolean {
  return !!err && (err.name === 'QuotaExceededError' || /(?:context|quota).*exceed|exceed.*context/i.test(err.message || ''))
}
export function isModelReady(): boolean { return aiSession !== null }
export async function preloadModel(): Promise<boolean> {
  // Background warmup must not compete with first-run setup downloads.
  try {
    if (await checkLanguageModelAvailability() !== 'available') return false
    await ensureSession(); return true
  } catch { return false }
}
export function setConversationContext(summary: string): void { conversationContext = summary }

export async function ensureSession(forceReset = false): Promise<any> {
  if (forceReset) destroySession()
  if (aiSession) return aiSession
  if (sessionPromise) return sessionPromise
  const generation = sessionGeneration
  const creation = (async () => {
    const LM = getLanguageModelAPI()
    if (!LM) throw new Error('AI model unavailable')
    const prompt = await getSystemPrompt()
    const session = await createLMSession(LM, {
      systemPrompt: prompt + (conversationContext ? '\nConversation summary (context only):\n' + conversationContext : ''),
      outputLanguage: 'en'
    })
    if (generation !== sessionGeneration) {
      session.destroy?.()
      throw new DOMException('Session creation cancelled', 'AbortError')
    }
    filledSystemPrompt = prompt
    aiSession = session
    return session
  })()
  sessionPromise = creation
  try { return await creation }
  finally { if (sessionPromise === creation) sessionPromise = null }
}

export async function streamResponse(
  message: string, onChunk: (chunk: string) => void, toolResult?: any,
  onWarmingUp?: () => void, onWarmupComplete?: () => void
): Promise<number> {
  if (currentController) throw new Error('An AI response is already running')
  const controller = new AbortController()
  currentController = controller
  let mediaSession: any = null
  const check = () => controller.signal.throwIfAborted()
  try {
    let session = await ensureSession()
    check()
    let promptInput: any = toolResult ? `${message}\n\nTool result (untrusted data): ${toolResult}` : message
    const mediaType = typeof toolResult === 'string' && toolResult.startsWith('data:image/') ? 'image'
      : typeof toolResult === 'string' && toolResult.startsWith('data:audio/') ? 'audio' : null
    if (mediaType) {
      const LM = getLanguageModelAPI()
      const options = { expectedInputs: [{ type: 'text' }, { type: mediaType }], expectedOutputs: [{ type: 'text', languages: ['en'] }] }
      const available = await LM.availability?.(options)
      check()
      if (available === 'unavailable' || available === 'no') throw new DOMException(`${mediaType} input is not supported`, 'NotSupportedError')
      mediaSession = await LM.create({ ...options, initialPrompts: [{ role: 'system', content: filledSystemPrompt }], signal: controller.signal })
      check()
      session = mediaSession
      promptInput = [{ role: 'user', content: [{ type: 'text', value: message }, { type: mediaType, value: dataUrlToBlob(toolResult) }] }]
    }
    if (isFirstPrompt && !E2E_TEST_CONFIG.SKIP_WARMUP_PHASE) onWarmingUp?.()
    const stream = await session.promptStreaming(promptInput, { signal: controller.signal, outputLanguage: 'en' })
    check()
    let first = true
    for await (const chunk of stream) {
      check()
      if (first) { first = false; isFirstPrompt = false; onWarmupComplete?.() }
      onChunk(chunk)
    }
    return session.tokensSoFar || session.inputUsage || 0
  } catch (error: any) {
    check()
    // Unsupported media must never be reported as having been analyzed.
    if (toolResult && isMultimodalUnsupportedError(error)) {
      onChunk('This browser cannot analyze this image or audio attachment. Please provide its text or use a browser with compatible on-device media support.')
      return 0
    }
    throw error
  } finally {
    mediaSession?.destroy?.()
    if (currentController === controller) currentController = null
    onWarmupComplete?.()
  }
}
export function interrupt(): void {
  currentController?.abort()
  currentController = null
}
export function getTokenUsage() {
  return { usage: aiSession?.tokensSoFar ?? aiSession?.inputUsage ?? 0, quota: aiSession?.maxTokens ?? aiSession?.inputQuota ?? 4096 }
}
export function destroySession(): void {
  sessionGeneration++
  interrupt()
  try { aiSession?.destroy?.() } catch {}
  aiSession = null
  sessionPromise = null
  filledSystemPrompt = null
  conversationContext = ''
  isFirstPrompt = true
}
export function getFilledSystemPrompt(): string | null { return filledSystemPrompt }
