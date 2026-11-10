import React, { useEffect, useState } from 'react'
import { CheckCircle2, Download, Loader2, RefreshCw, AlertCircle } from 'lucide-react'
import { useLocalSetup, refreshSetup, installSetup, cancelSetup, setSetupLanguages, focusSetup, missingSetup } from '../lib/local-setup'
import { browserPermissions, bundledLibraries, translationLanguages, type SetupItem, type SetupStatus } from '../lib/setup-catalog'
import { openMicrophonePromptTab, openPermissionsPage, openComponentsPage, openAIFlagsPage, openWriterFlagsPage, openRewriterFlagsPage, openSummarizationAPIFlagsPage, openLanguageDetectorAPIFlagsPage, openTranslatorAPIFlagsPage } from '../lib/alert-context'

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
  const [voiceHelp, setVoiceHelp] = useState(false)
  const [selectedLanguage, setSelectedLanguage] = useState('')
  useEffect(() => {
    if (!state.focusId) return
    const element = document.getElementById(`local-setup-${state.focusId}`)
    if (element) { element.scrollIntoView({ block: 'center' }); element.focus({ preventScroll: true }); focusSetup('') }
  }, [state.focusId])

  const changeLanguages = (languages: string[]) => {
    setNotice('')
    void setSetupLanguages(languages).catch(() => setNotice('Could not save language choices. Please try again.'))
  }
  const requestPermission = async (item: SetupItem) => {
    try {
      const permission = item.id.replace('permission-', '') as keyof typeof browserPermissions
      const granted = item.status === 'ready'
        ? await chrome.permissions.remove({ permissions: [permission] })
        : await chrome.permissions.request({ permissions: [permission] })
      if (!granted) setNotice('Permission was not enabled. You can continue without those optional tools.')
      await refreshSetup()
    } catch { setNotice('Chrome could not enable this permission. Try the button again.') }
  }
  const action = (item: SetupItem) => {
    if (item.id.startsWith('permission-')) return <button className={button} onClick={() => void requestPermission(item)}>{item.status === 'ready' ? 'Disable access' : 'Enable access'}</button>
    if (item.status === 'ready' || item.status === 'checking') return null
    if (item.id === 'microphone') return <button className={button} onClick={item.detail?.includes('blocked') ? openPermissionsPage : openMicrophonePromptTab}>Allow microphone</button>
    if (item.id === 'voice') return <button className={button} onClick={() => setVoiceHelp(value => !value)}>Install a system voice</button>
    if (item.id === 'wakeword') return <button className={button} onClick={() => {
      if (onOpenAudioSettings) onOpenAudioSettings()
      else { document.getElementById('picovoice-key')?.scrollIntoView({ block: 'center' }); document.getElementById('picovoice-key')?.focus() }
    }}>Configure wake word</button>
    if (item.status === 'unsupported') return <button className={button} onClick={() => {
      if (item.id === 'speech') { setNotice('On-device speech requires a supported Chrome version and language. Update Chrome, reopen it, then select Check again.'); return }
      openNativeHelp(item.id)
    }}>Setup help</button>
    return <button className={button} disabled={state.busy || state.checking} onClick={() => void installSetup([item.id])}>{item.status === 'error' ? 'Retry' : item.status === 'downloading' ? 'Resume' : 'Download'}</button>
  }

  return <section aria-label="Local AI setup checklist" className="space-y-4 min-w-0 text-[#191919] dark:text-[#F5F1E7]">
    <div className="space-y-2">
      <p className="text-xs text-[#77776E] dark:text-[#A6A49B]">Prepare local models and voice packs now. Downloads need internet; AI and speech processing stay on this device. Existing downloads are reused.</p>
      <div className="flex flex-wrap gap-2">
        <button className={`${button} flex items-center gap-2`} disabled={state.checking || !state.initialized} onClick={() => {
          if (state.busy) { cancelSetup(); return }
          void installSetup()
          if (state.items.find(item => item.id === 'microphone')?.status === 'action') openMicrophonePromptTab()
        }}>
          {state.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {state.busy ? 'Cancel setup' : 'Download all supported models & packs'}
        </button>
        <button className="text-xs flex items-center gap-1 p-2 disabled:opacity-40" disabled={state.busy || state.checking} onClick={() => void refreshSetup()}><RefreshCw className={`w-3.5 h-3.5 ${state.checking ? 'animate-spin' : ''}`} />Check again</button>
      </div>
      <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B]">Chrome shares some model files. It does not report a reliable combined download size. Browser prompts, system voices and optional permissions need your action.</p>
      {(state.message || notice) && <p role="status" className="text-xs">{notice || state.message}</p>}
    </div>
    <fieldset className={card} disabled={state.busy || state.checking}>
      <legend className="text-xs font-semibold px-1">Translation languages</legend>
      <p className="text-[11px] mb-2 text-[#77776E] dark:text-[#A6A49B]">Selected from your browser’s languages. English is the base language; each choice prepares both directions. Additional pairs can download when used.</p>
      {!state.languages.length && <p className="text-xs mb-2">Your browser uses English. Add a language if you want translation packs prepared now.</p>}
      <div className="flex flex-wrap gap-2 mb-2">{state.languages.map(language => <button key={language} className="text-xs border rounded px-2 py-1" onClick={() => changeLanguages(state.languages.filter(value => value !== language))} aria-label={`Remove ${translationLanguages[language]}`}>{translationLanguages[language]} ×</button>)}</div>
      <div className="flex gap-2">
        <select aria-label="Add translation language" value={selectedLanguage} onChange={event => setSelectedLanguage(event.target.value)} className="min-w-0 flex-1 bg-[#FFFEEF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded p-2 text-xs">
          <option value="">Choose a language</option>
          {Object.entries(translationLanguages).filter(([code]) => !state.languages.includes(code)).map(([code, title]) => <option key={code} value={code}>{title}</option>)}
        </select>
        <button className={button} disabled={!selectedLanguage || state.languages.length >= 5} onClick={() => { changeLanguages([...state.languages, selectedLanguage]); setSelectedLanguage('') }}>Add</button>
      </div>
      <p className="text-[11px] mt-2 text-[#77776E] dark:text-[#A6A49B]">Up to five languages at a time. Availability depends on Chrome and the language pair. Removing a choice does not delete Chrome’s cached pack.</p>
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
        {item.id === 'voice' && voiceHelp && <div className="mt-2 text-xs space-y-1">
          <p>Windows: Settings → Time & language → Speech → Manage voices → Add voices. Install English, then reopen Chrome.</p>
          <p>macOS: System Settings → Accessibility → Spoken Content (or Read & Speak) → System Voice → Manage Voices.</p>
          <p>Other systems: install a local English speech voice through your system’s speech settings. Pentone cannot install operating-system packages itself.</p>
          <button className="underline" onClick={() => void refreshSetup()}>I installed a voice — check again</button>
        </div>}
      </div>)}
    </div>)}
    <details className={card}>
      <summary className="text-xs font-semibold cursor-pointer">Libraries & files already included — no separate download</summary>
      <div className="space-y-2 mt-3">{bundledLibraries.map(([title, names]) => <p key={title} className="text-[11px]"><strong>{title}:</strong> {names}</p>)}</div>
      <p className="text-[11px] mt-2">The extension also includes its page agent, icons, sounds and styles. You do not need Node.js, npm, Python or a cloud AI account.</p>
    </details>
    <details className={card}>
      <summary className="text-xs font-semibold cursor-pointer">Browser requirements & download help</summary>
      <p className="text-xs mt-2">Use a supported desktop Chrome version with enough free storage and compatible hardware. Unavailable APIs cannot be installed as ordinary files. Update Chrome and follow its API requirements; some experimental features may need a flag and browser relaunch.</p>
      <p className="text-xs mt-2">If an item opens a Chrome flag, choose Enabled, relaunch Chrome, then return here and select Check again. If the flag is missing, that browser version may not offer the API.</p>
      <button className="underline text-xs mt-2" onClick={openComponentsPage}>Open Chrome’s model component updater</button>
      <p className="text-[11px] mt-2">If Chrome requires another click, use Retry on that item. A failed item does not erase completed downloads. Cancelling stops Pentone’s setup; a browser-managed download may continue.</p>
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
