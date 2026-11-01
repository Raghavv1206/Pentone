import React, { useState, useEffect } from 'react'
import { 
  ArrowLeft, Globe, Volume2, Cpu, Headphones, Sliders, Shield, 
  ExternalLink, User, CheckCircle, AlertTriangle, Trash2, Sun, Moon, Laptop, Check, Sparkles 
} from 'lucide-react'
import { VoiceEnrollmentService, type ProfileStatusInfo } from '../lib/audio/voice-enrollment-service'
import { voiceAuthorizationManager } from '../lib/audio/voice-authorization-manager'
import { loadActiveUserId, saveActiveUserId, type PentoneSettings, DEFAULT_SETTINGS } from '../lib/settings'
import { useMediaDevice } from '../lib/media-device-context'
import { useTTS } from '../lib/tts-context'
import { useTheme } from '../lib/theme-context'
import { Switch } from '../components/ui/switch'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { PROACTIVE_CONTEXT_LIMIT, MAX_CONTEXT_SIZE } from '../lib/summarizer'

interface SettingsScreenProps {
  onBack: () => void
  onNavigateToEnrollment?: (userId: string) => void
}

type SettingsTab = 'general' | 'voice' | 'ai' | 'privacy' | 'advanced'

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ onBack, onNavigateToEnrollment }) => {
  const { theme, setTheme } = useTheme()
  const [settings, setSettings] = useState<PentoneSettings>(DEFAULT_SETTINGS)
  const [originalSettings, setOriginalSettings] = useState<PentoneSettings>(DEFAULT_SETTINGS)
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [version, setVersion] = useState<string>('1.0.0')
  const [hasChanges, setHasChanges] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [activeUserId, setActiveUserId] = useState<string>('default_user')
  const [profileStatus, setProfileStatus] = useState<ProfileStatusInfo | null>(null)
  const [previewError, setPreviewError] = useState(false)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const { availableMics, selectedMicId, setSelectedMicId } = useMediaDevice()
  const { availableVoices, selectedVoiceUri, setSelectedVoiceUri, previewVoice } = useTTS()

  // Load active account ID on mount
  useEffect(() => {
    loadActiveUserId().then((id) => {
      setActiveUserId(id)
      voiceAuthorizationManager.switchAccount(id)
    }).catch(() => {})
  }, [])

  // Load profile status when active user changes
  useEffect(() => {
    const service = new VoiceEnrollmentService()
    service.getProfileStatus(activeUserId).then(setProfileStatus).catch(() => {})
  }, [activeUserId])

  // Load settings and extension version
  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get(['pentone_settings', 'marionette_settings'], (result) => {
        const stored = result.pentone_settings || result.marionette_settings
        const loadedSettings = stored ? { ...DEFAULT_SETTINGS, ...stored } : DEFAULT_SETTINGS
        setSettings(loadedSettings)
        setOriginalSettings(loadedSettings)
      })
      try {
        const manifest = chrome.runtime.getManifest()
        setVersion(manifest.version || '1.0.0')
      } catch {
        setVersion('1.0.0')
      }
    }
  }, [])

  const handleToggle = (key: keyof PentoneSettings) => {
    const newSettings = { ...settings, [key]: !settings[key] }
    setSettings(newSettings)
    setHasChanges(true)
  }

  const handleSelectChange = <K extends keyof PentoneSettings>(key: K, value: PentoneSettings[K]) => {
    const newSettings = { ...settings, [key]: value }
    setSettings(newSettings)
    setHasChanges(true)
  }

  const handleApply = () => {
    setShowConfirmDialog(true)
  }

  const confirmApply = async () => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ 
        pentone_settings: settings, 
        marionette_settings: settings 
      })
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
        if (tabs[0]?.id) {
          chrome.tabs.reload(tabs[0].id)
        }
      } catch {}
    }
    
    setHasChanges(false)
    setOriginalSettings(settings)
    setShowConfirmDialog(false)
    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 2500)
  }

  const handleVoicePreview = async () => {
    if (!selectedVoiceUri || isPreviewing) return
    setIsPreviewing(true)
    const success = await previewVoice(selectedVoiceUri)
    if (!success) {
      setPreviewError(true)
      setTimeout(() => setPreviewError(false), 2000)
    }
    setIsPreviewing(false)
  }

  const handleDeleteProfile = async () => {
    if (!window.confirm(`Delete voice biometric profile for '${activeUserId}'? Universal voice commands will continue to function normally without biometric profile matching.`)) {
      return
    }
    try {
      const service = new VoiceEnrollmentService()
      await service.deleteProfile(activeUserId)
      const updated = await service.getProfileStatus(activeUserId)
      setProfileStatus(updated)
    } catch (err: any) {
      alert(`Failed to delete profile: ${err.message}`)
    }
  }

  const tabs: Array<{ id: SettingsTab; label: string; icon: React.ReactNode }> = [
    { id: 'general', label: 'General', icon: <Sliders className="w-3.5 h-3.5" /> },
    { id: 'voice', label: 'Voice', icon: <Volume2 className="w-3.5 h-3.5" /> },
    { id: 'ai', label: 'AI & Models', icon: <Cpu className="w-3.5 h-3.5" /> },
    { id: 'privacy', label: 'Privacy', icon: <Shield className="w-3.5 h-3.5" /> },
    { id: 'advanced', label: 'Advanced', icon: <ExternalLink className="w-3.5 h-3.5" /> }
  ]

  return (
    <div className="w-full h-full bg-[#FFFEEF] dark:bg-[#171816] text-[#191919] dark:text-[#F5F1E7] flex flex-col min-h-0 overflow-hidden select-none font-sans">
      {/* Sticky Header */}
      <header className="flex-shrink-0 p-3.5 border-b border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF]/90 dark:bg-[#171816]/90 backdrop-blur-md sticky top-0 z-20 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <button
            onClick={onBack}
            className="p-1.5 hover:bg-[#F3F1DF] dark:hover:bg-[#22231F] text-[#77776E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] rounded-lg transition-colors"
            title="Back to Pentone"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="font-display font-bold text-base text-[#191919] dark:text-[#F5F1E7]">
              Settings
            </div>
            <div className="text-[10px] text-[#77776E] dark:text-[#A6A49B] hidden sm:block">
              Preferences & On-Device Configuration
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {saveSuccess && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
              <Check className="w-3.5 h-3.5" /> Saved
            </span>
          )}
          {hasChanges && (
            <span className="w-2 h-2 rounded-full bg-[#005447] dark:bg-[#67E2C8] animate-pulse" title="Unsaved changes" />
          )}
          <Button
            variant={hasChanges ? 'forest' : 'secondary'}
            size="sm"
            onClick={handleApply}
            disabled={!hasChanges}
          >
            Apply Changes
          </Button>
        </div>
      </header>

      {/* Tabs Row */}
      <nav className="px-3 pt-2 pb-1.5 border-b border-[#DDDCCB] dark:border-[#373832] bg-[#F3F1DF]/50 dark:bg-[#22231F]/50 flex items-center gap-1 overflow-x-auto no-scrollbar shrink-0">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all shrink-0 ${
              activeTab === tab.id
                ? 'bg-[#E9D2FF] text-[#191919] font-semibold border border-[#D5B5F5] dark:bg-[#CDB0F3] dark:text-[#171816]'
                : 'text-[#77776E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] hover:bg-[#F3F1DF] dark:hover:bg-[#22231F]'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* Main Scrollable Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {/* TAB 1: GENERAL */}
        {activeTab === 'general' && (
          <div className="space-y-4 max-w-xl mx-auto">
            <Card className="p-4 space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-[#DDDCCB]/60 dark:border-[#373832]/60">
                <Sun className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#191919] dark:text-[#F5F1E7]">
                  Appearance & Theme
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {[
                  { mode: 'light' as const, label: 'Editorial Ivory', icon: <Sun className="w-4 h-4" /> },
                  { mode: 'dark' as const, label: 'Warm Charcoal', icon: <Moon className="w-4 h-4" /> },
                  { mode: 'system' as const, label: 'System Sync', icon: <Laptop className="w-4 h-4" /> }
                ].map(opt => (
                  <button
                    key={opt.mode}
                    onClick={() => {
                      setTheme(opt.mode)
                      setSettings(prev => ({ ...prev, theme: opt.mode }))
                      setHasChanges(true)
                    }}
                    className={`p-3 rounded-xl border text-xs font-medium flex flex-col items-center gap-2 transition-all ${
                      theme === opt.mode
                        ? 'bg-[#E9D2FF] text-[#191919] font-bold border-[#D5B5F5] dark:bg-[#CDB0F3] dark:text-[#171816] shadow-sm'
                        : 'bg-[#FFFEEF] dark:bg-[#171816] border-[#DDDCCB] dark:border-[#373832] text-[#77776E] dark:text-[#A6A49B] hover:text-[#191919]'
                    }`}
                  >
                    {opt.icon}
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </Card>

            <Card className="p-4 space-y-3.5">
              <div className="flex items-center gap-2 pb-2 border-b border-[#DDDCCB]/60 dark:border-[#373832]/60">
                <Sliders className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#191919] dark:text-[#F5F1E7]">
                  Browser Automation & Overlays
                </span>
              </div>

              <Switch
                label="Floating Browser Pill"
                description="Show compact floating controls injected on webpages for quick voice capture"
                checked={Boolean(settings.captureOverlayEnabled)}
                onChange={() => handleToggle('captureOverlayEnabled')}
              />

              <div className="pt-2 border-t border-[#DDDCCB]/40 dark:border-[#373832]/40">
                <Switch
                  label="Text-Selection Contextual Toolbar"
                  description="Display floating actions (Explain, Summarize, Rewrite) when text is highlighted on webpage"
                  checked={Boolean(settings.textSelectionEnabled)}
                  onChange={() => handleToggle('textSelectionEnabled')}
                />
              </div>

              <div className="pt-2 border-t border-[#DDDCCB]/40 dark:border-[#373832]/40">
                <Switch
                  label="Global Keyboard Shortcuts"
                  description="Enable Cmd+Shift+S (Screenshot), Cmd+Shift+A (Audio), and Spacebar (PTT)"
                  checked={Boolean(settings.globalShortcutsEnabled)}
                  onChange={() => handleToggle('globalShortcutsEnabled')}
                />
              </div>
            </Card>
          </div>
        )}

        {/* TAB 2: VOICE */}
        {activeTab === 'voice' && (
          <div className="space-y-4 max-w-xl mx-auto">
            <Card className="p-4 space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-[#DDDCCB]/60 dark:border-[#373832]/60">
                <Globe className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#191919] dark:text-[#F5F1E7]">
                  Speech Recognition Language
                </span>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-semibold text-[#191919] dark:text-[#F5F1E7] block">
                    Recognition Dialect
                  </span>
                  <span className="text-[11px] text-[#77776E] dark:text-[#A6A49B]">
                    Primary target dialect for Whisper ASR model
                  </span>
                </div>
                <select
                  value={settings.speechLanguage || 'en-IN'}
                  onChange={(e) => handleSelectChange('speechLanguage', e.target.value as any)}
                  className="rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816] px-2.5 py-1.5 text-xs text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447]"
                >
                  <option value="en-IN">Hinglish / Indian English (en-IN)</option>
                  <option value="hi-IN">Hindi / हिन्दी (hi-IN)</option>
                  <option value="en-US">English - US (en-US)</option>
                </select>
              </div>
            </Card>

            <Card className="p-4 space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-[#DDDCCB]/60 dark:border-[#373832]/60">
                <Volume2 className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#191919] dark:text-[#F5F1E7]">
                  Interaction Mode
                </span>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-semibold text-[#191919] dark:text-[#F5F1E7] block">
                    Voice Activation
                  </span>
                  <span className="text-[11px] text-[#77776E] dark:text-[#A6A49B]">
                    Microphone trigger mechanism
                  </span>
                </div>
                <select
                  value={settings.voiceInteractionModel || 'push_to_talk'}
                  onChange={(e) => handleSelectChange('voiceInteractionModel', e.target.value as any)}
                  className="rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816] px-2.5 py-1.5 text-xs text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447]"
                >
                  <option value="push_to_talk">Push-to-Talk (Recommended · Fail-Closed)</option>
                  <option value="wake_word">Wake-Word Window ("Hey Marionette")</option>
                  <option value="full_duplex">Full-Duplex Conversational (Always-On Mic)</option>
                </select>
              </div>

              <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B] leading-relaxed pt-1 border-t border-[#DDDCCB]/40 dark:border-[#373832]/40">
                {settings.voiceInteractionModel === 'wake_word'
                  ? 'Listens for "Hey Marionette" to open a 5-second command window.'
                  : settings.voiceInteractionModel === 'full_duplex'
                  ? 'Maintains continuous microphone capture with acoustic echo cancellation and instant user barge-in.'
                  : 'Hold spacebar or the on-screen mic button to issue authorized commands. Releasing outside cancels immediately.'}
              </p>
            </Card>

            <Card className="p-4 space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-[#DDDCCB]/60 dark:border-[#373832]/60">
                <Headphones className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#191919] dark:text-[#F5F1E7]">
                  Hardware Devices & Audio Synthesis
                </span>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-semibold text-[#191919] dark:text-[#F5F1E7] block">
                    Microphone Device
                  </span>
                  <span className="text-[11px] text-[#77776E] dark:text-[#A6A49B]">
                    Hardware audio input capture
                  </span>
                </div>
                <select
                  value={selectedMicId || ''}
                  onChange={(e) => setSelectedMicId(e.target.value)}
                  className="rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816] px-2.5 py-1.5 text-xs text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447] max-w-full sm:max-w-[200px] truncate"
                >
                  {availableMics.map(m => (
                    <option key={m.deviceId} value={m.deviceId}>
                      {m.label || `Microphone ${m.deviceId.substring(0, 8)}`}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-2 border-t border-[#DDDCCB]/40 dark:border-[#373832]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-semibold text-[#191919] dark:text-[#F5F1E7] block">
                    Assistant Voice Output
                  </span>
                  <span className="text-[11px] text-[#77776E] dark:text-[#A6A49B]">
                    Synthesizer voice for spoken confirmations
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <select
                    value={selectedVoiceUri || ''}
                    onChange={(e) => setSelectedVoiceUri(e.target.value)}
                    className="rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816] px-2.5 py-1.5 text-xs text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447] max-w-full sm:max-w-[180px] truncate"
                  >
                    {availableVoices.map(v => (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={handleVoicePreview}
                    disabled={isPreviewing}
                    title="Test voice playback"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* TAB 3: AI & MODELS */}
        {activeTab === 'ai' && (
          <div className="space-y-4 max-w-xl mx-auto">
            <Card className="p-4 space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-[#DDDCCB]/60 dark:border-[#373832]/60">
                <Cpu className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#191919] dark:text-[#F5F1E7]">
                  On-Device Whisper Model
                </span>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-semibold text-[#191919] dark:text-[#F5F1E7] block">
                    Whisper Quantized Model
                  </span>
                  <span className="text-[11px] text-[#77776E] dark:text-[#A6A49B]">
                    Local Transformers.js model executing in WASM
                  </span>
                </div>
                <select
                  value={settings.whisperModel || 'Xenova/whisper-base'}
                  onChange={(e) => handleSelectChange('whisperModel', e.target.value as any)}
                  className="rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816] px-2.5 py-1.5 text-xs text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447]"
                >
                  <option value="Xenova/whisper-base">whisper-base (Recommended · High Accuracy)</option>
                  <option value="Xenova/whisper-tiny">whisper-tiny (Ultra-Fast · Low Memory)</option>
                  <option value="Xenova/whisper-tiny.en">whisper-tiny.en (English Only)</option>
                </select>
              </div>

              <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B] leading-relaxed pt-1 border-t border-[#DDDCCB]/40 dark:border-[#373832]/40">
                Model weights remain cached persistently in client-side IndexedDB after initial load, guaranteeing instant warm reuse across consecutive voice turns.
              </p>
            </Card>

            <Card className="p-4 space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-[#DDDCCB]/60 dark:border-[#373832]/60">
                <Sparkles className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#191919] dark:text-[#F5F1E7]">
                  Chrome Prompt API Context Quota
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="p-2.5 rounded-lg bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832]">
                  <div className="text-[10px] text-[#77776E] dark:text-[#A6A49B] uppercase font-sans">Hard Quota</div>
                  <div className="text-base font-bold text-[#191919] dark:text-[#F5F1E7] mt-0.5">{MAX_CONTEXT_SIZE} tokens</div>
                </div>
                <div className="p-2.5 rounded-lg bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832]">
                  <div className="text-[10px] text-[#77776E] dark:text-[#A6A49B] uppercase font-sans">Compaction Limit</div>
                  <div className="text-base font-bold text-[#005447] dark:text-[#67E2C8] mt-0.5">{PROACTIVE_CONTEXT_LIMIT} tokens</div>
                </div>
              </div>

              <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B] leading-relaxed">
                Pentone proactively compacts older conversation history before reaching 5,500 tokens, maintaining an unbroken reserve buffer to prevent model context window overflow errors.
              </p>
            </Card>
          </div>
        )}

        {/* TAB 4: PRIVACY */}
        {activeTab === 'privacy' && (
          <div className="space-y-4 max-w-xl mx-auto">
            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-[#DDDCCB]/60 dark:border-[#373832]/60">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
                  <span className="text-xs font-bold uppercase tracking-wider text-[#191919] dark:text-[#F5F1E7]">
                    Voice Biometric Identity
                  </span>
                </div>
                {profileStatus?.status === 'ENROLLED' ? (
                  <Badge variant="success" size="xs" icon={<CheckCircle className="w-3 h-3" />}>
                    Enrolled
                  </Badge>
                ) : (
                  <Badge variant="outline" size="xs">
                    Not Enrolled
                  </Badge>
                )}
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                <span className="text-xs text-[#191919] dark:text-[#F5F1E7] flex items-center gap-1.5 font-medium">
                  <User className="w-3.5 h-3.5 text-[#77776E]" /> Canonical Account:
                </span>
                <select
                  value={activeUserId}
                  onChange={(e) => {
                    const newId = e.target.value
                    setActiveUserId(newId)
                    saveActiveUserId(newId)
                    voiceAuthorizationManager.switchAccount(newId)
                  }}
                  className="rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816] px-2.5 py-1 text-xs text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447]"
                >
                  <option value="default_user">default_user (Primary)</option>
                  <option value="user_work">user_work (Work)</option>
                  <option value="user_personal">user_personal (Personal)</option>
                </select>
              </div>

              <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B] leading-relaxed">
                Optional on-device biometric personalization with AES-256-GCM encryption. Universal Voice authorizes all intentional PTT commands regardless of enrollment status.
              </p>

              <div className="flex gap-2 pt-2">
                <Button
                  variant="lavender"
                  size="sm"
                  onClick={() => onNavigateToEnrollment?.(activeUserId)}
                  className="flex-1"
                >
                  {profileStatus?.status === 'ENROLLED' ? 'Manage / Re-enroll Profile' : 'Enroll Voice Profile'}
                </Button>
                {profileStatus?.status === 'ENROLLED' && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={handleDeleteProfile}
                  >
                    Delete
                  </Button>
                )}
              </div>
            </Card>

            <Card className="p-4 space-y-2.5">
              <span className="text-xs font-bold uppercase tracking-wider text-[#191919] dark:text-[#F5F1E7] block">
                Local-First Security Guarantees
              </span>
              <ul className="text-xs text-[#77776E] dark:text-[#A6A49B] space-y-2 list-disc list-inside leading-relaxed">
                <li>Whisper speech recognition executes 100% locally in WebAssembly.</li>
                <li>Single-use Level B execution tokens expire automatically after 10 seconds.</li>
                <li>Voice turn grants terminate after an absolute 30-second security deadline.</li>
                <li>High-impact actions (file writes, account switches) require explicit confirmation.</li>
              </ul>
            </Card>
          </div>
        )}

        {/* TAB 5: ADVANCED */}
        {activeTab === 'advanced' && (
          <div className="space-y-4 max-w-xl mx-auto">
            <Card className="p-4 space-y-3">
              <span className="text-xs font-bold uppercase tracking-wider text-[#191919] dark:text-[#F5F1E7] block">
                System & Chromium Flags
              </span>
              <div className="space-y-2 text-xs">
                <button
                  onClick={() => chrome.tabs.create({ url: 'chrome://flags/#optimization-guide-on-device-model' })}
                  className="w-full p-2.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816] hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] text-left flex items-center justify-between transition-colors"
                >
                  <span>Open Chromium On-Device AI Model Flags</span>
                  <ExternalLink className="w-3.5 h-3.5 text-[#77776E]" />
                </button>
                <button
                  onClick={() => chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id })}
                  className="w-full p-2.5 rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816] hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] text-left flex items-center justify-between transition-colors"
                >
                  <span>Extension Management & Permissions</span>
                  <ExternalLink className="w-3.5 h-3.5 text-[#77776E]" />
                </button>
              </div>
            </Card>

            <div className="text-center text-xs text-[#77776E] dark:text-[#A6A49B] pt-4 font-mono">
              Pentone Browser Agent v{version} · Manifest V3
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Dialog on Apply */}
      {showConfirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl border border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816] p-5 space-y-4 shadow-xl">
            <h3 className="font-display text-base font-semibold text-[#191919] dark:text-[#F5F1E7]">
              Apply Settings & Reload Active Tab?
            </h3>
            <p className="text-xs text-[#77776E] dark:text-[#A6A49B] leading-relaxed">
              Applying changes updates local storage and refreshes the current tab to instantiate updated browser content scripts.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setShowConfirmDialog(false)}>
                Cancel
              </Button>
              <Button variant="forest" size="sm" onClick={confirmApply}>
                Confirm & Apply
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
