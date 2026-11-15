import React, { useState, useEffect } from 'react'
import { ArrowLeft, ExternalLink, SunMedium, MoonStar, Laptop, Sparkles, Check, Mic, Volume2, Palette, Compass, Sliders, Save, RotateCcw } from 'lucide-react'
import { loadSettings, saveSettings, type PentoneSettings } from '../lib/settings'
import { useTheme, type ThemeMode } from '../lib/theme-context'
import { MicSelector } from '../components/mic-selector'
import { VoiceSelector } from '../components/voice-selector'
import { LocalSetupPanel } from '../components/local-setup-panel'
import { 
  openAllRequiredFlags, 
  openOptimizationGuideFlagsPage, 
  openPromptAPIFlagsPage, 
  openWriterFlagsPage, 
  openRewriterFlagsPage, 
  openSummarizerFlagsPage,
  openComponentsPage,
  openOnDeviceInternalsPage 
} from '../lib/alert-context'

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
          className="px-3 sm:px-3.5 py-1.5 rounded-xl font-sans text-xs font-semibold bg-[#005447] hover:bg-[#003F36] dark:bg-[#67E2C8] dark:hover:bg-[#52C5AD] text-white dark:text-[#171816] transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-xs flex items-center gap-1.5 shrink-0"
        >
          {showSavedToast ? (
            <>
              <Check className="w-3.5 h-3.5 shrink-0" />
              <span>Saved!</span>
            </>
          ) : (
            <>
              <Save className="w-3.5 h-3.5 shrink-0" />
              <span>Save</span>
            </>
          )}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-3.5 sm:space-y-4 w-full min-w-0">
        <div className="p-3.5 rounded-2xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] space-y-3">
          <h3 className="text-sm font-bold">Local AI Engine Setup</h3>
          <LocalSetupPanel />
        </div>
        {/* Appearance Section */}
        <div className="p-3.5 sm:p-4 rounded-2xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] space-y-3 w-full min-w-0 break-words">
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <Palette className="w-4 h-4 text-[#005447] dark:text-[#67E2C8] shrink-0" />
              <h3 className="font-display text-sm font-bold text-[#191919] dark:text-[#F5F1E7]">
                Appearance & Theme
              </h3>
            </div>
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
              <SunMedium className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-500 shrink-0" />
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
              <MoonStar className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-cyan-400 shrink-0" />
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
              <Laptop className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span>System</span>
            </button>
          </div>
        </div>

        {/* Audio Devices Section */}
        <div className="p-4 rounded-2xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] space-y-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <Volume2 className="w-4 h-4 text-[#005447] dark:text-[#67E2C8] shrink-0" />
              <h3 className="font-display text-sm font-bold text-[#191919] dark:text-[#F5F1E7]">
                Audio & Speech
              </h3>
            </div>
            <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B]">
              Configure your microphone and assistant voice. Recognition and speech use on-device services only.
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
                id="picovoice-key"
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
            <div className="flex items-center gap-1.5">
              <Compass className="w-4 h-4 text-[#005447] dark:text-[#67E2C8] shrink-0" />
              <h3 className="font-display text-sm font-bold text-[#191919] dark:text-[#F5F1E7]">
                Browsing Interactions
              </h3>
            </div>
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
          <div className="p-3.5 rounded-2xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <Sliders className="w-4 h-4 text-[#005447] dark:text-[#67E2C8] shrink-0" />
                  <span className="font-sans text-xs font-bold text-[#191919] dark:text-[#F5F1E7] block">
                    Chrome On-Device AI Flags
                  </span>
                </div>
                <span className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">
                  Click any button to open its exact Chrome flag or tool, or open all at once
                </span>
              </div>
              <button
                onClick={openAllRequiredFlags}
                className="px-2.5 py-1 rounded-xl bg-[#005447] dark:bg-[#67E2C8] text-white dark:text-[#171816] text-[10.5px] font-bold hover:opacity-90 active:scale-95 transition-all shadow-xs flex items-center gap-1 shrink-0 cursor-pointer"
                title="Open all required Chrome flags and updater tabs at once"
              >
                <span>1-Click All</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </button>
            </div>

            {/* Individual Flag & Tool Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-0.5 text-[11px]">
              <button
                onClick={openPromptAPIFlagsPage}
                className="p-2 rounded-xl bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] hover:border-[#005447] dark:hover:border-[#67E2C8] flex items-center justify-between text-left transition-colors cursor-pointer"
                title="Prompt API for Gemini Nano: Set to Enabled"
              >
                <div className="truncate pr-1">
                  <span className="font-semibold text-[#191919] dark:text-[#F5F1E7] block truncate">1. Prompt API (Core)</span>
                  <span className="text-[9.5px] text-emerald-700 dark:text-emerald-400 font-bold truncate">Set to &ldquo;Enabled&rdquo;</span>
                </div>
                <ExternalLink className="w-3 h-3 text-[#77776E] shrink-0" />
              </button>

              <button
                onClick={openRewriterFlagsPage}
                className="p-2 rounded-xl bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] hover:border-[#005447] dark:hover:border-[#67E2C8] flex items-center justify-between text-left transition-colors cursor-pointer"
                title="Rewriter API for Gemini Nano: Set to Enabled"
              >
                <div className="truncate pr-1">
                  <span className="font-semibold text-[#191919] dark:text-[#F5F1E7] block truncate">2. Rewriter API</span>
                  <span className="text-[9.5px] text-emerald-700 dark:text-emerald-400 font-bold truncate">Set to &ldquo;Enabled&rdquo;</span>
                </div>
                <ExternalLink className="w-3 h-3 text-[#77776E] shrink-0" />
              </button>

              <button
                onClick={openWriterFlagsPage}
                className="p-2 rounded-xl bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] hover:border-[#005447] dark:hover:border-[#67E2C8] flex items-center justify-between text-left transition-colors cursor-pointer"
                title="Writer API for Gemini Nano: Set to Enabled"
              >
                <div className="truncate pr-1">
                  <span className="font-semibold text-[#191919] dark:text-[#F5F1E7] block truncate">3. Writer API</span>
                  <span className="text-[9.5px] text-emerald-700 dark:text-emerald-400 font-bold truncate">Set to &ldquo;Enabled&rdquo;</span>
                </div>
                <ExternalLink className="w-3 h-3 text-[#77776E] shrink-0" />
              </button>

              <button
                onClick={openSummarizerFlagsPage}
                className="p-2 rounded-xl bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] hover:border-[#005447] dark:hover:border-[#67E2C8] flex items-center justify-between text-left transition-colors cursor-pointer"
                title="Summarization API for Gemini Nano: Set to Enabled"
              >
                <div className="truncate pr-1">
                  <span className="font-semibold text-[#191919] dark:text-[#F5F1E7] block truncate">4. Summarizer API</span>
                  <span className="text-[9.5px] text-emerald-700 dark:text-emerald-400 font-bold truncate">Set to &ldquo;Enabled&rdquo;</span>
                </div>
                <ExternalLink className="w-3 h-3 text-[#77776E] shrink-0" />
              </button>

              <button
                onClick={openOptimizationGuideFlagsPage}
                className="p-2 rounded-xl bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] hover:border-[#005447] dark:hover:border-[#67E2C8] flex items-center justify-between text-left transition-colors cursor-pointer"
                title="Optimization Guide on device model: Set to Enabled BypassPerfRequirement"
              >
                <div className="truncate pr-1">
                  <span className="font-semibold text-[#191919] dark:text-[#F5F1E7] block truncate">5. Optimization Guide</span>
                  <span className="text-[9.5px] text-emerald-700 dark:text-emerald-400 font-bold truncate">Set to &ldquo;BypassPerfRequirement&rdquo;</span>
                </div>
                <ExternalLink className="w-3 h-3 text-[#77776E] shrink-0" />
              </button>

              <button
                onClick={openComponentsPage}
                className="p-2 rounded-xl bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] hover:border-[#005447] dark:hover:border-[#67E2C8] flex items-center justify-between text-left transition-colors cursor-pointer"
                title="Download Gemini Nano model in Chrome Components"
              >
                <div className="truncate pr-1">
                  <span className="font-semibold text-[#191919] dark:text-[#F5F1E7] block truncate">6. Model Components</span>
                  <span className="text-[9.5px] text-emerald-700 dark:text-emerald-400 font-bold truncate">Check chrome://components</span>
                </div>
                <ExternalLink className="w-3 h-3 text-[#77776E] shrink-0" />
              </button>

              <button
                onClick={openOnDeviceInternalsPage}
                className="sm:col-span-2 p-2 rounded-xl bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] hover:border-[#005447] dark:hover:border-[#67E2C8] flex items-center justify-between text-left transition-colors cursor-pointer"
                title="Diagnostics & Force Load in Chrome AI Internals"
              >
                <div className="truncate pr-1">
                  <span className="font-semibold text-[#191919] dark:text-[#F5F1E7] block truncate">7. AI Internals (Diagnostics)</span>
                  <span className="text-[9.5px] text-emerald-700 dark:text-emerald-400 font-bold truncate">Visit chrome://on-device-internals &rarr; Click &ldquo;Load Default&rdquo;</span>
                </div>
                <ExternalLink className="w-3 h-3 text-[#77776E] shrink-0" />
              </button>
            </div>

            {/* Detailed Point-by-Point Setup Guide */}
            <div className="p-3 rounded-xl bg-[#EBE7D0]/70 dark:bg-[#1C1D19] border border-[#DDDCCB]/80 dark:border-[#373832] space-y-2.5 text-[10.5px]">
              <div className="flex items-center gap-1.5 font-bold text-[#005447] dark:text-[#67E2C8] text-[11.5px]">
                <Sparkles className="w-4 h-4 shrink-0" />
                <span>Step-by-Step Setup Guide (Gemini Nano)</span>
              </div>
              
              <div className="space-y-2 text-[#44443D] dark:text-[#C5C4B5] leading-relaxed">
                {/* Step 1 */}
                <div className="p-2.5 rounded-lg bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB]/50 dark:border-[#373832]/70 space-y-2 shadow-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 rounded-md bg-[#005447] text-white dark:bg-[#67E2C8] dark:text-[#171816] font-bold text-[9.5px]">
                      STEP 1
                    </span>
                    <span className="font-bold text-[#191919] dark:text-[#F5F1E7] text-[11px]">
                      Enable Chrome On-Device AI Flags
                    </span>
                  </div>
                  <p className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">
                    Click each flag button above (or <strong>1-Click All</strong>) and set the dropdown values:
                  </p>
                  <div className="space-y-1.5 pl-1 text-[10px]">
                    <div className="flex items-start gap-1.5">
                      <span className="text-[#005447] dark:text-[#67E2C8] font-bold shrink-0">•</span>
                      <span>
                        <strong>Prompt API:</strong> Open <code>#prompt-api-for-gemini-nano</code> &rarr; set to <strong className="text-emerald-700 dark:text-emerald-400">Enabled</strong>.
                      </span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="text-[#005447] dark:text-[#67E2C8] font-bold shrink-0">•</span>
                      <span>
                        <strong>Rewriter API:</strong> Open <code>#rewriter-api-for-gemini-nano</code> &rarr; set to <strong className="text-emerald-700 dark:text-emerald-400">Enabled</strong>.
                      </span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="text-[#005447] dark:text-[#67E2C8] font-bold shrink-0">•</span>
                      <span>
                        <strong>Writer API:</strong> Open <code>#writer-api-for-gemini-nano</code> &rarr; set to <strong className="text-emerald-700 dark:text-emerald-400">Enabled</strong>.
                      </span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="text-[#005447] dark:text-[#67E2C8] font-bold shrink-0">•</span>
                      <span>
                        <strong>Summarizer API:</strong> Open <code>#summarization-api-for-gemini-nano</code> &rarr; set to <strong className="text-emerald-700 dark:text-emerald-400">Enabled</strong>.
                      </span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="text-[#005447] dark:text-[#67E2C8] font-bold shrink-0">•</span>
                      <span>
                        <strong>Optimization Guide (Hardware Bypass):</strong> Open <code>#optimization-guide-on-device-model</code> &rarr; set to <strong className="text-emerald-700 dark:text-emerald-400">Enabled BypassPerfRequirement</strong> (allows Gemini Nano to run on laptops &amp; integrated GPUs).
                      </span>
                    </div>
                  </div>
                  <div className="mt-1 p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[9.5px] text-amber-800 dark:text-amber-300 flex items-center gap-1.5 font-medium">
                    <span>🔄</span>
                    <span><strong>Action:</strong> Click the blue <strong>&ldquo;Relaunch&rdquo;</strong> button that appears at the bottom of Chrome to apply changes.</span>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="p-2.5 rounded-lg bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB]/50 dark:border-[#373832]/70 space-y-2 shadow-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 rounded-md bg-[#005447] text-white dark:bg-[#67E2C8] dark:text-[#171816] font-bold text-[9.5px]">
                      STEP 2
                    </span>
                    <span className="font-bold text-[#191919] dark:text-[#F5F1E7] text-[11px]">
                      Download Gemini Nano Model Files (~2 GB)
                    </span>
                  </div>
                  <p className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">
                    After Chrome relaunches, download the local weights to your browser:
                  </p>
                  <div className="space-y-1.5 pl-1 text-[10px]">
                    <div className="flex items-start gap-1.5">
                      <span className="text-[#005447] dark:text-[#67E2C8] font-bold shrink-0">•</span>
                      <span>Click <strong>6. Model Components</strong> above (or visit <code>chrome://components</code> in a new tab).</span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="text-[#005447] dark:text-[#67E2C8] font-bold shrink-0">•</span>
                      <span>Scroll down until you see <strong>Optimization Guide On Device Model</strong>.</span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="text-[#005447] dark:text-[#67E2C8] font-bold shrink-0">•</span>
                      <span>Click the <strong className="text-emerald-700 dark:text-emerald-400">&ldquo;Check for update&rdquo;</strong> button.</span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="text-[#005447] dark:text-[#67E2C8] font-bold shrink-0">•</span>
                      <span>Chrome will show <em>Downloading...</em>. Wait until it displays <strong className="text-emerald-700 dark:text-emerald-400">Up-to-date</strong> (version <code>2024.x</code> or newer).</span>
                    </div>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="p-2.5 rounded-lg bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB]/50 dark:border-[#373832]/70 space-y-2 shadow-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 rounded-md bg-[#005447] text-white dark:bg-[#67E2C8] dark:text-[#171816] font-bold text-[9.5px]">
                      STEP 3
                    </span>
                    <span className="font-bold text-[#191919] dark:text-[#F5F1E7] text-[11px]">
                      Requirements &amp; Troubleshooting
                    </span>
                  </div>
                  <div className="space-y-1.5 pl-1 text-[10px]">
                    <div className="flex items-start gap-1.5">
                      <span className="text-[#005447] dark:text-[#67E2C8] font-bold shrink-0">•</span>
                      <span>
                        <strong>20 GB Free Disk Space:</strong> Chrome strictly requires at least 20 GB free space on your system drive (C: drive). If space is under 20 GB, Chrome pauses model download without warning.
                      </span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="text-[#005447] dark:text-[#67E2C8] font-bold shrink-0">•</span>
                      <span>
                        <strong>Force Load / Diagnostics:</strong> If the model does not trigger download, click <strong>7. AI Internals</strong> above (<code>chrome://on-device-internals</code>), open the <em>Model Execution</em> tab, and click <strong className="text-emerald-700 dark:text-emerald-400">&ldquo;Load Default&rdquo;</strong>.
                      </span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="text-[#005447] dark:text-[#67E2C8] font-bold shrink-0">•</span>
                      <span>
                        <strong>Browser Version:</strong> Make sure you are using Chrome 128 or newer (Chrome Stable, Dev, or Canary).
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

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
            Pentone v{version || '1.0.0'} · On-Device AI
          </span>
        </div>
      </div>
    </div>
  )
}
