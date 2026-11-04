import React, { useState, useEffect } from 'react'
import { 
  ArrowLeft, Globe, Volume2, Cpu, Headphones, Sliders, Shield, 
  ExternalLink, User, CheckCircle, AlertTriangle, Trash2, Sun, Moon, Laptop, Check, Sparkles,
  Brain, Download, RefreshCw, FileText, Mic, CheckCircle2, XCircle, Camera
} from 'lucide-react'
import { VoiceEnrollmentService, type ProfileStatusInfo } from '../lib/audio/voice-enrollment-service'
import { voiceAuthorizationManager } from '../lib/audio/voice-authorization-manager'
import { loadActiveUserId, saveActiveUserId, type PentoneSettings, DEFAULT_SETTINGS } from '../lib/settings'
import { useMediaDevice } from '../lib/media-device-context'
import { useTTS } from '../lib/tts-context'
import { useTheme } from '../lib/theme-context'
import { useModelProvisioning } from '../lib/model-provisioning-context'
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
  const modelProv = useModelProvisioning()

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
            {/* Unified Local AI Engine Overview Card */}
            <Card className="p-4 space-y-3 bg-[#FAF9F5] dark:bg-[#1E1F1D] border-[#DDDCCB] dark:border-[#373832]">
              <div className="flex items-center justify-between pb-2 border-b border-[#DDDCCB]/60 dark:border-[#373832]/60">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
                  <span className="text-xs font-bold uppercase tracking-wider text-[#191919] dark:text-[#F5F1E7]">
                    Unified Local AI Engine
                  </span>
                </div>
                <div>
                  {modelProv.isChecking ? (
                    <Badge variant="outline" className="text-[10px]">Checking...</Badge>
                  ) : modelProv.progress.state === 'downloading' ? (
                    <Badge variant="warning" className="text-[10px]">
                      Downloading ({modelProv.progress.percent}%)
                    </Badge>
                  ) : modelProv.allCached ? (
                    <Badge variant="success" className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                      All Models Verified · Offline Ready
                    </Badge>
                  ) : modelProv.modelsCached?.qwen || modelProv.modelsCached?.embeddings || modelProv.modelsCached?.whisper || modelProv.modelsCached?.vision ? (
                    <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-400 border-amber-500/30">
                      Partially Provisioned
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">
                      Not Provisioned
                    </Badge>
                  )}
                </div>
              </div>

              <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B] leading-relaxed">
                Pentone executes all neural reasoning, semantic search, and speech recognition directly on-device via Transformers.js in WebAssembly isolates. Provisioning is a one-time user-consented download (~559 MB total).
              </p>

              {/* Overall download progress bar */}
              {modelProv.progress.state === 'downloading' && (
                <div className="space-y-1.5 p-2.5 rounded-lg bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832]">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-[#191919] dark:text-[#F5F1E7] font-medium truncate max-w-[220px]">
                      {modelProv.progress.currentFile || 'Downloading neural model assets...'}
                    </span>
                    <span className="text-[#005447] dark:text-[#67E2C8] font-mono font-bold">
                      {modelProv.progress.percent}%
                    </span>
                  </div>
                  <div className="w-full bg-[#E5E4D8] dark:bg-[#2A2B27] h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-[#005447] dark:bg-[#67E2C8] h-full transition-all duration-300 rounded-full"
                      style={{ width: `${Math.max(2, modelProv.progress.percent)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-[#77776E] dark:text-[#A6A49B]">
                    <span>{(modelProv.progress.downloadedBytes / (1024 * 1024)).toFixed(1)} MB / {(modelProv.progress.totalBytes / (1024 * 1024)).toFixed(1)} MB</span>
                    <button
                      onClick={modelProv.cancelDownload}
                      className="text-red-500 hover:text-red-600 underline font-medium"
                    >
                      Cancel Download
                    </button>
                  </div>
                </div>
              )}

              {/* Error display */}
              {modelProv.progress.error && (
                <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-[11px] text-red-600 dark:text-red-400 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <div className="font-semibold">Provisioning Error</div>
                    <div>{modelProv.progress.error}</div>
                  </div>
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => modelProv.retryDownload('all')}
                    className="text-[10px] ml-auto shrink-0"
                  >
                    Retry
                  </Button>
                </div>
              )}

              {/* Master Actions */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#DDDCCB]/40 dark:border-[#373832]/40">
                {!modelProv.allCached && modelProv.progress.state !== 'downloading' && (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={async () => {
                      if (window.confirm('Download all local AI models (~559 MB)? Requires an active internet connection during download. Once provisioned, Pentone runs completely on-device without cloud telemetry.')) {
                        await modelProv.downloadAllModels()
                      }
                    }}
                    disabled={modelProv.isChecking}
                    className="text-xs"
                  >
                    <Download className="w-3.5 h-3.5 mr-1.5" />
                    Download All Models (~559 MB)
                  </Button>
                )}

                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    await modelProv.checkOfflineReadiness(true)
                  }}
                  disabled={modelProv.isChecking || modelProv.progress.state === 'downloading'}
                  className="text-xs"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                  Verify Local Assets
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={modelProv.refresh}
                  className="text-xs ml-auto"
                  title="Recheck Readiness"
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1" />
                  Recheck Readiness
                </Button>
              </div>
            </Card>

            {/* MODEL 1: SmolLM-135M-Instruct SLM Card */}
            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-[#DDDCCB]/60 dark:border-[#373832]/60">
                <div className="flex items-center gap-2">
                  <Brain className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
                  <span className="text-xs font-bold uppercase tracking-wider text-[#191919] dark:text-[#F5F1E7]">
                    1. Primary Reasoning SLM
                  </span>
                </div>
                <div>
                  {modelProv.modelsCached?.qwen ? (
                    modelProv.isResident ? (
                      <Badge variant="success" className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                        Resident in RAM
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-teal-600 dark:text-teal-400 border-teal-500/30">
                        Cached · Verified
                      </Badge>
                    )
                  ) : modelProv.allProgress?.qwen?.state === 'downloading' ? (
                    <Badge variant="warning" className="text-[10px]">Downloading ({modelProv.allProgress.qwen.percent}%)</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">Not Provisioned</Badge>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-[#191919] dark:text-[#F5F1E7]">SmolLM-135M-Instruct (INT8)</span>
                  <span className="text-[#77776E] dark:text-[#A6A49B] font-mono text-[11px]">140 MB · Rev 7e78273 (SHA-256)</span>
                </div>
                <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B] leading-relaxed">
                  Powers offline text drafting, abstractive summarization, and neural translation on CPU/WebGPU. Pinned to immutable commit SHA with SHA-256 integrity validation.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#DDDCCB]/40 dark:border-[#373832]/40">
                {!modelProv.modelsCached?.qwen && modelProv.progress.state !== 'downloading' && (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={async () => {
                      if (window.confirm('Download SmolLM-135M model assets (~140 MB)?')) {
                        await modelProv.downloadModel('qwen')
                      }
                    }}
                    disabled={modelProv.isChecking}
                    className="text-xs"
                  >
                    <Download className="w-3.5 h-3.5 mr-1.5" />
                    Download SmolLM (140 MB)
                  </Button>
                )}

                {modelProv.modelsCached?.qwen && (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={modelProv.unloadModel}
                      disabled={!modelProv.isResident}
                      className="text-xs"
                      title={modelProv.isResident ? "Free session memory from RAM/V8 heap" : "Model is not currently resident in RAM"}
                    >
                      Unload from RAM
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={async () => {
                        if (confirm('Delete downloaded SmolLM-135M model from local cache? Generative features will fall back to deterministic algorithms.')) {
                          await modelProv.deleteModel('qwen')
                        }
                      }}
                      className="text-xs"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                      Delete
                    </Button>
                  </>
                )}
              </div>
            </Card>

            {/* MODEL 2: all-MiniLM-L6-v2 Embeddings Card */}
            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-[#DDDCCB]/60 dark:border-[#373832]/60">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
                  <span className="text-xs font-bold uppercase tracking-wider text-[#191919] dark:text-[#F5F1E7]">
                    2. Semantic Search & RAG Embeddings
                  </span>
                </div>
                <div>
                  {modelProv.modelsCached?.embeddings ? (
                    <Badge variant="outline" className="text-[10px] text-teal-600 dark:text-teal-400 border-teal-500/30">
                      Cached · 384D Verified
                    </Badge>
                  ) : modelProv.allProgress?.embeddings?.state === 'downloading' ? (
                    <Badge variant="warning" className="text-[10px]">Downloading ({modelProv.allProgress.embeddings.percent}%)</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">Not Provisioned</Badge>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-[#191919] dark:text-[#F5F1E7]">Xenova/all-MiniLM-L6-v2</span>
                  <span className="text-[#77776E] dark:text-[#A6A49B] font-mono text-[11px]">23 MB · 384-dimensional</span>
                </div>
                <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B] leading-relaxed">
                  Powers episodic memory indexing, vector semantic search in the local Vault, and natural language DOM element discovery.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#DDDCCB]/40 dark:border-[#373832]/40">
                {!modelProv.modelsCached?.embeddings && modelProv.progress.state !== 'downloading' && (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={async () => {
                      if (window.confirm('Download embedding model assets (~23 MB)?')) {
                        await modelProv.downloadModel('embeddings')
                      }
                    }}
                    disabled={modelProv.isChecking}
                    className="text-xs"
                  >
                    <Download className="w-3.5 h-3.5 mr-1.5" />
                    Download Embeddings (23 MB)
                  </Button>
                )}

                {modelProv.modelsCached?.embeddings && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={async () => {
                      if (confirm('Delete downloaded embedding model from local cache? Semantic search will fall back to keyword matching.')) {
                        await modelProv.deleteModel('embeddings')
                      }
                    }}
                    className="text-xs"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                    Delete
                  </Button>
                )}
              </div>
            </Card>

            {/* MODEL 3: Whisper Tiny Speech Recognition Card */}
            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-[#DDDCCB]/60 dark:border-[#373832]/60">
                <div className="flex items-center gap-2">
                  <Mic className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
                  <span className="text-xs font-bold uppercase tracking-wider text-[#191919] dark:text-[#F5F1E7]">
                    3. Local Speech Recognition (Whisper)
                  </span>
                </div>
                <div>
                  {modelProv.modelsCached?.whisper ? (
                    <Badge variant="outline" className="text-[10px] text-teal-600 dark:text-teal-400 border-teal-500/30">
                      Cached · 16kHz Ready
                    </Badge>
                  ) : modelProv.allProgress?.whisper?.state === 'downloading' ? (
                    <Badge variant="warning" className="text-[10px]">Downloading ({modelProv.allProgress.whisper.percent}%)</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">Not Provisioned</Badge>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-[#191919] dark:text-[#F5F1E7]">Xenova/whisper-tiny</span>
                  <span className="text-[#77776E] dark:text-[#A6A49B] font-mono text-[11px]">41 MB · Multilingual</span>
                </div>
                <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B] leading-relaxed">
                  Converts spoken Push-to-Talk audio directly to text inside a browser WebAssembly isolate. Zero audio frames are sent over the network.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#DDDCCB]/40 dark:border-[#373832]/40">
                {!modelProv.modelsCached?.whisper && modelProv.progress.state !== 'downloading' && (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={async () => {
                      if (window.confirm('Download Whisper Tiny speech recognition assets (~41 MB)?')) {
                        await modelProv.downloadModel('whisper')
                      }
                    }}
                    disabled={modelProv.isChecking}
                    className="text-xs"
                  >
                    <Download className="w-3.5 h-3.5 mr-1.5" />
                    Download Whisper (41 MB)
                  </Button>
                )}

                {modelProv.modelsCached?.whisper && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={async () => {
                      if (confirm('Delete downloaded Whisper speech model from local cache? Voice input will require manual typing until re-downloaded.')) {
                        await modelProv.deleteModel('whisper')
                      }
                    }}
                    className="text-xs"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                    Delete
                  </Button>
                )}
              </div>

              {/* Speech Recognition Engine Selector with Privacy Warning */}
              <div className="pt-2 border-t border-[#DDDCCB]/40 dark:border-[#373832]/40 space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <span className="text-xs font-semibold text-[#191919] dark:text-[#F5F1E7] block">
                      Speech Recognition Engine
                    </span>
                    <span className="text-[11px] text-[#77776E] dark:text-[#A6A49B]">
                      Primary transcription pathway
                    </span>
                  </div>
                  <select
                    value={settings.speechEngine || 'whisper_local'}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === 'web_speech_api') {
                        if (window.confirm('Privacy Warning: The browser Web Speech API may transmit audio to external speech servers (such as Google or Microsoft). For complete offline privacy, keep Local Whisper selected. Proceed?')) {
                          handleSelectChange('speechEngine', val);
                          handleSelectChange('webSpeechPrivacyNoticeAccepted', true);
                        }
                      } else {
                        handleSelectChange('speechEngine', val);
                      }
                    }}
                    className="rounded-lg border border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816] px-2.5 py-1.5 text-xs text-[#191919] dark:text-[#F5F1E7] focus:outline-none focus:border-[#005447]"
                  >
                    <option value="whisper_local">Local Whisper ASR (100% On-Device · Zero Network)</option>
                    <option value="web_speech_api">Browser Web Speech API (External Network Service)</option>
                  </select>
                </div>
              </div>
            </Card>

            {/* MODEL 4: ViT-GPT2 Image Understanding (Local VLM) Card */}
            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-[#DDDCCB]/60 dark:border-[#373832]/60">
                <div className="flex items-center gap-2">
                  <Camera className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" />
                  <span className="text-xs font-bold uppercase tracking-wider text-[#191919] dark:text-[#F5F1E7]">
                    4. Local Vision & Screenshot Understanding (VLM)
                  </span>
                </div>
                <div>
                  {modelProv.modelsCached?.vision ? (
                    <Badge variant="outline" className="text-[10px] text-teal-600 dark:text-teal-400 border-teal-500/30">
                      Cached · VLM Verified
                    </Badge>
                  ) : modelProv.allProgress?.vision?.state === 'downloading' ? (
                    <Badge variant="warning" className="text-[10px]">Downloading ({modelProv.allProgress.vision.percent}%)</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">Not Provisioned</Badge>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-[#191919] dark:text-[#F5F1E7]">Xenova/vit-gpt2-image-captioning</span>
                  <span className="text-[#77776E] dark:text-[#A6A49B] font-mono text-[11px]">250 MB · INT8 Quantized</span>
                </div>
                <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B] leading-relaxed">
                  Genuine Vision-Language Model (Vision Transformer + GPT-2) for on-device screenshot perception, visual element understanding, and chart inspection.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#DDDCCB]/40 dark:border-[#373832]/40">
                {!modelProv.modelsCached?.vision && modelProv.progress.state !== 'downloading' && (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={async () => {
                      if (window.confirm('Download local vision model assets (~250 MB)?')) {
                        await modelProv.downloadModel('vision')
                      }
                    }}
                    disabled={modelProv.isChecking}
                    className="text-xs"
                  >
                    <Download className="w-3.5 h-3.5 mr-1.5" />
                    Download Vision Model (250 MB)
                  </Button>
                )}

                {modelProv.modelsCached?.vision && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={async () => {
                      if (confirm('Delete downloaded vision model from local cache? Visual reasoning will require re-downloading.')) {
                        await modelProv.deleteModel('vision')
                      }
                    }}
                    className="text-xs"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                    Delete
                  </Button>
                )}
              </div>
            </Card>

            {/* Chrome Prompt API Context Quota Card */}
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
