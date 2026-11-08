import React, { useState, useEffect } from 'react'
import { ArrowLeft, ExternalLink, Sun, Moon, Laptop, Sparkles, Check, Mic, Volume2 } from 'lucide-react'
import { loadSettings, saveSettings, type PentoneSettings } from '../lib/settings'
import { useTheme, type ThemeMode } from '../lib/theme-context'
import { MicSelector } from '../components/mic-selector'
import { VoiceSelector } from '../components/voice-selector'
import { openAllRequiredFlags, openComponentsPage } from '../lib/alert-context'

interface SettingsScreenProps {
  onBack: () => void
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ onBack }) => {
  const { theme, setTheme, effectiveTheme } = useTheme()
  const [settings, setSettings] = useState<PentoneSettings>({
    captureOverlayEnabled: true,
    globalShortcutsEnabled: true,
    textSelectionEnabled: true,
    writeCommandEnabled: true
  })
  const [hasChanges, setHasChanges] = useState(false)
  const [version, setVersion] = useState<string>('')
  const [showSavedToast, setShowSavedToast] = useState(false)

  useEffect(() => {
    loadSettings().then(s => {
      setSettings(s)
    })
    if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
      setVersion(chrome.runtime.getManifest().version)
    }
  }, [])

  const handleToggle = (key: keyof PentoneSettings) => {
    const updated = { ...settings, [key]: !settings[key] }
    setSettings(updated)
    setHasChanges(true)
  }

  const handleSave = async () => {
    await saveSettings(settings)
    setHasChanges(false)
    setShowSavedToast(true)
    setTimeout(() => setShowSavedToast(false), 2000)

    // Notify all tabs to update in-page components immediately
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({}, (tabs) => {
        tabs?.forEach(tab => {
          if (tab?.id) {
            chrome.tabs.sendMessage(tab.id, { type: 'settings_updated', settings }).catch(() => {})
          }
        })
      })
    }
  }

  const openChromeFlags = () => {
    openAllRequiredFlags()
  }

  const openChromeComponents = () => {
    openComponentsPage()
  }

  const openExtensionSettings = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#FFFEEF] dark:bg-[#171816] text-[#191919] dark:text-[#F5F1E7] overflow-hidden select-none">
      {/* Header */}
      <div className="px-3.5 sm:px-4 py-2.5 sm:py-3 border-b border-[#DDDCCB] dark:border-[#373832] flex items-center justify-between bg-[#FFFEEF]/90 dark:bg-[#171816]/90 backdrop-blur-md w-full min-w-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg hover:bg-[#F3F1DF] dark:hover:bg-[#22231F] text-[#56564E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] transition-colors shrink-0"
            title="Back to voice"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h2 className="font-display text-sm sm:text-base font-bold text-[#191919] dark:text-[#F5F1E7] truncate">
            Settings
          </h2>
        </div>

        <button
          onClick={handleSave}
          disabled={!hasChanges}
          className="px-3 sm:px-3.5 py-1.5 rounded-xl font-sans text-xs font-semibold bg-[#005447] hover:bg-[#003F36] dark:bg-[#67E2C8] dark:hover:bg-[#52C5AD] text-white dark:text-[#171816] transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-xs shrink-0"
        >
          {showSavedToast ? 'Saved!' : 'Save'}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-3.5 sm:space-y-4 w-full min-w-0">
        {/* Appearance Section */}
        <div className="p-3.5 sm:p-4 rounded-2xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] space-y-3 w-full min-w-0 break-words">
          <div className="space-y-0.5">
            <h3 className="font-display text-sm font-bold text-[#191919] dark:text-[#F5F1E7]">
              Appearance & Theme
            </h3>
            <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B]">
              Customize Pentone interface styling for sidepanel and in-page overlays.
            </p>
          </div>

          {/* Theme segmented control */}
          <div className="grid grid-cols-3 gap-1.5 p-1 bg-[#EBE7D0] dark:bg-[#2A2B26] rounded-xl border border-[#DDDCCB] dark:border-[#373832]">
            <button
              onClick={() => setTheme('light')}
              className={`py-1.5 px-2 rounded-lg text-xs font-sans font-medium flex items-center justify-center gap-1.5 transition-all ${
                theme === 'light'
                  ? 'bg-[#FFFEEF] text-[#191919] shadow-xs font-bold'
                  : 'text-[#77776E] hover:text-[#191919]'
              }`}
            >
              <Sun className="w-3.5 h-3.5 text-amber-500" />
              <span>Light</span>
            </button>

            <button
              onClick={() => setTheme('dark')}
              className={`py-1.5 px-2 rounded-lg text-xs font-sans font-medium flex items-center justify-center gap-1.5 transition-all ${
                theme === 'dark'
                  ? 'bg-[#171816] text-[#F5F1E7] shadow-xs font-bold'
                  : 'text-[#A6A49B] hover:text-[#F5F1E7]'
              }`}
            >
              <Moon className="w-3.5 h-3.5 text-cyan-400" />
              <span>Dark</span>
            </button>

            <button
              onClick={() => setTheme('system')}
              className={`py-1.5 px-2 rounded-lg text-xs font-sans font-medium flex items-center justify-center gap-1.5 transition-all ${
                theme === 'system'
                  ? 'bg-[#FFFEEF] dark:bg-[#171816] text-[#191919] dark:text-[#F5F1E7] shadow-xs font-bold'
                  : 'text-[#77776E] dark:text-[#A6A49B]'
              }`}
            >
              <Laptop className="w-3.5 h-3.5" />
              <span>System</span>
            </button>
          </div>
        </div>

        {/* Audio Devices Section */}
        <div className="p-4 rounded-2xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] space-y-3">
          <div className="space-y-0.5">
            <h3 className="font-display text-sm font-bold text-[#191919] dark:text-[#F5F1E7]">
              Audio & Speech
            </h3>
            <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B]">
              Configure preferred input microphone and synthesized assistant voice.
            </p>
          </div>

          <div className="space-y-2">
            <div>
              <label className="text-[11px] font-mono font-medium text-[#77776E] dark:text-[#A6A49B] block mb-1">
                Microphone Input
              </label>
              <MicSelector />
            </div>

            <div>
              <label className="text-[11px] font-mono font-medium text-[#77776E] dark:text-[#A6A49B] block mb-1">
                Voice Output
              </label>
              <VoiceSelector />
            </div>

            <div className="pt-1">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-mono font-medium text-[#77776E] dark:text-[#A6A49B]">
                  Picovoice AccessKey (Wake Word)
                </label>
                <a
                  href="https://console.picovoice.ai/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-[#005447] dark:text-[#67E2C8] hover:underline flex items-center gap-0.5"
                >
                  Get free key <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
              <input
                type="password"
                value={settings.picovoiceAccessKey || ''}
                onChange={(e) => {
                  setSettings(prev => ({ ...prev, picovoiceAccessKey: e.target.value.trim() }))
                  setHasChanges(true)
                }}
                placeholder="Paste Picovoice AccessKey..."
                className="w-full px-2.5 py-1.5 bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] rounded-xl text-xs text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447] font-mono"
              />
              <p className="text-[10px] text-[#77776E] dark:text-[#A6A49B] mt-1">
                Optional: Used for "Hey Pentone" / "Porcupine" hands-free wake word detection.
              </p>
            </div>
          </div>
        </div>

        {/* In-Page Capabilities */}
        <div className="p-4 rounded-2xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] space-y-3">
          <div className="space-y-0.5">
            <h3 className="font-display text-sm font-bold text-[#191919] dark:text-[#F5F1E7]">
              Browsing Interactions
            </h3>
            <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B]">
              In-page assistance tools active on web pages you browse.
            </p>
          </div>

          <div className="space-y-2.5">
            {/* Custom Text Selection */}
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832]">
              <div className="pr-2">
                <span className="font-sans text-xs font-semibold text-[#191919] dark:text-[#F5F1E7] block">
                  Text Selection Tooltip
                </span>
                <span className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">
                  Highlight text on web pages to trigger Quick Explain or Rewrite
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleToggle('textSelectionEnabled')}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                  settings.textSelectionEnabled 
                    ? 'bg-[#005447] dark:bg-[#67E2C8]' 
                    : 'bg-[#DDDCCB] dark:bg-[#373832]'
                }`}
              >
                <span
                  className={`absolute top-1 left-1 w-4 h-4 rounded-full transition-transform ${
                    settings.textSelectionEnabled 
                      ? 'translate-x-5 bg-white dark:bg-[#171816]' 
                      : 'translate-x-0 bg-white/80 dark:bg-black/60'
                  }`}
                />
              </button>
            </div>

            {/* /write Command */}
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832]">
              <div className="pr-2">
                <span className="font-sans text-xs font-semibold text-[#191919] dark:text-[#F5F1E7] block">
                  Inline /write Command
                </span>
                <span className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">
                  Type <code className="font-mono bg-[#DDDCCB]/50 dark:bg-[#373832]/60 px-1 rounded">/write</code> into text inputs to generate neural drafts
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleToggle('writeCommandEnabled')}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                  settings.writeCommandEnabled 
                    ? 'bg-[#005447] dark:bg-[#67E2C8]' 
                    : 'bg-[#DDDCCB] dark:bg-[#373832]'
                }`}
              >
                <span
                  className={`absolute top-1 left-1 w-4 h-4 rounded-full transition-transform ${
                    settings.writeCommandEnabled 
                      ? 'translate-x-5 bg-white dark:bg-[#171816]' 
                      : 'translate-x-0 bg-white/80 dark:bg-black/60'
                  }`}
                />
              </button>
            </div>

            {/* Capture Overlay */}
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832]">
              <div className="pr-2">
                <span className="font-sans text-xs font-semibold text-[#191919] dark:text-[#F5F1E7] block">
                  Capture Overlay Floating Buttons
                </span>
                <span className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">
                  On-screen pill buttons for rapid screenshotting and audio capture
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleToggle('captureOverlayEnabled')}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                  settings.captureOverlayEnabled 
                    ? 'bg-[#005447] dark:bg-[#67E2C8]' 
                    : 'bg-[#DDDCCB] dark:bg-[#373832]'
                }`}
              >
                <span
                  className={`absolute top-1 left-1 w-4 h-4 rounded-full transition-transform ${
                    settings.captureOverlayEnabled 
                      ? 'translate-x-5 bg-white dark:bg-[#171816]' 
                      : 'translate-x-0 bg-white/80 dark:bg-black/60'
                  }`}
                />
              </button>
            </div>

            {/* Global Shortcuts */}
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832]">
              <div className="pr-2">
                <span className="font-sans text-xs font-semibold text-[#191919] dark:text-[#F5F1E7] block">
                  Keyboard Shortcuts
                </span>
                <span className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">
                  <kbd className="font-mono bg-[#DDDCCB]/50 dark:bg-[#373832]/60 px-1 py-0.5 rounded text-[9px]">Ctrl+Shift+S</kbd> screenshot, <kbd className="font-mono bg-[#DDDCCB]/50 dark:bg-[#373832]/60 px-1 py-0.5 rounded text-[9px]">Ctrl+Shift+A</kbd> audio
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleToggle('globalShortcutsEnabled')}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                  settings.globalShortcutsEnabled 
                    ? 'bg-[#005447] dark:bg-[#67E2C8]' 
                    : 'bg-[#DDDCCB] dark:bg-[#373832]'
                }`}
              >
                <span
                  className={`absolute top-1 left-1 w-4 h-4 rounded-full transition-transform ${
                    settings.globalShortcutsEnabled 
                      ? 'translate-x-5 bg-white dark:bg-[#171816]' 
                      : 'translate-x-0 bg-white/80 dark:bg-black/60'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Chrome AI System Flags */}
        <div className="space-y-2">
          <button
            onClick={openChromeFlags}
            className="w-full p-3.5 rounded-2xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] hover:border-[#005447] dark:hover:border-[#67E2C8] flex items-center justify-between transition-colors text-left"
          >
            <div>
              <span className="font-sans text-xs font-semibold text-[#191919] dark:text-[#F5F1E7] block">
                Chrome On-Device AI Flags (1-Click Open All)
              </span>
              <span className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">
                Opens Optimization Guide, Prompt, Writer & Rewriter flags in tabs
              </span>
            </div>
            <ExternalLink className="w-4 h-4 text-[#77776E] dark:text-[#A6A49B]" />
          </button>

          <button
            onClick={openChromeComponents}
            className="w-full p-3.5 rounded-2xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] hover:border-[#005447] dark:hover:border-[#67E2C8] flex items-center justify-between transition-colors text-left"
          >
            <div>
              <span className="font-sans text-xs font-semibold text-[#191919] dark:text-[#F5F1E7] block">
                Chrome Components Updater
              </span>
              <span className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">
                Check Gemini Nano on-device model download in chrome://components
              </span>
            </div>
            <ExternalLink className="w-4 h-4 text-[#77776E] dark:text-[#A6A49B]" />
          </button>

          <button
            onClick={openExtensionSettings}
            className="w-full p-3.5 rounded-2xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] hover:border-[#005447] dark:hover:border-[#67E2C8] flex items-center justify-between transition-colors text-left"
          >
            <div>
              <span className="font-sans text-xs font-semibold text-[#191919] dark:text-[#F5F1E7] block">
                Extension Permissions
              </span>
              <span className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">
                Manage Chrome extension permissions & shortcuts
              </span>
            </div>
            <ExternalLink className="w-4 h-4 text-[#77776E] dark:text-[#A6A49B]" />
          </button>
        </div>

        {/* Version info */}
        <div className="text-center pt-2">
          <span className="font-mono text-[10px] text-[#77776E] dark:text-[#A6A49B]">
            Pentone v{version || '1.0.0'} · 100% On-Device
          </span>
        </div>
      </div>
    </div>
  )
}
