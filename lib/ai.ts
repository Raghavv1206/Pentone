// AI module for Chrome Prompt API / Gemma 4
import { TOOL_REGISTRY } from './tool-registry'
import { getSystemPrompt } from './prompts/system-prompt'
import { E2E_TEST_CONFIG } from './e2e-config'
import { checkPromptAPIAvailability, createResilientSession } from './ai-config'

let aiSession: any = null
let isMultimodalSession = false
let currentController: AbortController | null = null
let filledSystemPrompt: string | null = null
let isFirstPrompt = true
let sessionCreationPromise: Promise<any> | null = null

async function ensureSession(requireMultimodal = false): Promise<any> {
  // If session exists with required modality, return immediately
  if (aiSession && (!requireMultimodal || isMultimodalSession)) {
    return aiSession
  }

  // If a session creation is already in flight, wait for it
  if (sessionCreationPromise) {
    await sessionCreationPromise
    if (aiSession && (!requireMultimodal || isMultimodalSession)) {
      return aiSession
    }
  }

  // Concurrency-protected session creation
  sessionCreationPromise = (async () => {
    try {
      const prompt = await getSystemPrompt()
      filledSystemPrompt = prompt

      // Case 1: Multimodal session requested
      if (requireMultimodal) {
        console.log('[AI] Checking multimodal Prompt API availability...')
        const multiAvail = await checkPromptAPIAvailability({ multimodal: true })

        if (multiAvail === 'available' || multiAvail === 'readily') {
          try {
            console.log('[AI] Attempting multimodal LanguageModel session creation...')
            const newSession = await createResilientSession({
              initialPrompt: prompt,
              multimodal: true
            })

            // Multimodal session created successfully: safely swap and destroy old session
            const oldSession = aiSession
            aiSession = newSession
            isMultimodalSession = true

            if (oldSession && oldSession !== newSession) {
              try {
                oldSession.destroy()
              } catch (e) {
                console.warn('[AI] Error destroying old session after multimodal swap:', e)
              }
            }
            console.log('[AI] Multimodal session active and verified')
            return aiSession
          } catch (createErr: any) {
            console.warn('[AI] Multimodal session creation failed on device, preserving text session:', createErr?.message)
            // Do not throw: preserve working text session or fall through to create one
          }
        } else {
          console.warn('[AI] Multimodal Prompt API reports status:', multiAvail, '- falling back to text session')
        }

        // If multimodal creation failed or was unavailable, preserve existing working text session
        if (aiSession && !isMultimodalSession) {
          console.log('[AI] Preserving active text session for webpage text/DOM fallback')
          return aiSession
        }
      }

      // Case 2: Standard text session (or fallback if multimodal failed and no session exists)
      if (!aiSession) {
        console.log('[AI] Checking text Prompt API availability...')
        const textAvail = await checkPromptAPIAvailability({ multimodal: false })
        if (textAvail === 'no' || textAvail === 'unavailable') {
          throw new Error('AI model is unavailable or disabled in Chrome. If it recently crashed, restart Chrome via chrome://restart.')
        }

        console.log('[AI] Creating standard text LanguageModel session...')
        aiSession = await createResilientSession({
          initialPrompt: prompt,
          multimodal: false
        })
        isMultimodalSession = false
        console.log('[AI] Text session created and active')
      }

      return aiSession
    } finally {
      sessionCreationPromise = null
    }
  })()

  return await sessionCreationPromise
}

export async function streamResponse(
  message: string, 
  onChunk: (chunk: string) => void, 
  toolResult?: any,
  onWarmingUp?: () => void,
  onWarmupComplete?: () => void
): Promise<number> {
  const isImageResult = typeof toolResult === 'string' && toolResult.startsWith('data:image/')
  await ensureSession(isImageResult)
  
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
      if (isMultimodalSession) {
        try {
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
          console.log('[AI] Dispatched multimodal image payload to LLM session')
        } catch (err) {
          console.warn('[AI] Failed to convert image blob, falling back to text prompt:', err)
          promptInput = `${message}\n\n[Screenshot captured successfully from tab. On-device image analysis unavailable; analyze based on webpage context and elements above.]`
        }
      } else {
        // Text session fallback: provide context without breaking the session
        console.log('[AI] Session is text-only; continuing with webpage context and elements fallback')
        promptInput = `${message}\n\n[Screenshot captured successfully from tab. On-device image analysis is unavailable on this device; analyze the webpage using the current context and elements above.]`
      }
    }
    // Check if tool result is audio (data URL)
    else if (typeof toolResult === 'string' && toolResult.startsWith('data:audio/')) {
      // Chrome 156 local Gemma 4 model does not accept direct audio stream modality.
      // Pass the audio event representation cleanly as text context.
      promptInput = `${message}\n\n[Audio recording captured from tab successfully]`
    } else {
      promptInput = `${message}\n\nTool result: ${typeof toolResult === 'object' ? JSON.stringify(toolResult) : toolResult}`
    }
  }
  
  const stream = aiSession.promptStreaming(promptInput, { signal: currentController.signal })
  
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
  console.log('[AI] Stream completed, checking token usage')
  console.log('[AI] aiSession.inputUsage after completion:', aiSession?.inputUsage)
  console.log('[AI] aiSession.inputQuota after completion:', aiSession?.inputQuota)
  
  return aiSession?.inputUsage || 0
}

export function interrupt() {
  if (currentController) {
    currentController.abort()
    currentController = null
  }
}

export function getTokenUsage() {
  if (!aiSession) {
    return { usage: 0, quota: 9216 }
  }
  
  return {
    usage: aiSession.inputUsage || 0,
    quota: aiSession.inputQuota || 9216
  }
}

export function destroySession() {
  if (aiSession) {
    try {
      aiSession.destroy()
    } catch (e) {
      console.warn('[AI] Error destroying aiSession:', e)
    }
    aiSession = null
  }
  isMultimodalSession = false
  sessionCreationPromise = null
  filledSystemPrompt = null
  isFirstPrompt = true
}

export function getFilledSystemPrompt(): string | null {
  return filledSystemPrompt
}
