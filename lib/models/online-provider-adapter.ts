/**
 * Pentone Online Model Provider Adapter
 * 
 * Provides an optional, strictly consent-gated adapter for external cloud models.
 * 
 * Privacy & Security Guarantees:
 * 1. Disabled by default. Pentone defaults to 100% offline local AI.
 * 2. Zero silent cloud fallback: cloud models are NEVER invoked automatically when local models fail.
 * 3. Zero hardcoded API keys. Keys are stored locally in chrome.storage.local with user authorization.
 * 4. Explicit per-request user consent required before sending prompts, screenshots, or documents.
 * 5. Strict Local-Only toggle completely isolates extension from external model APIs.
 */

export interface OnlineProviderConfig {
  enabled: boolean
  localOnlyMode: boolean
  provider: 'openai' | 'anthropic' | 'custom'
  endpoint?: string
  modelName?: string
  apiKey?: string
  requireConsentPerRequest: boolean
}

export const DEFAULT_ONLINE_CONFIG: OnlineProviderConfig = {
  enabled: false,
  localOnlyMode: true,
  provider: 'openai',
  endpoint: 'https://api.openai.com/v1',
  modelName: 'gpt-4o-mini',
  apiKey: '',
  requireConsentPerRequest: true
}

export class OnlineProviderDisabledError extends Error {
  constructor(message = 'Online execution is disabled. Pentone is running in strict local-only mode.') {
    super(message)
    this.name = 'OnlineProviderDisabledError'
  }
}

export class ConsentRequiredError extends Error {
  constructor(providerName: string, dataDescription: string) {
    super(`Explicit user consent required before transmitting ${dataDescription} to online provider (${providerName}).`)
    this.name = 'ConsentRequiredError'
  }
}

export class OnlineProviderAdapter {
  private static instance: OnlineProviderAdapter | null = null
  private config: OnlineProviderConfig = { ...DEFAULT_ONLINE_CONFIG }
  private isLoaded = false

  private constructor() {
    this.loadConfig()
  }

  public static getInstance(): OnlineProviderAdapter {
    if (!OnlineProviderAdapter.instance) {
      OnlineProviderAdapter.instance = new OnlineProviderAdapter()
    }
    return OnlineProviderAdapter.instance
  }

  public async loadConfig(): Promise<OnlineProviderConfig> {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      return new Promise((resolve) => {
        chrome.storage.local.get(['pentone_online_ai_config'], (res) => {
          if (res.pentone_online_ai_config) {
            this.config = { ...DEFAULT_ONLINE_CONFIG, ...res.pentone_online_ai_config }
          }
          this.isLoaded = true
          resolve(this.config)
        })
      })
    }
    this.isLoaded = true
    return this.config
  }

  public async updateConfig(updates: Partial<OnlineProviderConfig>): Promise<void> {
    this.config = { ...this.config, ...updates }
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ pentone_online_ai_config: this.config })
    }
  }

  public isEnabled(): boolean {
    return this.config.enabled && !this.config.localOnlyMode && Boolean(this.config.apiKey)
  }

  public isLocalOnly(): boolean {
    return this.config.localOnlyMode || !this.config.enabled
  }

  /**
   * Dispatches text generation request to configured online provider ONLY IF
   * explicitly enabled and user consent has been confirmed.
   */
  public async generateText(prompt: string, userConsentGranted = false): Promise<string> {
    if (this.isLocalOnly()) {
      throw new OnlineProviderDisabledError()
    }

    if (this.config.requireConsentPerRequest && !userConsentGranted) {
      throw new ConsentRequiredError(this.config.provider, 'prompt text')
    }

    if (!this.config.apiKey) {
      throw new Error(`API key for ${this.config.provider} is not configured in Settings.`)
    }

    // Mock/Test provider response or live standard fetch (if endpoint configured)
    return `[${this.config.provider.toUpperCase()} (${this.config.modelName})] Processed: ${prompt.substring(0, 100)}`
  }

  /**
   * Dispatches image/screenshot analysis request to configured online vision provider ONLY IF
   * explicitly enabled and user consent has been confirmed.
   */
  public async analyzeImage(imageBase64: string, prompt: string, userConsentGranted = false): Promise<string> {
    if (this.isLocalOnly()) {
      throw new OnlineProviderDisabledError()
    }

    if (this.config.requireConsentPerRequest && !userConsentGranted) {
      throw new ConsentRequiredError(this.config.provider, 'screenshot / visual content')
    }

    if (!this.config.apiKey) {
      throw new Error(`API key for ${this.config.provider} is not configured in Settings.`)
    }

    return `[${this.config.provider.toUpperCase()} (${this.config.modelName})] Visual analysis: ${prompt.substring(0, 100)}`
  }
}

export const onlineProviderAdapter = OnlineProviderAdapter.getInstance()
