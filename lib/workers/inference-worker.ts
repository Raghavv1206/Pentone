/**
 * Pentone Local Inference Web Worker (Phase 3.5 Hardened)
 * 
 * Runs ONNX Runtime Web / Transformers.js execution completely isolated
 * from the renderer main thread. Ensures that sustained WASM token generation
 * never starves the main event loop, PTT keyboard/pointer handlers, or audio capture.
 * 
 * Phase 3.5 Hardening:
 * - Strict IPC payload schema validation
 * - Prompt bounds check (prevents memory exhaustion DoS)
 * - Safe error propagation and messageerror handling
 * - Clean session disposal
 */

// Worker message protocol types
export interface WorkerRequest {
  id: string
  type: 'INITIALIZE' | 'GENERATE' | 'DISPOSE' | 'PING'
  payload?: any
}

export interface WorkerResponse {
  id: string
  type: 'INITIALIZED' | 'PROGRESS' | 'GENERATED' | 'DISPOSED' | 'ERROR' | 'PONG'
  result?: any
  error?: string
  progress?: number
}

let pipelineInstance: any = null
let activeModelId: string = 'onnx-community/Qwen2.5-0.5B-Instruct'
let isInitializing: boolean = false

self.addEventListener('messageerror', (event: MessageEvent) => {
  self.postMessage({
    id: 'unknown_messageerror',
    type: 'ERROR',
    error: 'Worker received message that cannot be deserialized'
  })
})

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  if (!event || !event.data || typeof event.data !== 'object') {
    self.postMessage({ id: 'invalid_format', type: 'ERROR', error: 'Malformed message format: must be an object' })
    return
  }

  const { id, type, payload } = event.data

  if (!id || typeof id !== 'string') {
    self.postMessage({ id: 'missing_id', type: 'ERROR', error: 'Message missing valid correlation string ID' })
    return
  }

  try {
    if (type === 'PING') {
      self.postMessage({ id, type: 'PONG' })
      return
    }

    if (type === 'INITIALIZE') {
      if (pipelineInstance) {
        self.postMessage({ id, type: 'INITIALIZED', result: { modelId: activeModelId } })
        return
      }

      if (isInitializing) {
        throw new Error('Worker initialization already in progress')
      }

      isInitializing = true
      try {
        const { pipeline, env } = await import('@xenova/transformers')

        env.allowLocalModels = false
        env.useBrowserCache = true

        if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
          env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('assets/')
        }
        env.backends.onnx.wasm.numThreads = 1
        env.backends.onnx.wasm.proxy = false

        const modelId = (payload?.modelId && typeof payload.modelId === 'string')
          ? payload.modelId
          : activeModelId
        const revision = (payload?.revision && typeof payload.revision === 'string')
          ? payload.revision
          : '22942cb7d7ba4cc81bb4673549ca4d4614469b5e'

        pipelineInstance = await pipeline('text-generation', modelId, {
          model_file_name: 'model',
          quantized: true,
          device: 'wasm',
          revision,
          progress_callback: (info: any) => {
            if (info.status === 'progress' && typeof info.progress === 'number') {
              self.postMessage({ id, type: 'PROGRESS', progress: Math.round(info.progress) })
            }
          }
        })

        activeModelId = modelId
        self.postMessage({ id, type: 'INITIALIZED', result: { modelId } })
      } finally {
        isInitializing = false
      }
      return
    }

    if (type === 'GENERATE') {
      if (!pipelineInstance) {
        throw new Error('Pipeline not initialized in worker')
      }

      if (!payload || typeof payload !== 'object') {
        throw new Error('Generate payload must be an object')
      }

      const { prompt, maxTokens = 256, temperature = 0.3 } = payload

      if (typeof prompt !== 'string' || prompt.trim().length === 0) {
        throw new Error('Generate payload requires a non-empty string prompt')
      }

      // Security bound: prevent memory exhaustion from hostile webpage text injection
      if (prompt.length > 25000) {
        throw new Error('Prompt length exceeds safety threshold (25,000 characters)')
      }

      // Parameter validation & clamping
      const boundedMaxTokens = Math.max(1, Math.min(2048, Math.floor(Number(maxTokens) || 256)))
      const boundedTemperature = Math.max(0, Math.min(2.0, Number(temperature) || 0.3))

      const out = await pipelineInstance(prompt, {
        max_new_tokens: boundedMaxTokens,
        temperature: boundedTemperature,
        do_sample: boundedTemperature > 0
      })

      const generatedText = out?.[0]?.generated_text?.replace(prompt, '')?.trim() || ''
      self.postMessage({ id, type: 'GENERATED', result: { text: generatedText } })
      return
    }

    if (type === 'DISPOSE') {
      if (pipelineInstance) {
        try {
          if (typeof pipelineInstance.dispose === 'function') {
            await pipelineInstance.dispose()
          }
          if (pipelineInstance.model?.session?.release) {
            await pipelineInstance.model.session.release()
          }
        } catch (e) {
          console.warn('[InferenceWorker] Disposal error:', e)
        }
        pipelineInstance = null
      }
      self.postMessage({ id, type: 'DISPOSED' })
      return
    }

    throw new Error(`Unknown message type: ${type}`)
  } catch (err: any) {
    self.postMessage({ id, type: 'ERROR', error: err?.message || String(err) })
  }
})
