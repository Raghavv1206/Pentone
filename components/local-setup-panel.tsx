import React, { useEffect, useState } from 'react'
import { CheckCircle2, Download, Loader2, RefreshCw, AlertCircle } from 'lucide-react'
import { useLocalSetup, refreshSetup, installSetup, cancelSetup, setSetupLanguages, focusSetup, missingSetup, checkOptionalSetup } from '../lib/local-setup'
import { browserPermissions, bundledLibraries, translationLanguages, type SetupItem, type SetupStatus } from '../lib/setup-catalog'
import { openMicrophonePromptTab, openPermissionsPage, openComponentsPage, openOnDeviceInternalsPage, openAIFlagsPage, openWriterFlagsPage, openRewriterFlagsPage, openSummarizationAPIFlagsPage, openLanguageDetectorAPIFlagsPage, openTranslatorAPIFlagsPage } from '../lib/alert-context'
import { ConversationLanguageSelector } from './conversation-language-selector'

const card = 'rounded-xl border border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF] dark:bg-[#171816] p-3 min-w-0'
const button = 'px-3 py-2 rounded-lg text-xs font-semibold bg-[#E9D2FF] dark:bg-[#CDB0F3] text-[#191919] dark:text-[#171816] disabled:opacity-40'
const labels: Record<SetupStatus, string> = { checking: 'Checking…', ready: 'Ready', downloadable: 'Download needed', downloading: 'Preparing…', unsupported: 'Not supported here', action: 'Needs attention', error: 'Retry needed' }

function openNativeHelp(id: string) {
  const opener = { writer: openWriterFlagsPage, rewriter: openRewriterFlagsPage, summarizer: openSummarizationAPIFlagsPage, detector: openLanguageDetectorAPIFlagsPage }[id]
  if (opener) opener()
  else if (id.startsWith('translate-')) openTranslatorAPIFlagsPage()
  else openAIFlagsPage()
}

export function LocalSetupPanel({ onOpenAudioSettings }: { onOpenAudioSettings?: () => void }) {
  const state = useLocalSetup()
  const [notice, setNotice] = useState('')
  const [voiceHelpId, setVoiceHelpId] = useState<string | null>(null)
  const [selectedLanguage, setSelectedLanguage] = useState('')
  useEffect(() => {
    if (!state.focusId) return
    const element = document.getElementById(`local-setup-${state.focusId}`)
    if (element) { element.scrollIntoView({ block: 'center' }); element.focus({ preventScroll: true }); focusSetup('') }
  }, [state.focusId])

  const changeLanguages = async (languages: string[]) => {
    setNotice('')
    try { await setSetupLanguages(languages); return true }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not save language choices. Please try again.'); return false }
  }
  const requestPermission = async (item: SetupItem) => {
    try {
      const permission = item.id.replace('permission-', '') as keyof typeof browserPermissions
      const granted = item.status === 'ready'
        ? await chrome.permissions.remove({ permissions: [permission] })
        : await chrome.permissions.request({ permissions: [permission] })
      if (!granted) setNotice('Permission was not enabled. You can continue without those optional tools.')
      await refreshSetup().catch(() => {})
    } catch { setNotice('Chrome could not enable this permission. Try the button again.') }
  }
  const action = (item: SetupItem) => {
    if (item.id.startsWith('permission-')) return <button className={button} onClick={() => void requestPermission(item)}>{item.status === 'ready' ? 'Disable access' : 'Enable access'}</button>
    if (item.status === 'ready' || item.status === 'checking') return null
    if (['image', 'audio'].includes(item.id) && ['action', 'unsupported', 'error'].includes(item.status)) return <button className={button} disabled={state.busy} onClick={() => void checkOptionalSetup(item.id).catch(() => {})}>Check support</button>
    if (item.id === 'microphone') return <button className={button} onClick={item.detail?.includes('blocked') ? openPermissionsPage : openMicrophonePromptTab}>Allow microphone</button>
    if (item.id === 'voice' || item.id === 'voice-hi') return <button className={button} onClick={() => setVoiceHelpId(id => id === item.id ? null : item.id)}>Install a system voice</button>
    if (item.id === 'wakeword') return <button className={button} onClick={() => {
      if (onOpenAudioSettings) onOpenAudioSettings()
      else { document.getElementById('picovoice-key')?.scrollIntoView({ block: 'center' }); document.getElementById('picovoice-key')?.focus() }
    }}>Configure wake word</button>
    if (item.status === 'unsupported') return <button className={button} onClick={() => {
      if (item.id === 'speech' || item.id === 'speech-hi') { setNotice('On-device speech requires a supported Chrome version and language. Update Chrome, reopen it, then select Check again.'); return }
      openNativeHelp(item.id)
    }}>Setup help</button>
    return <button className={button} disabled={state.busy || state.checking} onClick={() => void installSetup([item.id]).catch(() => {})}>{item.status === 'error' ? 'Retry' : item.status === 'downloading' ? 'Resume' : 'Download'}</button>
  }

  return <section aria-label="Local AI setup checklist" className="space-y-4 min-w-0 text-[#191919] dark:text-[#F5F1E7]">
    <div className="space-y-2">
      <p className="text-xs text-[#77776E] dark:text-[#A6A49B]">Prepare local models and voice packs now. Downloads need internet; AI and speech processing stay on this device. Existing downloads are reused.</p>
      <div className="flex flex-wrap gap-2">
        <button className={`${button} flex items-center gap-2`} disabled={state.checking || !state.initialized} onClick={() => {
          if (state.busy) { cancelSetup(); return }
          void installSetup().catch(() => {})
          if (state.items.find(item => item.id === 'microphone')?.status === 'action') openMicrophonePromptTab()
        }}>
          {state.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {state.busy ? 'Cancel setup' : 'Download all supported models & packs'}
        </button>
        <button className="text-xs flex items-center gap-1 p-2 disabled:opacity-40" disabled={state.busy || state.checking} onClick={() => void refreshSetup().catch(() => {})}><RefreshCw className={`w-3.5 h-3.5 ${state.checking ? 'animate-spin' : ''}`} />Check again</button>
      </div>
      <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B]">Chrome shares some model files. It does not report a reliable combined download size. Browser prompts, system voices and optional permissions need your action.</p>
      {(state.message || notice) && <p role="status" className="text-xs">{notice || state.message}</p>}
    </div>
    <fieldset className={card} disabled={state.savingLanguages}>
      <legend className="text-xs font-semibold px-1">Translation languages</legend>
      <p className="text-[11px] mb-2 text-[#77776E] dark:text-[#A6A49B]">English and Hindi are included in the setup plan. Hindi uses local translation; Hinglish uses the local assistant and has no separate language pack. Add other languages when needed.</p>
      <div className="flex flex-wrap gap-2 mb-2"><span className="text-xs border rounded px-2 py-1">English + Hindi · Default</span>{state.languages.filter(language => language !== 'hi').map(language => <button key={language} disabled={state.busy} className="text-xs border rounded px-2 py-1" onClick={() => void changeLanguages(state.languages.filter(value => value !== language))} aria-label={`Remove ${translationLanguages[language]}`}>{translationLanguages[language]} ×</button>)}</div>
      <div className="flex gap-2">
        <select aria-label="Add translation language" value={selectedLanguage} onChange={event => setSelectedLanguage(event.target.value)} className="min-w-0 flex-1 bg-[#FFFEEF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded p-2 text-xs">
          <option value="">Choose a language</option>
          {Object.entries(translationLanguages).filter(([code]) => !state.languages.includes(code)).map(([code, title]) => <option key={code} value={code}>{title}</option>)}
        </select>
        <button className={button} disabled={!selectedLanguage || state.languages.length >= 5 || state.busy} onClick={async () => {
          const chosen = selectedLanguage
          if (await changeLanguages([...state.languages, chosen])) setSelectedLanguage(value => value === chosen ? '' : value)
        }}>Add</button>
      </div>
      <p className="text-[11px] mt-2 text-[#77776E] dark:text-[#A6A49B]">Add up to four more languages. Availability depends on Chrome and the language pair. Removing a choice does not delete Chrome’s cached pack.</p>
      <div className="mt-3"><ConversationLanguageSelector /></div>
      <p className="text-[11px] mt-2 text-[#77776E] dark:text-[#A6A49B]">Select Hindi or Hinglish to use the Hindi microphone pack. Auto detects Hindi script and common Hinglish text; its microphone uses English. Hinglish understanding and mixed-language speech quality depend on the local model.</p>
    </fieldset>
    {(['Models & language packs', 'Voice & permissions', 'Optional features'] as const).map(group => <div key={group} className="space-y-2">
      <h3 className="text-sm font-semibold">{group}</h3>
      {state.items.filter(item => item.group === group).map(item => <div id={`local-setup-${item.id}`} key={item.id} tabIndex={-1} className={`${card} focus:ring-2 focus:ring-[#67E2C8]`}>
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-xs font-semibold">{item.title}</h4>
          <span className={`text-[10px] shrink-0 ${item.status === 'ready' ? 'text-emerald-700 dark:text-emerald-300' : 'text-[#77776E] dark:text-[#A6A49B]'}`}>
            {item.status === 'ready' && <CheckCircle2 className="w-3 h-3 inline mr-1" />}{labels[item.status]}
          </span>
        </div>
        <p className="text-[11px] mt-1 text-[#77776E] dark:text-[#A6A49B]">{item.description}</p>
        {item.detail && <p className="text-[11px] mt-1">{item.detail}</p>}
        {item.status === 'downloading' && <progress aria-label={`${item.title} download progress`} value={item.progress} max={100} className="w-full h-2 mt-2 accent-emerald-500" />}
        {(item.status !== 'ready' || item.id.startsWith('permission-')) && <div className="mt-2">{action(item)}</div>}
        {(item.id === 'voice' || item.id === 'voice-hi') && voiceHelpId === item.id && <div className="mt-2 text-xs space-y-1">
          <p>Windows: Settings → Time & language → Speech → Manage voices → Add voices. Install {item.id === 'voice-hi' ? 'Hindi' : 'English'}, then reopen Chrome.</p>
          <p>macOS: System Settings → Accessibility → Spoken Content (or Read & Speak) → System Voice → Manage Voices.</p>
          <p>Other systems: install a local {item.id === 'voice-hi' ? 'Hindi' : 'English'} speech voice through your system’s speech settings. Pentone cannot install operating-system packages itself.</p>
          <button className="underline" onClick={() => void refreshSetup().catch(() => {})}>I installed a voice — check again</button>
        </div>}
      </div>)}
    </div>)}
    <details className={card}>
      <summary className="text-xs font-semibold cursor-pointer">Libraries & files already included — no separate download</summary>
      <div className="space-y-2 mt-3">{bundledLibraries.map(([title, names]) => <p key={title} className="text-[11px]"><strong>{title}:</strong> {names}</p>)}</div>
      <p className="text-[11px] mt-2">The extension also includes its page agent, icons, sounds and styles. You do not need Node.js, npm, Python or a cloud AI account.</p>
    </details>
    <details className={card}>
      <summary className="text-xs font-semibold cursor-pointer">Browser requirements & download help (Gemini Nano)</summary>
      <div className="space-y-2 mt-2 text-xs">
        <p className="text-[#44443D] dark:text-[#C5C4B5]">
          Pentone uses Chrome's built-in <strong>Gemini Nano</strong> engine. Follow these 3 simple steps if it shows as needing setup:
        </p>
        <div className="p-2 rounded-lg bg-[#F3F1DF]/70 dark:bg-[#22231F]/70 border border-[#DDDCCB] dark:border-[#373832] space-y-1 text-[11px]">
          <p><strong>Step 1: Turn on the AI flag in Chrome</strong></p>
          <p className="text-[#77776E] dark:text-[#A6A49B]">Click below to open Chrome flags &rarr; set <strong>Prompt API for Gemini Nano</strong> to <strong>Enabled</strong> &rarr; click the blue <strong>Relaunch</strong> button at the bottom of Chrome.</p>
          <button className={`${button} py-1 text-[11px]`} onClick={openAIFlagsPage}>Open Prompt API Flag</button>
          <p className="text-[10px] text-[#77776E] dark:text-[#A6A49B]">Note for non-technical users: Modern Chrome replaced the old &ldquo;Optimization Guide on device model&rdquo; flag with the Prompt API flag above. You only need this flag.</p>
        </div>
        <div className="p-2 rounded-lg bg-[#F3F1DF]/70 dark:bg-[#22231F]/70 border border-[#DDDCCB] dark:border-[#373832] space-y-1 text-[11px]">
          <p><strong>Step 2: Download the model files in Chrome</strong></p>
          <p className="text-[#77776E] dark:text-[#A6A49B]">After relaunching Chrome, click below to open Chrome's component updater &rarr; find <strong>Optimization Guide On Device Model</strong> &rarr; click <strong>Check for update</strong>.</p>
          <button className={`${button} py-1 text-[11px]`} onClick={openComponentsPage}>Open Components Updater (chrome://components)</button>
        </div>
        <div className="p-2 rounded-lg bg-[#F3F1DF]/70 dark:bg-[#22231F]/70 border border-[#DDDCCB] dark:border-[#373832] space-y-1 text-[11px]">
          <p><strong>Step 3: Storage requirement & diagnostics</strong></p>
          <p className="text-[#77776E] dark:text-[#A6A49B]">Chrome strictly requires <strong>at least 20 GB free space</strong> on your C: drive to download local models. If the download does not start, click below to open Chrome AI Internals and click <strong>Load Default</strong>.</p>
          <button className={`${button} py-1 text-[11px]`} onClick={openOnDeviceInternalsPage}>Open AI Internals (chrome://on-device-internals)</button>
        </div>
        <p className="text-[11px] mt-2">After completing the steps, return here and click <strong>Check again</strong> at the top of this checklist.</p>
      </div>
    </details>
  </section>
}

export function LocalSetupNotice({ onOpenSettings }: { onOpenSettings: () => void }) {
  const state = useLocalSetup()
  const missing = missingSetup(state.items)
  if (!state.initialized || (!missing.length && !state.busy)) return null
  return <div role="status" className="mx-3 mt-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs shrink-0">
    <div className="flex gap-2 items-center"><AlertCircle className="w-4 h-4 shrink-0 text-amber-600" /><strong>{state.busy ? 'Local setup is running' : 'Finish local setup'}</strong></div>
    <p className="mt-1 text-[11px]">{state.busy ? 'See download progress in Settings.' : `Needs setup: ${missing.slice(0, 3).map(item => item.title).join(', ')}${missing.length > 3 ? ` and ${missing.length - 3} more` : ''}.`}</p>
    <button className="underline font-semibold mt-1" onClick={() => { focusSetup(missing[0]?.id || 'prompt'); onOpenSettings() }}>Open missing items in Settings</button>
  </div>
}
