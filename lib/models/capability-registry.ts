/**
 * Pentone Model & Capability Registry
 * 
 * Provides a modular, decoupled capability architecture where:
 * 1. Each model explicitly declares the capabilities it supports.
 * 2. Tasks route ONLY to compatible models.
 * 3. Model failures remain strictly isolated (failure in SLM does not disable ASR, TTS, or embeddings).
 * 4. Model initialization is lazy with concurrency deduplication.
 * 5. Models can be safely unloaded to conserve memory on constrained hardware.
 * 6. Explicit capability-level health tracking (INITIALIZING | READY | OFFLINE | RECOVERING | ERROR).
 * 7. Chat, Voice, Tools, and Documents consume unified, synchronized health telemetry.
 */

export type CapabilityType =
  | 'text-generation'
  | 'reasoning'
  | 'tool-planning'
  | 'image-understanding'
  | 'speech-recognition'
  | 'speech-generation'
  | 'embeddings'
  | 'document-extraction'
  | 'ocr'

export type CapabilityHealthStatus =
  | 'unavailable'
  | 'initializing'
  | 'ready'
  | 'recovering'
  | 'error'

export interface ModelDescriptorInfo {
  id: string
  name: string
  version?: string
  capabilities: CapabilityType[]
  executionMode: 'local' | 'online' | 'native' | 'hybrid'
  status: CapabilityHealthStatus
  lastError: string | null
  memoryUsageBytes?: number
  isResident: boolean
  isProvisioned: boolean
  initialize: () => Promise<boolean>
  dispose: () => Promise<void>
}

export interface CapabilityHealthReport {
  capability: CapabilityType
  status: CapabilityHealthStatus
  activeModelId?: string
  executionMode: 'local' | 'online' | 'native' | 'hybrid' | 'unavailable'
  error?: string | null
  lastChecked: number
}

class CapabilityRegistry {
  private static instance: CapabilityRegistry | null = null
  private models = new Map<string, ModelDescriptorInfo>()
  private listeners = new Set<(report: Record<CapabilityType, CapabilityHealthReport>) => void>()
  private initPromises = new Map<string, Promise<boolean>>()

  private constructor() {
    this.registerDefaultModels()
  }

  public static getInstance(): CapabilityRegistry {
    if (!CapabilityRegistry.instance) {
      CapabilityRegistry.instance = new CapabilityRegistry()
    }
    return CapabilityRegistry.instance
  }

  private registerDefaultModels() {
    // 1. Chrome Native Specialist & Prompt API (Gemini Nano)
    this.registerModel({
      id: 'chrome-prompt-api',
      name: 'Chrome Built-in Prompt API (Gemini Nano)',
      capabilities: ['text-generation', 'reasoning', 'tool-planning'],
      executionMode: 'native',
      status: 'unavailable',
      lastError: null,
      isResident: false,
      isProvisioned: true,
      initialize: async () => {
        try {
          const { checkPromptAPIAvailability } = await import('../ai-config')
          const avail = await checkPromptAPIAvailability()
          const ready = avail === 'available'
          this.updateModelStatus('chrome-prompt-api', ready ? 'ready' : 'unavailable', ready ? null : `Status: ${avail}`)
          return ready
        } catch (e: any) {
          this.updateModelStatus('chrome-prompt-api', 'error', e?.message || 'Prompt API error')
          return false
        }
      },
      dispose: async () => {
        this.updateModelStatus('chrome-prompt-api', 'unavailable', null)
      }
    })

    // 2. SmolLM-135M-Instruct (On-Device Primary SLM in Dedicated Worker)
    this.registerModel({
      id: 'onnx-community/SmolLM-135M-Instruct-ONNX',
      name: 'SmolLM 135M-Instruct (INT8 ONNX)',
      capabilities: ['text-generation', 'reasoning', 'tool-planning'],
      executionMode: 'local',
      status: 'unavailable',
      lastError: null,
      isResident: false,
      isProvisioned: false,
      initialize: async () => {
        try {
          const { generativeRuntime } = await import('../generative-runtime')
          this.updateModelStatus('onnx-community/SmolLM-135M-Instruct-ONNX', 'initializing', null)
          const success = await generativeRuntime.initializeLocalModel()
          const state = generativeRuntime.getState()
          if (success || state.status === 'ready') {
            this.updateModelStatus('onnx-community/SmolLM-135M-Instruct-ONNX', 'ready', null)
            return true
          } else {
            this.updateModelStatus('onnx-community/SmolLM-135M-Instruct-ONNX', 'error', state.error || 'Failed to initialize SLM worker')
            return false
          }
        } catch (err: any) {
          this.updateModelStatus('onnx-community/SmolLM-135M-Instruct-ONNX', 'error', err?.message || 'SLM init error')
          return false
        }
      },
      dispose: async () => {
        const { generativeRuntime } = await import('../generative-runtime')
        await generativeRuntime.unloadModel().catch(() => {})
        this.updateModelStatus('onnx-community/SmolLM-135M-Instruct-ONNX', 'unavailable', null)
      }
    })

    // Legacy alias registration: Qwen2.5-0.5B-Instruct
    this.registerModel({
      id: 'onnx-community/Qwen2.5-0.5B-Instruct',
      name: 'Qwen 2.5-0.5B-Instruct (Legacy Alias)',
      capabilities: ['text-generation', 'reasoning', 'tool-planning'],
      executionMode: 'local',
      status: 'unavailable',
      lastError: null,
      isResident: false,
      isProvisioned: false,
      initialize: async () => {
        try {
          const { generativeRuntime } = await import('../generative-runtime')
          this.updateModelStatus('onnx-community/Qwen2.5-0.5B-Instruct', 'initializing', null)
          const success = await generativeRuntime.initializeLocalModel()
          const state = generativeRuntime.getState()
          if (success || state.status === 'ready') {
            this.updateModelStatus('onnx-community/Qwen2.5-0.5B-Instruct', 'ready', null)
            return true
          } else {
            this.updateModelStatus('onnx-community/Qwen2.5-0.5B-Instruct', 'error', state.error || 'Failed to initialize SLM worker')
            return false
          }
        } catch (err: any) {
          this.updateModelStatus('onnx-community/Qwen2.5-0.5B-Instruct', 'error', err?.message || 'SLM init error')
          return false
        }
      },
      dispose: async () => {
        const { generativeRuntime } = await import('../generative-runtime')
        await generativeRuntime.unloadModel().catch(() => {})
        this.updateModelStatus('onnx-community/Qwen2.5-0.5B-Instruct', 'unavailable', null)
      }
    })

    // 3. Whisper Tiny (On-Device Speech-to-Text)
    this.registerModel({
      id: 'Xenova/whisper-tiny',
      name: 'Whisper Tiny (Local Speech ASR)',
      capabilities: ['speech-recognition'],
      executionMode: 'local',
      status: 'unavailable',
      lastError: null,
      isResident: false,
      isProvisioned: false,
      initialize: async () => {
        try {
          const { WhisperASRService } = await import('../audio/whisper-asr-service')
          this.updateModelStatus('Xenova/whisper-tiny', 'initializing', null)
          const whisper = WhisperASRService.getInstance()
          await whisper.initialize('Xenova/whisper-tiny')
          this.updateModelStatus('Xenova/whisper-tiny', 'ready', null)
          return true
        } catch (err: any) {
          this.updateModelStatus('Xenova/whisper-tiny', 'error', err?.message || 'Whisper init error')
          return false
        }
      },
      dispose: async () => {
        this.updateModelStatus('Xenova/whisper-tiny', 'unavailable', null)
      }
    })

    // 4. all-MiniLM-L6-v2 (On-Device Semantic Vector Embeddings)
    this.registerModel({
      id: 'Xenova/all-MiniLM-L6-v2',
      name: 'all-MiniLM-L6-v2 (384-dimensional Embeddings)',
      capabilities: ['embeddings'],
      executionMode: 'local',
      status: 'unavailable',
      lastError: null,
      isResident: false,
      isProvisioned: false,
      initialize: async () => {
        try {
          const { generateEmbedding } = await import('../embeddings')
          this.updateModelStatus('Xenova/all-MiniLM-L6-v2', 'initializing', null)
          const probe = await generateEmbedding('health check probe')
          if (probe && probe.length === 384) {
            this.updateModelStatus('Xenova/all-MiniLM-L6-v2', 'ready', null)
            return true
          }
          this.updateModelStatus('Xenova/all-MiniLM-L6-v2', 'error', 'Invalid vector generated')
          return false
        } catch (err: any) {
          this.updateModelStatus('Xenova/all-MiniLM-L6-v2', 'error', err?.message || 'Embedding init error')
          return false
        }
      },
      dispose: async () => {
        this.updateModelStatus('Xenova/all-MiniLM-L6-v2', 'unavailable', null)
      }
    })

    // 5. Browser Native Speech Synthesis (TTS)
    this.registerModel({
      id: 'browser-speech-synthesis',
      name: 'Browser Web Speech Synthesis',
      capabilities: ['speech-generation'],
      executionMode: 'native',
      status: typeof window !== 'undefined' && 'speechSynthesis' in window ? 'ready' : 'unavailable',
      lastError: null,
      isResident: true,
      isProvisioned: true,
      initialize: async () => {
        const ok = typeof window !== 'undefined' && 'speechSynthesis' in window
        this.updateModelStatus('browser-speech-synthesis', ok ? 'ready' : 'unavailable', ok ? null : 'SpeechSynthesis not supported')
        return ok
      },
      dispose: async () => {
        if (typeof window !== 'undefined' && window.speechSynthesis) {
          window.speechSynthesis.cancel()
        }
      }
    })

    // 6. Local Document Extractor (PDF, DOCX, PPTX, Text)
    this.registerModel({
      id: 'pentone-document-extractor',
      name: 'Pentone Local Multi-Format Document Extractor',
      capabilities: ['document-extraction'],
      executionMode: 'local',
      status: 'ready',
      lastError: null,
      isResident: true,
      isProvisioned: true,
      initialize: async () => true,
      dispose: async () => {}
    })

    // 7. Local Vision-Language Model (ViT-GPT2)
    this.registerModel({
      id: 'Xenova/vit-gpt2-image-captioning',
      name: 'ViT-GPT2 Image Understanding (Local VLM)',
      capabilities: ['image-understanding'],
      executionMode: 'local',
      status: 'unavailable',
      lastError: null,
      isResident: false,
      isProvisioned: false,
      initialize: async () => {
        try {
          const { visionService } = await import('../vision-service')
          this.updateModelStatus('Xenova/vit-gpt2-image-captioning', 'initializing', null)
          const ok = await visionService.initialize()
          this.updateModelStatus('Xenova/vit-gpt2-image-captioning', ok ? 'ready' : 'unavailable', ok ? null : visionService.getLastError())
          return ok
        } catch (err: any) {
          this.updateModelStatus('Xenova/vit-gpt2-image-captioning', 'error', err?.message || 'Vision init error')
          return false
        }
      },
      dispose: async () => {
        const { visionService } = await import('../vision-service')
        await visionService.dispose().catch(() => {})
        this.updateModelStatus('Xenova/vit-gpt2-image-captioning', 'unavailable', null)
      }
    })

    // Alias for backwards compatibility
    this.registerModel({
      id: 'pentone-vision-engine',
      name: 'ViT-GPT2 Image Understanding (Alias)',
      capabilities: ['image-understanding'],
      executionMode: 'local',
      status: 'unavailable',
      lastError: null,
      isResident: false,
      isProvisioned: false,
      initialize: async () => {
        try {
          const { visionService } = await import('../vision-service')
          this.updateModelStatus('pentone-vision-engine', 'initializing', null)
          const ok = await visionService.initialize()
          this.updateModelStatus('pentone-vision-engine', ok ? 'ready' : 'unavailable', ok ? null : visionService.getLastError())
          return ok
        } catch (err: any) {
          this.updateModelStatus('pentone-vision-engine', 'error', err?.message || 'Vision init error')
          return false
        }
      },
      dispose: async () => {
        const { visionService } = await import('../vision-service')
        await visionService.dispose().catch(() => {})
        this.updateModelStatus('pentone-vision-engine', 'unavailable', null)
      }
    })

    // 8. Optional Online Cloud Model Adapter (Explicit Opt-In Only)
    this.registerModel({
      id: 'optional-online-provider',
      name: 'Optional Online Model Provider (Consent-Enforced)',
      capabilities: ['text-generation', 'reasoning', 'image-understanding'],
      executionMode: 'online',
      status: 'unavailable',
      lastError: null,
      isResident: false,
      isProvisioned: false,
      initialize: async () => {
        const { onlineProviderAdapter } = await import('./online-provider-adapter')
        const ok = onlineProviderAdapter.isEnabled()
        this.updateModelStatus('optional-online-provider', ok ? 'ready' : 'unavailable', ok ? null : 'Online provider is disabled by user default')
        return ok
      },
      dispose: async () => {
        this.updateModelStatus('optional-online-provider', 'unavailable', null)
      }
    })
  }

  public registerModel(model: ModelDescriptorInfo) {
    this.models.set(model.id, model)
    this.notify()
  }

  public getModel(id: string): ModelDescriptorInfo | undefined {
    return this.models.get(id)
  }

  public getAllModels(): ModelDescriptorInfo[] {
    return Array.from(this.models.values())
  }

  public getModelsForCapability(capability: CapabilityType): ModelDescriptorInfo[] {
    return Array.from(this.models.values()).filter(m => m.capabilities.includes(capability))
  }

  public updateModelStatus(id: string, status: CapabilityHealthStatus, error: string | null = null) {
    const m = this.models.get(id)
    if (m) {
      m.status = status
      m.lastError = error
      m.isResident = status === 'ready'
      this.notify()
    }
  }

  /**
   * Lazily initializes model for requested capability with promise deduplication.
   */
  public async ensureModelReady(modelId: string): Promise<boolean> {
    const model = this.models.get(modelId)
    if (!model) return false
    if (model.status === 'ready') return true

    if (this.initPromises.has(modelId)) {
      return this.initPromises.get(modelId)!
    }

    const p = (async () => {
      try {
        return await model.initialize()
      } finally {
        this.initPromises.delete(modelId)
      }
    })()

    this.initPromises.set(modelId, p)
    return p
  }

  /**
   * Returns authoritative health status across all registered capabilities.
   */
  public getHealthReport(): Record<CapabilityType, CapabilityHealthReport> {
    const capabilities: CapabilityType[] = [
      'text-generation',
      'reasoning',
      'tool-planning',
      'image-understanding',
      'speech-recognition',
      'speech-generation',
      'embeddings',
      'document-extraction',
      'ocr'
    ]

    const report: Partial<Record<CapabilityType, CapabilityHealthReport>> = {}
    const now = Date.now()

    for (const cap of capabilities) {
      const candidates = this.getModelsForCapability(cap)
      const readyCandidate = candidates.find(m => m.status === 'ready')
      const initCandidate = candidates.find(m => m.status === 'initializing')
      const recoveringCandidate = candidates.find(m => m.status === 'recovering')
      const errorCandidate = candidates.find(m => m.status === 'error')

      if (readyCandidate) {
        report[cap] = {
          capability: cap,
          status: 'ready',
          activeModelId: readyCandidate.id,
          executionMode: readyCandidate.executionMode,
          error: null,
          lastChecked: now
        }
      } else if (initCandidate) {
        report[cap] = {
          capability: cap,
          status: 'initializing',
          activeModelId: initCandidate.id,
          executionMode: initCandidate.executionMode,
          error: null,
          lastChecked: now
        }
      } else if (recoveringCandidate) {
        report[cap] = {
          capability: cap,
          status: 'recovering',
          activeModelId: recoveringCandidate.id,
          executionMode: recoveringCandidate.executionMode,
          error: recoveringCandidate.lastError,
          lastChecked: now
        }
      } else if (errorCandidate) {
        report[cap] = {
          capability: cap,
          status: 'error',
          activeModelId: errorCandidate.id,
          executionMode: errorCandidate.executionMode,
          error: errorCandidate.lastError,
          lastChecked: now
        }
      } else {
        report[cap] = {
          capability: cap,
          status: 'unavailable',
          executionMode: 'unavailable',
          error: 'No model ready or provisioned for capability',
          lastChecked: now
        }
      }
    }

    return report as Record<CapabilityType, CapabilityHealthReport>
  }

  public subscribe(listener: (report: Record<CapabilityType, CapabilityHealthReport>) => void): () => void {
    this.listeners.add(listener)
    listener(this.getHealthReport())
    return () => this.listeners.delete(listener)
  }

  private notify() {
    const report = this.getHealthReport()
    for (const l of this.listeners) {
      try { l(report) } catch {}
    }
  }
}

export const capabilityRegistry = CapabilityRegistry.getInstance()
