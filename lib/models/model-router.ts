/**
 * Pentone Task & Model Router
 * 
 * Routes incoming user queries, multimodal inputs, voice turns, and tool requests
 * to compatible local models or optional consent-verified online providers.
 * 
 * Invariants:
 * 1. Task routing selects ONLY models that declare the required capabilities.
 * 2. Text-only models NEVER receive raw image pixels.
 * 3. Model failures remain isolated: vision failure does not abort text response.
 * 4. Local-first: Never routes to online providers without explicit user consent.
 */

import { capabilityRegistry, type CapabilityType, type ModelDescriptorInfo } from './capability-registry'

export interface TaskRequirements {
  capabilities: CapabilityType[]
  hasImage?: boolean
  hasAudio?: boolean
  hasDocument?: boolean
  requiresHighReasoning?: boolean
  allowOnlineFallback?: boolean
}

export interface RouteResolution {
  primaryModelId: string
  fallbackModelId?: string
  capabilities: CapabilityType[]
  executionMode: 'local' | 'native' | 'online' | 'hybrid' | 'deterministic'
  requiresConsent: boolean
  reason: string
}

export class ModelRouter {
  private static instance: ModelRouter | null = null

  private constructor() {}

  public static getInstance(): ModelRouter {
    if (!ModelRouter.instance) {
      ModelRouter.instance = new ModelRouter()
    }
    return ModelRouter.instance
  }

  /**
   * Evaluates input payload to identify required capabilities.
   */
  public analyzeTaskRequirements(input: {
    message?: string
    image?: string
    audio?: Float32Array
    documentFile?: File
    toolName?: string
  }): TaskRequirements {
    const capabilities: CapabilityType[] = []
    let hasImage = false
    let hasAudio = false
    let hasDocument = false

    if (input.image || (input.message && input.message.includes('data:image/'))) {
      capabilities.push('image-understanding')
      hasImage = true
    }

    if (input.audio) {
      capabilities.push('speech-recognition')
      hasAudio = true
    }

    if (input.documentFile) {
      capabilities.push('document-extraction')
      hasDocument = true
    }

    if (input.toolName) {
      capabilities.push('tool-planning')
    }

    // Default conversational reasoning
    if (capabilities.length === 0 || hasImage || hasDocument) {
      capabilities.push('text-generation')
      capabilities.push('reasoning')
    }

    return {
      capabilities: Array.from(new Set(capabilities)),
      hasImage,
      hasAudio,
      hasDocument,
      requiresHighReasoning: Boolean(
        input.message && (
          input.message.length > 2000 ||
          /explain in depth|code architecture|financial model|complex reasoning/i.test(input.message)
        )
      )
    }
  }

  /**
   * Resolves the optimal route for the given requirements.
   */
  public resolveRoute(requirements: TaskRequirements): RouteResolution {
    const health = capabilityRegistry.getHealthReport()

    // 1. Vision & Multimodal tasks
    if (requirements.hasImage || requirements.capabilities.includes('image-understanding')) {
      const visionModels = capabilityRegistry.getModelsForCapability('image-understanding')
      const localVision = visionModels.find(m => m.executionMode === 'local' && m.status === 'ready')

      if (localVision) {
        return {
          primaryModelId: localVision.id,
          capabilities: ['image-understanding'],
          executionMode: 'local',
          requiresConsent: false,
          reason: 'Local vision model ready for image/screenshot analysis'
        }
      }

      // Check if online provider is configured and consented
      const onlineVision = visionModels.find(m => m.executionMode === 'online' && m.status === 'ready')
      if (onlineVision && requirements.allowOnlineFallback) {
        return {
          primaryModelId: onlineVision.id,
          capabilities: ['image-understanding'],
          executionMode: 'online',
          requiresConsent: true,
          reason: 'Routing image to consented online vision provider'
        }
      }

      return {
        primaryModelId: 'Xenova/vit-gpt2-image-captioning',
        capabilities: ['image-understanding'],
        executionMode: 'local',
        requiresConsent: false,
        reason: 'Local ViT-GPT2 vision model ready or pending initialization'
      }
    }

    // 2. Speech recognition tasks
    if (requirements.hasAudio || requirements.capabilities.includes('speech-recognition')) {
      return {
        primaryModelId: 'Xenova/whisper-tiny',
        capabilities: ['speech-recognition'],
        executionMode: 'local',
        requiresConsent: false,
        reason: 'Whisper Tiny local ASR'
      }
    }

    // 3. Document processing
    if (requirements.hasDocument || requirements.capabilities.includes('document-extraction')) {
      return {
        primaryModelId: 'pentone-document-extractor',
        capabilities: ['document-extraction'],
        executionMode: 'local',
        requiresConsent: false,
        reason: 'Local multi-format document parser'
      }
    }

    // 4. Standard text generation, tool planning & reasoning
    // Priority: Native Prompt API (Gemini Nano) -> Local SmolLM SLM -> Deterministic Heuristic
    const promptApi = capabilityRegistry.getModel('chrome-prompt-api')
    if (promptApi && promptApi.status === 'ready') {
      return {
        primaryModelId: 'chrome-prompt-api',
        fallbackModelId: 'onnx-community/SmolLM-135M-Instruct-ONNX',
        capabilities: ['text-generation', 'reasoning', 'tool-planning'],
        executionMode: 'native',
        requiresConsent: false,
        reason: 'Chrome Native Specialist/Prompt API (Gemini Nano)'
      }
    }

    return {
      primaryModelId: 'onnx-community/SmolLM-135M-Instruct-ONNX',
      fallbackModelId: 'deterministic-router',
      capabilities: ['text-generation', 'reasoning', 'tool-planning'],
      executionMode: 'local',
      requiresConsent: false,
      reason: 'Local SmolLM 135M-Instruct SLM in dedicated worker'
    }
  }
}

export const modelRouter = ModelRouter.getInstance()
