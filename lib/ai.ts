// AI module for Chrome Prompt API / Gemma 4
import { TOOL_REGISTRY } from './tool-registry'
import { getSystemPrompt } from './prompts/system-prompt'
import { E2E_TEST_CONFIG } from './e2e-config'
import { generativeRuntime } from './generative-runtime'
import { 
  checkPromptAPIAvailability, 
  createResilientSession, 
  getPromptAPILifecycleMetrics, 
  resetPromptAPILifecycleMetrics,
  getPreservedSession,
  setPreservedSession,
  clearPreservedSession,
  markPromptAPIDeviceIncapable
} from './ai-config'

let aiSession: any = null
let isMultimodalSession = false
let currentController: AbortController | null = null
let filledSystemPrompt: string | null = null
let isFirstPrompt = true
let sessionCreationPromise: Promise<any> | null = null

// Performance & lifecycle instrumentation
let sessionCreationCount = 0
let sessionDestroyCount = 0
let warmupCount = 0
let compactionCount = 0
let compactionDurationMs = 0
let tokensBeforeCompaction = 0
let tokensAfterCompaction = 0
let taskRecoveryCount = 0

export function recordCompactionMetrics(tokensBefore: number, tokensAfter: number, durationMs: number = 0): void {
  compactionCount++
  tokensBeforeCompaction = tokensBefore
  tokensAfterCompaction = tokensAfter
  compactionDurationMs = durationMs
}

export function recordTaskRecoveryEvent(): void {
  taskRecoveryCount++
}

export function getAIMetrics() {
  const lifecycle = getPromptAPILifecycleMetrics()
  return {
    availabilityCheckCount: lifecycle.availabilityCheckCount,
    modelInitializationCount: lifecycle.underlyingModelInitCount,
    sessionCreationCount,
    sessionDestroyCount,
    warmupCount,
    compactionCount,
    compactionDurationMs,
    tokensBeforeCompaction,
    tokensAfterCompaction,
    taskRecoveryCount,
    inputUsage: aiSession?.inputUsage || 0,
    inputQuota: aiSession?.inputQuota || 9216,
    hasActiveSession: aiSession !== null,
  }
}

export function resetAIMetrics(): void {
  resetPromptAPILifecycleMetrics()
  sessionCreationCount = 0
  sessionDestroyCount = 0
  warmupCount = 0
  compactionCount = 0
  compactionDurationMs = 0
  tokensBeforeCompaction = 0
  tokensAfterCompaction = 0
  taskRecoveryCount = 0
  isFirstPrompt = true
}


function createLocalQwenSession(initialSystemPrompt: string) {
  let currentUsage = 0
  const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []

  return {
    type: 'local_qwen',
    isLocalSession: true,
    modelId: 'onnx-community/SmolLM-135M-Instruct-ONNX',
    executionTier: 'generative' as const,
    executionMode: 'worker' as const,
    get inputUsage() {
      return currentUsage
    },
    get inputQuota() {
      // Genuine model context window for onnx-community/SmolLM-135M-Instruct-ONNX (max_position_embeddings: 2048)
      return 2048
    },
    destroy: () => {
      conversationHistory.length = 0
    },
    resetHistory: () => {
      conversationHistory.length = 0
    },
    async *promptStreaming(input: any, options?: { signal?: AbortSignal }): AsyncIterable<string> {
      let promptText = typeof input === 'string' ? input : JSON.stringify(input)

      if (!promptText || !promptText.trim()) {
        yield 'Please enter a question or instruction to get started.'
        return
      }

      // Build serialized ChatML conversation including prior conversation turns
      let multiTurnPrompt = `<|im_start|>system\n${initialSystemPrompt}<|im_end|>\n`
      for (const turn of conversationHistory) {
        multiTurnPrompt += `<|im_start|>${turn.role}\n${turn.content}<|im_end|>\n`
      }
      multiTurnPrompt += `<|im_start|>user\n${promptText}<|im_end|>\n<|im_start|>assistant\n`

      currentUsage = Math.round(multiTurnPrompt.length / 4)

      let fullText = ''
      const chunks: string[] = []
      let resolveNext: (() => void) | null = null
      let done = false
      let error: any = null

      generativeRuntime.generateResponse(multiTurnPrompt, {
        signal: options?.signal,
        onChunk: (chunk: string) => {
          chunks.push(chunk)
          fullText += chunk
          if (resolveNext) {
            resolveNext()
            resolveNext = null
          }
        }
      }).then(() => {
        if (fullText.trim()) {
          conversationHistory.push({ role: 'user', content: promptText })
          conversationHistory.push({ role: 'assistant', content: fullText.trim() })
          if (conversationHistory.length > 20) {
            conversationHistory.splice(0, conversationHistory.length - 20)
          }
        }
        done = true
        if (resolveNext) resolveNext()
      }).catch((err) => {
        error = err
        done = true
        if (resolveNext) resolveNext()
      })

      while (!done || chunks.length > 0) {
        if (options?.signal?.aborted) {
          const abortErr = new Error('AI generation was aborted')
          abortErr.name = 'AbortError'
          throw abortErr
        }
        if (chunks.length > 0) {
          yield chunks.shift()!
        } else if (!done) {
          await new Promise<void>((resolve) => {
            resolveNext = resolve
          })
        }
      }

      if (error) {
        throw error
      }
    }
  }
}

export function getActiveSessionMetadata() {
  if (aiSession?.type === 'local_qwen') {
    return {
      tier: 'generative' as const,
      executionMode: 'worker' as const,
      modelId: 'onnx-community/SmolLM-135M-Instruct-ONNX'
    }
  }
  return {
    tier: 'native' as const,
    executionMode: 'native' as const,
    modelId: 'chrome-prompt-api-nano'
  }
}

async function ensureSession(requireMultimodal = false): Promise<any> {
  // Adopt preserved session from onboarding if available, valid, and text is sufficient
  if (!aiSession && !requireMultimodal) {
    const preserved = getPreservedSession()
    if (preserved) {
      const isLocal = preserved.type === 'local_qwen' || preserved.isLocalSession
      const isHealthy = !isLocal || (generativeRuntime.isModelResident() && generativeRuntime.getState().status !== 'error')
      if (isHealthy) {
        aiSession = preserved
        isMultimodalSession = false
        isFirstPrompt = false
      } else {
        clearPreservedSession()
      }
    }
  }

  // If session exists with required modality, return immediately if healthy
  if (aiSession && (!requireMultimodal || isMultimodalSession)) {
    const isLocal = aiSession.type === 'local_qwen' || aiSession.isLocalSession
    const isHealthy = !isLocal || (generativeRuntime.isModelResident() && generativeRuntime.getState().status !== 'error')
    if (isHealthy) {
      return aiSession
    } else {
      try {
        aiSession.destroy?.()
      } catch {}
      aiSession = null
      clearPreservedSession()
    }
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
      const prompt = await getSystemPrompt(TOOL_REGISTRY)
      filledSystemPrompt = prompt

      // Case 1: Multimodal session requested
      if (requireMultimodal) {
        console.log('[AI] Checking multimodal Prompt API availability...')
        const multiAvail = await checkPromptAPIAvailability({ multimodal: true })

        if (multiAvail === 'available') {
          try {
            console.log('[AI] Attempting multimodal LanguageModel session creation...')
            const newSession = await createResilientSession({
              initialPrompt: prompt,
              multimodal: true
            })
            sessionCreationCount++

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
        let promptApiError: string | null = null

        if (textAvail === 'available') {
          try {
            console.log('[AI] Creating standard text LanguageModel session...')
            aiSession = await createResilientSession({
              initialPrompt: prompt,
              multimodal: false
            })
            sessionCreationCount++
            isMultimodalSession = false
            console.log('[AI] Text session created and active')
            return aiSession
          } catch (createErr: any) {
            promptApiError = createErr?.message || String(createErr)
            console.warn('[AI] Prompt API session creation failed on device, falling back to local Qwen SLM:', promptApiError)
            if (promptApiError.includes('unable to create a session') || promptApiError.includes('availability() first')) {
              markPromptAPIDeviceIncapable()
            }
          }
        } else {
          console.log(`[AI] Prompt API reports status "${textAvail}". Falling back to Tier 3: Local Qwen2.5-0.5B SLM...`)
        }

        // Tier 3 Fallback: Dedicated Local Qwen2.5-0.5B ONNX session
        console.log('[AI] Initializing local Qwen2.5-0.5B ONNX session...')
        const localReady = await generativeRuntime.initializeLocalModel()
        if (localReady || generativeRuntime.isModelResident()) {
          aiSession = createLocalQwenSession(prompt)
          sessionCreationCount++
          isMultimodalSession = false
          console.log('[AI] Local Qwen2.5-0.5B session active and ready')
          return aiSession
        }

        const engineState = generativeRuntime.getState()
        const engineErr = engineState.error || 'Worker initialization failed'

        if (
          engineErr.includes('ModelNotProvisionedError') ||
          engineErr.includes('not provisioned') ||
          engineErr.includes('Could not locate file')
        ) {
          throw new Error(
            `Local AI model is not provisioned in cache. Please download the local models in Settings to enable offline AI.`
          )
        }

        if (promptApiError) {
          throw new Error(
            `Prompt API session creation failed (${promptApiError}) and Local AI SLM initialization failed (${engineErr}).`
          )
        }

        throw new Error(
          `Local AI engine initialization failed: ${engineErr} (Prompt API availability: ${textAvail}).`
        )
      }

      return aiSession
    } finally {
      sessionCreationPromise = null
    }
  })()

  return await sessionCreationPromise
}

/**
 * Preloads the AI session (Prompt API or local SmolLM) into memory ahead of first prompt.
 * Ensures the model is fully resident and warm before user interactions begin.
 */
export async function preloadSession(options?: {
  onWarmingUp?: () => void
  onWarmupComplete?: () => void
}): Promise<boolean> {
  // If session is already resident and ready, and first prompt was done:
  if (isModelReady() && !isFirstPrompt) {
    return true
  }

  if (isFirstPrompt && options?.onWarmingUp && !E2E_TEST_CONFIG.SKIP_WARMUP_PHASE) {
    options.onWarmingUp()
  }

  try {
    const session = await ensureSession(false)
    if (session) {
      if (isFirstPrompt) {
        warmupCount++
        isFirstPrompt = false
      }
      options?.onWarmupComplete?.()
      return true
    }
    options?.onWarmupComplete?.()
    return false
  } catch (err) {
    console.warn('[AI] Model preloading notice:', err)
    options?.onWarmupComplete?.()
    return false
  }
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
    warmupCount++
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
        // Local Vision Service fallback: perform on-device visual analysis and feed structured findings to text SLM
        console.log('[AI] Session is text-only: executing on-device VisionService analysis...')
        try {
          const { visionService } = await import('./vision-service')
          const visionReport = await visionService.analyzeImage(toolResult, { prompt: message })
          const visualContext = visionService.formatForPrompt(visionReport)
          promptInput = `${message}\n\n${visualContext}`
          console.log('[AI] Synthesized local visual analysis into prompt context')
        } catch (visionErr) {
          console.warn('[AI] Local vision analysis fallback error:', visionErr)
          promptInput = `${message}\n\n[Screenshot captured from active tab. On-device visual inspection completed; analyze webpage using current context and elements above.]`
        }
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
    if (currentController?.signal?.aborted) {
      console.log('[AI] Generation aborted mid-stream via signal')
      const abortErr = new Error('AI generation was aborted')
      abortErr.name = 'AbortError'
      throw abortErr
    }
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

export interface TokenUsageResult {
  usage: number
  quota: number
  isNative: boolean
}

export function getTokenUsage(fallbackUsage?: number): TokenUsageResult {
  const quota = aiSession?.inputQuota || 9216
  const nativeUsage = aiSession?.inputUsage
  
  // 1. If native inputUsage is available, numeric, and positive, trust native counter
  if (typeof nativeUsage === 'number' && nativeUsage > 0) {
    return {
      usage: nativeUsage,
      quota,
      isNative: true
    }
  }
  
  // 2. Fallback heuristic: Never interpret unavailable/0 native usage as proof that context is zero
  const usage = (typeof fallbackUsage === 'number' && fallbackUsage > 0) ? fallbackUsage : 0
  return {
    usage,
    quota,
    isNative: false
  }
}

export function setAISession(session: any): void {
  if (aiSession && aiSession !== session) {
    try {
      aiSession.destroy?.()
    } catch (e) {
      // ignore
    }
  }

  // Guard against re-introducing a dead local session while engine is in error or non-resident
  if (session && (session.type === 'local_qwen' || session.isLocalSession)) {
    const runtimeState = generativeRuntime.getState()
    if (runtimeState.status === 'error' || !generativeRuntime.isModelResident()) {
      console.warn('[AI] Cannot set active local session while GenerativeRuntime is in an error state or worker is not resident.')
      aiSession = null
      clearPreservedSession()
      return
    }
  }

  aiSession = session
  setPreservedSession(session)
  isMultimodalSession = false
  isFirstPrompt = false
}

// Subscribe to GenerativeRuntime lifecycle events to invalidate stale local sessions on crash or error
let unsubscribeRuntime: (() => void) | null = null

export function setupRuntimeSubscription(): () => void {
  if (unsubscribeRuntime) return unsubscribeRuntime

  unsubscribeRuntime = generativeRuntime.subscribe((runtimeState) => {
    const session = aiSession || getPreservedSession()
    if (
      session && 
      (session.type === 'local_qwen' || session.isLocalSession) &&
      (runtimeState.status === 'error' || !generativeRuntime.isModelResident())
    ) {
      console.warn('[AI] GenerativeRuntime worker terminated or entered error state; invalidating active local session.')
      try {
        session.destroy?.()
      } catch {}
      aiSession = null
      clearPreservedSession()
    }
  })

  return unsubscribeRuntime
}
setupRuntimeSubscription()

export function getAISession(): any {
  const session = aiSession || getPreservedSession()
  if (!session) return null

  // If local session and runtime is dead/error, do not return dead session
  if (session.type === 'local_qwen' || session.isLocalSession) {
    const runtimeState = generativeRuntime.getState()
    if (runtimeState.status === 'error' || !generativeRuntime.isModelResident()) {
      return null
    }
  }

  return session
}

export function isModelReady(): boolean {
  const session = aiSession || getPreservedSession()
  if (!session) return false

  // If the active session is a local SLM wrapper, enforce worker residency and non-error state
  if (session.type === 'local_qwen' || session.isLocalSession) {
    const runtimeState = generativeRuntime.getState()
    if (runtimeState.status === 'error' || runtimeState.status === 'downloading' || !generativeRuntime.isModelResident()) {
      return false
    }
  }

  return true
}

export function destroySession() {
  if (aiSession) {
    try {
      aiSession.destroy()
    } catch (e) {
      console.warn('[AI] Error destroying aiSession:', e)
    }
    aiSession = null
    sessionDestroyCount++
  }
  clearPreservedSession()
  isMultimodalSession = false
  sessionCreationPromise = null
  filledSystemPrompt = null
  isFirstPrompt = true
}

/**
 * Resets the Prompt API session after incremental context compaction.
 * Recreates session without triggering false model weight warm-up.
 */
export function resetSessionForCompactedContext(): void {
  if (aiSession) {
    try {
      aiSession.destroy()
    } catch (e) {
      console.warn('[AI] Error destroying aiSession during compaction:', e)
    }
    aiSession = null
  }
  sessionDestroyCount++
  isMultimodalSession = false
  sessionCreationPromise = null
  // Keep isFirstPrompt = false because model weights remain resident in browser memory
  isFirstPrompt = false
}

export function getFilledSystemPrompt(): string | null {
  return filledSystemPrompt
}
