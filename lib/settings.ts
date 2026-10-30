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
  voiceInteractionModel?: 'full_duplex' | 'push_to_talk'
  whisperModel?: 'Xenova/whisper-base' | 'Xenova/whisper-tiny' | 'Xenova/whisper-tiny.en'
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
  voiceInteractionModel: 'full_duplex',
  whisperModel: 'Xenova/whisper-base'
}

const PRIMARY_SETTINGS_KEY = 'pentone_settings'
const LEGACY_SETTINGS_KEY = 'marionette_settings'

/**
 * Load settings from chrome.storage.local with backward compatibility
 */
export async function loadSettings(): Promise<PentoneSettings> {
  return new Promise((resolve) => {
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
