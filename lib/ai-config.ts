/**
 * LanguageModel Session Configuration and Lifecycle Management
 * 
 * Centralized, type-safe configuration for Chrome Built-in AI (Prompt API / Gemma 4).
 * Enforces output language declarations, multimodal fallback hierarchies,
 * and clean session creation/destruction.
 */

export const DEFAULT_LANGUAGE = 'en'
export const SUPPORTED_LANGUAGES = ['de', 'en', 'es', 'fr', 'ja'] as const
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number]

export interface ModelInputConfig {
  type: 'text' | 'image'
  languages?: string[]
}

export interface ModelOutputConfig {
  type: 'text'
  languages: string[]
}

export interface InitialPrompt {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface SessionOptions {
  initialPrompts?: InitialPrompt[]
  expectedInputs: ModelInputConfig[]
  expectedOutputs: ModelOutputConfig[]
  monitor?: (m: any) => void
  signal?: AbortSignal
}

export type ModelAvailabilityStatus = 'available' | 'downloadable' | 'unavailable' | 'readily' | 'after-download' | 'no'

/**
 * Validate and normalize language code against Chrome Prompt API supported languages.
 */
export function normalizeLanguage(lang?: string): string {
  if (!lang) return DEFAULT_LANGUAGE
  const code = lang.toLowerCase().split('-')[0] // e.g. "en-US" -> "en"
  if (SUPPORTED_LANGUAGES.includes(code as SupportedLanguage)) {
    return code
  }
  return DEFAULT_LANGUAGE
}

/**
 * Build a canonical options object for LanguageModel session creation or availability check.
 * Guarantees that expectedOutputs ALWAYS specifies a valid supported language code.
 */
export function buildSessionOptions(params?: {
  initialPrompt?: string
  multimodal?: boolean
  languages?: string[]
  monitor?: (m: any) => void
  signal?: AbortSignal
}): SessionOptions {
  const primaryLang = normalizeLanguage(params?.languages?.[0])
  const languages = [primaryLang]

  const inputs: ModelInputConfig[] = [
    { type: 'text', languages }
  ]

  if (params?.multimodal) {
    inputs.push({ type: 'image' })
  }

  const options: SessionOptions = {
    expectedInputs: inputs,
    expectedOutputs: [{ type: 'text', languages }]
  }

  if (params?.initialPrompt) {
    options.initialPrompts = [{ role: 'system', content: params.initialPrompt }]
  }

  if (params?.monitor) {
    options.monitor = params.monitor
  }

  if (params?.signal) {
    options.signal = params.signal
  }

  return options
}

/**
 * Check Prompt API availability for the specified modality configuration.
 * Strictly checks the requested configuration without masking failures with fallback modalities.
 */
export async function checkPromptAPIAvailability(params?: {
  multimodal?: boolean
  languages?: string[]
}): Promise<ModelAvailabilityStatus> {
  if (typeof window === 'undefined' || !('LanguageModel' in window)) {
    return 'unavailable'
  }

  const lm = (window as any).LanguageModel
  if (typeof lm?.availability !== 'function') {
    return 'unavailable'
  }

  try {
    const options = buildSessionOptions(params)
    const result = await lm.availability(options)
    if (result) return result
  } catch (error) {
    console.warn(`[AI Config] Availability check for ${params?.multimodal ? 'multimodal' : 'text'} failed:`, error)
    return 'no'
  }

  return 'unavailable'
}

/**
 * Create a clean LanguageModel session with verified language configuration.
 * Avoids cascading retry loops that trip Chromium's 3-crash circuit breaker.
 */
export async function createResilientSession(params: {
  initialPrompt?: string
  multimodal?: boolean
  languages?: string[]
  monitor?: (m: any) => void
  signal?: AbortSignal
}): Promise<any> {
  if (typeof window === 'undefined' || !('LanguageModel' in window)) {
    throw new Error('Chrome Prompt API (window.LanguageModel) is not available in this environment')
  }

  const lm = (window as any).LanguageModel
  const options = buildSessionOptions(params)

  // Single direct creation attempt with exact options
  // Do not perform rapid cascading retries that crash the utility process
  try {
    return await lm.create(options)
  } catch (error: any) {
    if (error?.message?.includes('crashed too many times')) {
      throw new Error('The Chrome on-device AI process crashed too many times and was disabled by Chrome. Please restart Chrome (chrome://restart) to reset.')
    }
    throw error
  }
}
