// Simple AI module
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

async function ensureSession() {
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
        availability = await LM.availability?.()
      } catch {
        availability = 'unavailable'
      }
    }

    if (availability === 'unavailable' || availability === 'no') {
      throw new Error('AI model unavailable')
    }
    
    // Fill template with runtime values (now async to load memories)
    const prompt = await getSystemPrompt()
    
    // Store the filled prompt for debugging
    filledSystemPrompt = prompt
    
    console.log('System prompt loaded with', TOOL_REGISTRY.length, 'tools')

    try {
      aiSession = await LM.create({
        initialPrompts: [{ role: 'system', content: prompt }],
        systemPrompt: prompt,
        expectedInputs: [
          { type: 'text', languages: ['en'] },
          { type: 'image' },
          { type: 'audio' }
        ],
        expectedOutputs: [
          { type: 'text', languages: ['en'] }
        ],
        outputLanguage: 'en'
      })
    } catch (createErr) {
      console.warn('[AI] create with expectedOutputs failed, trying fallback:', createErr)
      try {
        aiSession = await LM.create({
          initialPrompts: [{ role: 'system', content: prompt }],
          outputLanguage: 'en'
        })
      } catch {
        aiSession = await LM.create({
          initialPrompts: [{ role: 'system', content: prompt }]
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
  
  // Notify warmup if this is the first prompt (the actual slow part)
  if (isFirstPrompt && onWarmingUp && !E2E_TEST_CONFIG.SKIP_WARMUP_PHASE) {
    console.log('[AI] First prompt - model warming up...')
    onWarmingUp()
  }
  
  currentController = new AbortController()
  
  let promptInput: any = message
  
  if (toolResult) {
    // Check if tool result is an image (data URL)
    if (typeof toolResult === 'string' && toolResult.startsWith('data:image/')) {
      // Convert data URL to blob for multimodal input
      const response = await fetch(toolResult)
      const blob = await response.blob()

      promptInput = [{
        role: 'user',
        content: [
          { type: 'text', value: `${message}\n\nHere's the screenshot:` },
          { type: 'image', value: blob }
        ]
      }]
    }
    // Check if tool result is audio (data URL)
    else if (typeof toolResult === 'string' && toolResult.startsWith('data:audio/')) {
      // Convert data URL to blob for multimodal input
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
  
  const stream = aiSession.promptStreaming(promptInput, { 
    signal: currentController.signal,
    outputLanguage: 'en'
  })
  
  let firstChunk = true
  for await (const chunk of stream) {
    // Notify warmup complete on first token
    if (firstChunk && isFirstPrompt && onWarmupComplete && !E2E_TEST_CONFIG.SKIP_WARMUP_PHASE) {
      console.log('[AI] Model warmup complete - first token received')
      onWarmupComplete()
      isFirstPrompt = false
      firstChunk = false
    } else if (firstChunk && isFirstPrompt && E2E_TEST_CONFIG.SKIP_WARMUP_PHASE) {
      // Skip warmup callbacks but still mark first prompt as done
      isFirstPrompt = false
      firstChunk = false
    }
    onChunk(chunk)
  }
  
  currentController = null
  
  // Return context count after completion
  console.log('DEBUG: Stream completed, checking token usage')
  console.log('DEBUG: aiSession.inputUsage after completion:', aiSession.inputUsage)
  console.log('DEBUG: aiSession.inputQuota after completion:', aiSession.inputQuota)
  
  return aiSession.inputUsage || 0
}

export function interrupt() {
  if (currentController) {
    currentController.abort()
    currentController = null
  }
}

export function getTokenUsage() {
  console.log('DEBUG: getTokenUsage called')
  console.log('DEBUG: aiSession exists:', !!aiSession)
  
  if (!aiSession) {
    console.log('DEBUG: No session, returning 0')
    return { usage: 0, quota: 9216 }
  }
  
  console.log('DEBUG: aiSession.inputUsage:', aiSession.inputUsage)
  console.log('DEBUG: aiSession.inputQuota:', aiSession.inputQuota)
  
  return {
    usage: aiSession.inputUsage || 0,
    quota: aiSession.inputQuota || 9216
  }
}

export function destroySession() {
  if (aiSession) {
    aiSession.destroy()
    aiSession = null
  }
  filledSystemPrompt = null
  // Reset first prompt flag so next prompt will trigger warmup
  isFirstPrompt = true
}

export function getFilledSystemPrompt(): string | null {
  return filledSystemPrompt
}
