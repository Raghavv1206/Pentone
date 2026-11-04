// Simple AI module with automatic context management & overflow recovery
import { TOOL_REGISTRY } from './tool-registry'
import { getSystemPrompt } from './prompts/system-prompt'
import { E2E_TEST_CONFIG } from './e2e-config'

let aiSession: any = null
let currentController: AbortController | null = null
let filledSystemPrompt: string | null = null
let isFirstPrompt = true

const getLanguageModelAPI = () =>
  (window as any).LanguageModel || 
  (window as any).ai?.languageModel || 
  (window as any).ai?.assistant

export function isContextExceededError(err: any): boolean {
  if (!err) return false
  const msg = (err.message || String(err)).toLowerCase()
  return (
    err.name === 'QuotaExceededError' ||
    msg.includes('exceeded the remaining available context') ||
    (msg.includes('context') && msg.includes('exceeded')) ||
    (msg.includes('quota') && msg.includes('exceeded'))
  )
}

export async function ensureSession(forceReset: boolean = false) {
  if (forceReset && aiSession) {
    try {
      aiSession.destroy?.()
    } catch {}
    aiSession = null
  }

  if (!aiSession) {
    const LM = getLanguageModelAPI()
    if (!LM) {
      throw new Error('AI model unavailable')
    }

    let availability: string | undefined
    try {
      if (typeof LM.availability === 'function') {
        availability = await LM.availability({
          expectedOutputs: [{ type: 'text', languages: ['en'] }],
          outputLanguage: 'en'
        })
      } else if (typeof LM.capabilities === 'function') {
        const caps = await LM.capabilities()
        availability = caps?.available
      }
    } catch {
      try {
        availability = await LM.availability?.({ outputLanguage: 'en' })
      } catch {
        availability = 'unavailable'
      }
    }

    if (availability === 'unavailable' || availability === 'no') {
      throw new Error('AI model unavailable')
    }
    
    // Fill template with runtime values
    const prompt = await getSystemPrompt()
    filledSystemPrompt = prompt
    
    console.log(`[AI] Initializing session with streamlined system prompt (${prompt.length} chars)`)

    // Preferred standard Prompt API: Pass systemPrompt as string alone (avoids duplicate tokens)
    try {
      aiSession = await LM.create({
        systemPrompt: prompt,
        outputLanguage: 'en'
      })
    } catch (e1) {
      console.warn('[AI] LM.create with outputLanguage failed, retrying with explicit language fallback:', e1)
      try {
        aiSession = await LM.create({
          systemPrompt: prompt,
          outputLanguage: 'en'
        })
      } catch (e2) {
        console.warn('[AI] LM.create with systemPrompt failed, falling back to initialPrompts:', e2)
        aiSession = await LM.create({
          initialPrompts: [{ role: 'system', content: prompt }],
          outputLanguage: 'en'
        })
      }
    }
  }
}

export async function streamResponse(
  message: string, 
  onChunk: (chunk: string) => void, 
  toolResult?: any,
  onWarmingUp?: () => void,
  onWarmupComplete?: () => void
): Promise<number> {
  await ensureSession()

  // Proactively check if session context is running out
  if (aiSession) {
    const tokensLeft = aiSession.tokensLeft
    const tokensSoFar = aiSession.tokensSoFar || aiSession.inputUsage || 0
    const maxTokens = aiSession.maxTokens || aiSession.inputQuota || 4096

    if ((typeof tokensLeft === 'number' && tokensLeft < 400) || (tokensSoFar > maxTokens * 0.8)) {
      console.log(`[AI] Context window nearly full (${tokensSoFar}/${maxTokens}, tokensLeft=${tokensLeft}). Cycling session...`)
      await ensureSession(true)
    }
  }
  
  // Notify warmup if this is the first prompt
  if (isFirstPrompt && onWarmingUp && !E2E_TEST_CONFIG.SKIP_WARMUP_PHASE) {
    console.log('[AI] First prompt - model warming up...')
    onWarmingUp()
  }
  
  let promptInput: any = message
  
  if (toolResult) {
    if (typeof toolResult === 'string' && toolResult.startsWith('data:image/')) {
      const response = await fetch(toolResult)
      const blob = await response.blob()

      promptInput = [{
        role: 'user',
        content: [
          { type: 'text', value: `${message}\n\nHere's the screenshot:` },
          { type: 'image', value: blob }
        ]
      }]
    } else if (typeof toolResult === 'string' && toolResult.startsWith('data:audio/')) {
      const response = await fetch(toolResult)
      const blob = await response.blob()

      promptInput = [{
        role: 'user',
        content: [
          { type: 'text', value: `${message}\n\nHere's the audio recording:` },
          { type: 'audio', value: blob }
        ]
      }]
    } else {
      promptInput = `${message}\n\nTool result: ${toolResult}`
    }
  }

  // Inner stream executor
  const runPromptStreaming = async (session: any, input: any) => {
    currentController = new AbortController()
    const stream = session.promptStreaming(input, { 
      signal: currentController.signal,
      outputLanguage: 'en'
    })
    
    let firstChunk = true
    for await (const chunk of stream) {
      if (firstChunk && isFirstPrompt && onWarmupComplete && !E2E_TEST_CONFIG.SKIP_WARMUP_PHASE) {
        console.log('[AI] Model warmup complete - first token received')
        onWarmupComplete()
        isFirstPrompt = false
        firstChunk = false
      } else if (firstChunk && isFirstPrompt && E2E_TEST_CONFIG.SKIP_WARMUP_PHASE) {
        isFirstPrompt = false
        firstChunk = false
      }
      onChunk(chunk)
    }
  }

  try {
    await runPromptStreaming(aiSession, promptInput)
  } catch (err: any) {
    if (isContextExceededError(err)) {
      console.warn('[AI] Context exceeded error detected. Auto-recovering session...', err)
      
      // Destroy overloaded session and build a fresh one
      destroySession()
      await ensureSession(true)

      // Trim input to safe boundary if user message was extremely large
      let recoveryInput = promptInput
      if (typeof recoveryInput === 'string' && recoveryInput.length > 2000) {
        recoveryInput = recoveryInput.substring(recoveryInput.length - 2000)
      }

      console.log('[AI] Retrying streaming with fresh session...')
      await runPromptStreaming(aiSession, recoveryInput)
    } else {
      throw err
    }
  }
  
  currentController = null
  
  const currentTokens = aiSession?.tokensSoFar || aiSession?.inputUsage || 0
  return currentTokens
}

export function interrupt() {
  if (currentController) {
    currentController.abort()
    currentController = null
  }
}

export function getTokenUsage() {
  if (!aiSession) {
    return { usage: 0, quota: 4096 }
  }
  
  const usage = aiSession.tokensSoFar ?? aiSession.inputUsage ?? 0
  const quota = aiSession.maxTokens ?? aiSession.inputQuota ?? 4096

  return {
    usage,
    quota
  }
}

export function destroySession() {
  if (aiSession) {
    try {
      aiSession.destroy?.()
    } catch {}
    aiSession = null
  }
  filledSystemPrompt = null
  isFirstPrompt = true
}

export function getFilledSystemPrompt(): string | null {
  return filledSystemPrompt
}
