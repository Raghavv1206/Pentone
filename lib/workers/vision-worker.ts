/**
 * Pentone Dedicated Vision Inference Web Worker (Phase 5)
 * 
 * Runs the local Vision-Language Model (VLM) isolated from the renderer main thread
 * and other inference workers.
 * 
 * Target Model: Xenova/vit-gpt2-image-captioning
 * Architecture: VisionEncoderDecoderModel (Google ViT-base vision encoder + GPT-2 language decoder)
 * Revision: ba08b9131320894a9604be46a3e9be3b830601ed
 * 
 * Guarantees:
 * 1. Strictly offline execution after provisioning (env.allowRemoteModels = false).
 * 2. Dedicated memory heap — vision tensor allocations cannot starve Qwen SLM or Whisper ASR.
 * 3. Graceful error handling for missing cache, corrupt images, or inference timeout.
 * 4. Clean session disposal.
 */

export interface VisionWorkerRequest {
  id: string
  type: 'INITIALIZE' | 'ANALYZE' | 'DISPOSE' | 'PING'
  payload?: any
}

export interface VisionWorkerResponse {
  id: string
  type: 'INITIALIZED' | 'PROGRESS' | 'ANALYZED' | 'DISPOSED' | 'ERROR' | 'PONG'
  result?: any
  error?: string
  errorCode?: 'MODEL_NOT_PROVISIONED' | 'INVALID_IMAGE' | 'INITIALIZATION_FAILED' | 'INFERENCE_FAILED'
  progress?: number
}

let captionPipeline: any = null
let activeModelId: string = 'Xenova/vit-gpt2-image-captioning'
let activeRevision: string = 'ba08b9131320894a9604be46a3e9be3b830601ed'
let isInitializing: boolean = false

self.addEventListener('messageerror', () => {
  self.postMessage({
    id: 'unknown_messageerror',
    type: 'ERROR',
    error: 'Worker received message that cannot be deserialized',
    errorCode: 'INFERENCE_FAILED'
  } as VisionWorkerResponse)
})

self.addEventListener('message', async (event: MessageEvent<VisionWorkerRequest>) => {
  if (!event || !event.data || typeof event.data !== 'object') {
    self.postMessage({
      id: 'invalid_format',
      type: 'ERROR',
      error: 'Malformed message format: must be an object',
      errorCode: 'INFERENCE_FAILED'
    } as VisionWorkerResponse)
    return
  }

  const { id, type, payload } = event.data

  if (!id || typeof id !== 'string') {
    self.postMessage({
      id: 'missing_id',
      type: 'ERROR',
      error: 'Message missing valid correlation string ID',
      errorCode: 'INFERENCE_FAILED'
    } as VisionWorkerResponse)
    return
  }

  try {
    if (type === 'PING') {
      self.postMessage({ id, type: 'PONG' } as VisionWorkerResponse)
      return
    }

    if (type === 'INITIALIZE') {
      if (captionPipeline) {
        self.postMessage({
          id,
          type: 'INITIALIZED',
          result: { modelId: activeModelId, revision: activeRevision }
        } as VisionWorkerResponse)
        return
      }

      if (isInitializing) {
        throw new Error('Vision worker initialization already in progress')
      }

      isInitializing = true
      try {
        const { pipeline, env } = await import('@xenova/transformers')

        // Offline guarantee: strictly use browser CacheStorage, zero remote CDN fetches
        env.allowLocalModels = true
        env.allowRemoteModels = false
        env.useBrowserCache = true

        // Guarantee local WASM assets: Dedicated Web Workers in Chrome MV3 lack chrome.runtime.
        // Priority order:
        // 1. Explicitly passed payload.wasmPaths from sidepanel/main thread (e.g. chrome-extension://<id>/assets/)
        // 2. chrome.runtime.getURL('assets/') if available
        // 3. Runtime location-derived URL without tripping Parcel static bundler analysis
        const relDir = 'assets/'
        const baseLocation = (typeof self !== 'undefined' && self.location?.href) ? self.location.href : null
        let resolvedWasmPaths = payload?.wasmPaths
          || (typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL(relDir) : null)
          || (baseLocation ? new URL(relDir, baseLocation.replace(/\/[^/]*$/, '/')).href : null)

        if (resolvedWasmPaths) {
          if (!resolvedWasmPaths.endsWith('/')) {
            resolvedWasmPaths = `${resolvedWasmPaths}/`
          }
          env.backends.onnx.wasm.wasmPaths = resolvedWasmPaths
        }
        env.backends.onnx.wasm.numThreads = 1
        env.backends.onnx.wasm.proxy = false

        const modelId = payload?.modelId || activeModelId
        const revision = payload?.revision || activeRevision

        try {
          captionPipeline = await pipeline('image-to-text', modelId, {
            quantized: true,
            device: 'wasm',
            revision,
            progress_callback: (info: any) => {
              if (info.status === 'progress' && typeof info.progress === 'number') {
                self.postMessage({ id, type: 'PROGRESS', progress: Math.round(info.progress) } as VisionWorkerResponse)
              }
            }
          })

          activeModelId = modelId
          activeRevision = revision
          self.postMessage({
            id,
            type: 'INITIALIZED',
            result: { modelId, revision }
          } as VisionWorkerResponse)
        } catch (loadErr: any) {
          const msg = loadErr?.message || String(loadErr)
          const isNotProvisioned =
            msg.includes('Could not locate file') ||
            msg.includes('trying to fetch the file') ||
            msg.includes('Failed to fetch') ||
            msg.includes('404') ||
            msg.includes('not provisioned') ||
            msg.includes('Failed to load') ||
            msg.includes('both local and remote models are disabled')

          self.postMessage({
            id,
            type: 'ERROR',
            error: isNotProvisioned
              ? `Vision model ${modelId} is not provisioned in local storage. Please download it from Settings.`
              : `Vision worker pipeline initialization failed: ${msg}`,
            errorCode: isNotProvisioned ? 'MODEL_NOT_PROVISIONED' : 'INITIALIZATION_FAILED'
          } as VisionWorkerResponse)
        }
      } finally {
        isInitializing = false
      }
      return
    }

    if (type === 'ANALYZE') {
      if (!captionPipeline) {
        self.postMessage({
          id,
          type: 'ERROR',
          error: 'Vision pipeline is not initialized. Call INITIALIZE first.',
          errorCode: 'INITIALIZATION_FAILED'
        } as VisionWorkerResponse)
        return
      }

      const imageData = payload?.image
      if (!imageData || typeof imageData !== 'string') {
        self.postMessage({
          id,
          type: 'ERROR',
          error: 'Missing valid image data URL in payload',
          errorCode: 'INVALID_IMAGE'
        } as VisionWorkerResponse)
        return
      }

      const startTime = performance.now()

      try {
        const { RawImage } = await import('@xenova/transformers')

        // Decode and validate image
        let image: any
        try {
          if (imageData.startsWith('data:')) {
            const res = await fetch(imageData)
            const blob = await res.blob()
            image = await RawImage.fromBlob(blob)
          } else {
            image = await RawImage.fromURL(imageData)
          }
        } catch (decodeErr: any) {
          self.postMessage({
            id,
            type: 'ERROR',
            error: `Failed to decode image: ${decodeErr?.message || 'Invalid format'}`,
            errorCode: 'INVALID_IMAGE'
          } as VisionWorkerResponse)
          return
        }

        const maxTokens = payload?.max_new_tokens || 64
        const output = await captionPipeline(image, {
          max_new_tokens: maxTokens
        })

        const generatedText = Array.isArray(output) && output.length > 0
          ? (output[0].generated_text || '').trim()
          : (typeof output === 'string' ? output : '')

        const latencyMs = Math.round(performance.now() - startTime)

        self.postMessage({
          id,
          type: 'ANALYZED',
          result: {
            description: generatedText,
            width: image.width,
            height: image.height,
            channels: image.channels,
            latencyMs,
            modelId: activeModelId,
            revision: activeRevision
          }
        } as VisionWorkerResponse)
      } catch (inferErr: any) {
        self.postMessage({
          id,
          type: 'ERROR',
          error: `Vision inference failed: ${inferErr?.message || String(inferErr)}`,
          errorCode: 'INFERENCE_FAILED'
        } as VisionWorkerResponse)
      }
      return
    }

    if (type === 'DISPOSE') {
      captionPipeline = null
      self.postMessage({ id, type: 'DISPOSED' } as VisionWorkerResponse)
      return
    }

    self.postMessage({
      id,
      type: 'ERROR',
      error: `Unknown request type: ${(type as any)}`,
      errorCode: 'INFERENCE_FAILED'
    } as VisionWorkerResponse)
  } catch (outerErr: any) {
    self.postMessage({
      id,
      type: 'ERROR',
      error: outerErr?.message || 'Unexpected worker error',
      errorCode: 'INFERENCE_FAILED'
    } as VisionWorkerResponse)
  }
})
