/**
 * Settings management for Pentone
 */

export type ThemeMode = 'light' | 'dark' | 'system'

export interface PentoneSettings {
  captureOverlayEnabled: boolean
  globalShortcutsEnabled: boolean
  textSelectionEnabled: boolean
  writeCommandEnabled: boolean
  theme?: ThemeMode
  micDeviceId?: string
  voiceName?: string
  speechRate?: number
  speechPitch?: number
  speechVolume?: number
  picovoiceAccessKey?: string
}

export const PRIMARY_SETTINGS_KEY = 'pentone_settings'
export const LEGACY_SETTINGS_KEY = 'pentone_legacy_settings'

export const DEFAULT_SETTINGS: PentoneSettings = {
  captureOverlayEnabled: true,
  globalShortcutsEnabled: true,
  textSelectionEnabled: true,
  writeCommandEnabled: true,
  theme: 'system',
  picovoiceAccessKey: ''
}

/**
 * Load settings from chrome.storage.local
 */
export async function loadSettings(): Promise<PentoneSettings> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.id || !chrome.storage?.local) {
      resolve(DEFAULT_SETTINGS)
      return
    }
    try {
      chrome.storage.local.get([PRIMARY_SETTINGS_KEY, LEGACY_SETTINGS_KEY], (result) => {
        if (chrome.runtime?.lastError || !result) {
          resolve(DEFAULT_SETTINGS)
          return
        }
        const saved = result[PRIMARY_SETTINGS_KEY] || result[LEGACY_SETTINGS_KEY]
        if (saved) {
          resolve({ ...DEFAULT_SETTINGS, ...saved })
        } else {
          resolve(DEFAULT_SETTINGS)
        }
      })
    } catch {
      resolve(DEFAULT_SETTINGS)
    }
  })
}

/**
 * Save settings to chrome.storage.local
 */
export async function saveSettings(settings: PentoneSettings): Promise<void> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.id || !chrome.storage?.local) {
      resolve()
      return
    }
    try {
      chrome.storage.local.set({
        [PRIMARY_SETTINGS_KEY]: settings,
        [LEGACY_SETTINGS_KEY]: settings
      }, () => {
        void chrome.runtime?.lastError
        resolve()
      })
    } catch {
      resolve()
    }
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
