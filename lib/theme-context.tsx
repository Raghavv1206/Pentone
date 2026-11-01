import React, { createContext, useContext, useEffect, useState } from 'react'
import { loadSettings, PRIMARY_SETTINGS_KEY, LEGACY_SETTINGS_KEY, DEFAULT_SETTINGS } from './settings'

export type ThemeMode = 'light' | 'dark' | 'system'
export type EffectiveTheme = 'light' | 'dark'

export interface ThemeTokens {
  bgApp: string
  bgSecondary: string
  bgElevated: string
  bgInput: string
  borderSubtle: string
  borderStrong: string
  borderControl: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  placeholder: string
  accent: string
  accentHover: string
  accentOnSolid: string
  lavenderSurface: string
  lavenderText: string
  lavenderBorder: string
  errorSurface: string
  errorText: string
  errorBorder: string
  successSurface: string
  successText: string
  successBorder: string
}

export const THEME_PALETTE: Record<EffectiveTheme, ThemeTokens> = {
  light: {
    bgApp: '#FFFEEF',
    bgSecondary: '#F3F1DF',
    bgElevated: '#E8E5CE',
    bgInput: '#FAF8E8',
    borderSubtle: '#DDDCCB',
    borderStrong: '#878571',
    borderControl: '#878571',
    textPrimary: '#191919',
    textSecondary: '#56564E',
    textMuted: '#73736A',
    placeholder: '#636257',
    accent: '#005447',
    accentHover: '#004238',
    accentOnSolid: '#FFFFFF',
    lavenderSurface: '#E9D2FF',
    lavenderText: '#3A1B60',
    lavenderBorder: '#D5B5F5',
    errorSurface: '#FEE2E2',
    errorText: '#991B1B',
    errorBorder: '#FCA5A5',
    successSurface: '#DCFCE7',
    successText: '#166534',
    successBorder: '#86EFAC'
  },
  dark: {
    bgApp: '#171816',
    bgSecondary: '#22231F',
    bgElevated: '#2D2E29',
    bgInput: '#1E1F1B',
    borderSubtle: '#373832',
    borderStrong: '#6D6E63',
    borderControl: '#6D6E63',
    textPrimary: '#F5F1E7',
    textSecondary: '#A6A49B',
    textMuted: '#88867C',
    placeholder: '#949286',
    accent: '#67E2C8',
    accentHover: '#52C7AE',
    accentOnSolid: '#0D1F1B',
    lavenderSurface: '#342845',
    lavenderText: '#E9D2FF',
    lavenderBorder: '#513E6B',
    errorSurface: '#451A1A',
    errorText: '#FCA5A5',
    errorBorder: '#7F1D1D',
    successSurface: '#143823',
    successText: '#86EFAC',
    successBorder: '#1E5836'
  }
}

export const THEME_TOKENS = THEME_PALETTE

interface ThemeContextType {
  theme: ThemeMode
  effectiveTheme: EffectiveTheme
  setTheme: (theme: ThemeMode) => void
}

export function isSystemDark(): boolean {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  return false
}

export function applyThemeToDocument(effectiveTheme: EffectiveTheme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (effectiveTheme === 'dark') {
    root.classList.add('dark')
    root.classList.remove('light')
    root.style.colorScheme = 'dark'
  } else {
    root.classList.add('light')
    root.classList.remove('dark')
    root.style.colorScheme = 'light'
  }
}

// Immediate execution to prevent theme flashing on load
if (typeof document !== 'undefined') {
  const initialDark = isSystemDark()
  applyThemeToDocument(initialDark ? 'dark' : 'light')
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'system',
  effectiveTheme: isSystemDark() ? 'dark' : 'light',
  setTheme: () => {}
})

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemeMode>(DEFAULT_SETTINGS.theme || 'system')
  const [systemIsDark, setSystemIsDark] = useState<boolean>(() => isSystemDark())

  // Load persisted theme
  useEffect(() => {
    loadSettings().then(s => {
      if (s.theme) {
        setThemeState(s.theme)
      }
    }).catch(() => {})

    // Listen for storage changes from other contexts (e.g. settings page / popup)
    const storageHandler = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName === 'local') {
        const change = changes[PRIMARY_SETTINGS_KEY] || changes[LEGACY_SETTINGS_KEY]
        if (change?.newValue?.theme) {
          setThemeState(change.newValue.theme)
        }
      }
    }
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(storageHandler)
    }

    // Listen for system theme changes
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = (e: MediaQueryListEvent) => setSystemIsDark(e.matches)
      mediaQuery.addEventListener('change', handler)
      return () => {
        mediaQuery.removeEventListener('change', handler)
        if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
          chrome.storage.onChanged.removeListener(storageHandler)
        }
      }
    }
    return () => {
      if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(storageHandler)
      }
    }
  }, [])

  const effectiveTheme: EffectiveTheme = theme === 'system' 
    ? (systemIsDark ? 'dark' : 'light')
    : (theme === 'dark' ? 'dark' : 'light')

  // Apply class to document.documentElement
  useEffect(() => {
    applyThemeToDocument(effectiveTheme)
  }, [effectiveTheme])

  const setTheme = (newTheme: ThemeMode) => {
    setThemeState(newTheme)
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get([PRIMARY_SETTINGS_KEY, LEGACY_SETTINGS_KEY], (res) => {
        const existing = res[PRIMARY_SETTINGS_KEY] || res[LEGACY_SETTINGS_KEY] || {}
        const updated = { ...existing, theme: newTheme }
        chrome.storage.local.set({
          [PRIMARY_SETTINGS_KEY]: updated,
          [LEGACY_SETTINGS_KEY]: updated
        })
      })
    }
  }

  return (
    <ThemeContext.Provider value={{ theme, effectiveTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)

/**
 * Hook for in-page injected components that need to sync with Pentone theme settings
 */
export function useInjectedTheme(): { 
  effectiveTheme: EffectiveTheme
  themeMode: ThemeMode
  tokens: ThemeTokens
  isDark: boolean
} {
  const [themeMode, setThemeMode] = useState<ThemeMode>(DEFAULT_SETTINGS.theme || 'system')
  const [systemIsDark, setSystemIsDark] = useState<boolean>(() => isSystemDark())

  useEffect(() => {
    loadSettings().then(s => {
      if (s.theme) {
        setThemeMode(s.theme)
      }
    }).catch(() => {})

    const storageHandler = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName === 'local') {
        const change = changes[PRIMARY_SETTINGS_KEY] || changes[LEGACY_SETTINGS_KEY]
        if (change?.newValue?.theme) {
          setThemeMode(change.newValue.theme)
        }
      }
    }
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(storageHandler)
    }

    if (typeof window !== 'undefined' && window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = (e: MediaQueryListEvent) => setSystemIsDark(e.matches)
      mediaQuery.addEventListener('change', handler)
      return () => {
        mediaQuery.removeEventListener('change', handler)
        if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
          chrome.storage.onChanged.removeListener(storageHandler)
        }
      }
    }
    return () => {
      if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(storageHandler)
      }
    }
  }, [])

  const effectiveTheme: EffectiveTheme = themeMode === 'system'
    ? (systemIsDark ? 'dark' : 'light')
    : (themeMode === 'dark' ? 'dark' : 'light')

  const isDark = effectiveTheme === 'dark'
  const tokens = THEME_PALETTE[effectiveTheme]

  return { effectiveTheme, themeMode, tokens, isDark }
}
