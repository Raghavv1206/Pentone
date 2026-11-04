/**
 * Settings management for Pentone
 */

export interface PentoneSettings {
  captureOverlayEnabled: boolean
  globalShortcutsEnabled: boolean
  textSelectionEnabled: boolean
  autoTextSelectionPopup?: boolean
  writeCommandEnabled: boolean
  speechLanguage?: 'en-IN' | 'hi-IN' | 'en-US'
  voiceInteractionModel?: 'push_to_talk' | 'wake_word' | 'full_duplex'
  whisperModel?: 'Xenova/whisper-tiny' | 'Xenova/whisper-base' | 'Xenova/whisper-tiny.en'
  speechEngine?: 'whisper_local' | 'web_speech_api'
  webSpeechPrivacyNoticeAccepted?: boolean
  theme?: 'light' | 'dark' | 'system'
  // Hybrid Online Model Configuration (Strictly Opt-In)
  onlineAIEnabled?: boolean
  onlineAIProvider?: 'openai' | 'anthropic' | 'custom'
  onlineAIModel?: string
  onlineAIEndpoint?: string
  onlineAIRequireConsent?: boolean
  localOnlyMode?: boolean
}

// Backward compatibility alias
export type MarionetteSettings = PentoneSettings

export const DEFAULT_SETTINGS: PentoneSettings = {
  captureOverlayEnabled: false,
  globalShortcutsEnabled: false,
  textSelectionEnabled: true,
  autoTextSelectionPopup: true,
  writeCommandEnabled: false,
  speechLanguage: 'en-IN',
  voiceInteractionModel: 'push_to_talk',
  whisperModel: 'Xenova/whisper-tiny',
  speechEngine: 'whisper_local',
  webSpeechPrivacyNoticeAccepted: false,
  theme: 'system',
  onlineAIEnabled: false,
  onlineAIProvider: 'openai',
  onlineAIModel: 'gpt-4o-mini',
  onlineAIEndpoint: 'https://api.openai.com/v1',
  onlineAIRequireConsent: true,
  localOnlyMode: true
}

export const PRIMARY_SETTINGS_KEY = 'pentone_settings'
export const LEGACY_SETTINGS_KEY = 'marionette_settings'
export const ACTIVE_USER_ID_KEY = 'pentone_active_user_id'
export const CANONICAL_DEFAULT_USER_ID = 'default_user'

/**
 * Load settings from chrome.storage.local with backward compatibility
 */
export async function loadSettings(): Promise<PentoneSettings> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve(DEFAULT_SETTINGS)
      return
    }
    chrome.storage.local.get([PRIMARY_SETTINGS_KEY, LEGACY_SETTINGS_KEY], (result) => {
      const stored = result[PRIMARY_SETTINGS_KEY] || result[LEGACY_SETTINGS_KEY]
      if (stored) {
        resolve({ ...DEFAULT_SETTINGS, ...stored })
      } else {
        resolve(DEFAULT_SETTINGS)
      }
    })
  })
}

/**
 * Load canonical active user ID from chrome.storage.local
 */
export async function loadActiveUserId(): Promise<string> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve(CANONICAL_DEFAULT_USER_ID)
      return
    }
    chrome.storage.local.get([ACTIVE_USER_ID_KEY], (result) => {
      const id = result[ACTIVE_USER_ID_KEY]
      if (typeof id === 'string' && id.trim().length > 0) {
        resolve(id.trim())
      } else {
        resolve(CANONICAL_DEFAULT_USER_ID)
      }
    })
  })
}

/**
 * Save canonical active user ID to chrome.storage.local
 */
export async function saveActiveUserId(userId: string): Promise<void> {
  const normalized = (userId || CANONICAL_DEFAULT_USER_ID).trim()
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve()
      return
    }
    chrome.storage.local.set({ [ACTIVE_USER_ID_KEY]: normalized }, () => resolve())
  })
}

/**
 * Save settings to chrome.storage.local (updates both primary and legacy keys for compatibility)
 */
export async function saveSettings(settings: PentoneSettings): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({
      [PRIMARY_SETTINGS_KEY]: settings,
      [LEGACY_SETTINGS_KEY]: settings
    }, () => {
      resolve()
    })
  })
}

/**
 * Get a hex color with opacity as rgba string
 */
export function hexToRgba(hex: string, opacity: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}
