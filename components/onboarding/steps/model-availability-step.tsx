import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Brain, Mic, ArrowRight, Loader2 } from 'lucide-react'
import { useOnboarding } from '../onboarding-provider'
import { LocalSetupPanel } from '../../local-setup-panel'
import { useLocalSetup, installSetup, missingSetup } from '../../../lib/local-setup'
import { useSpeechRecognition } from '../../../lib/use-speech-recognition'
import { openMicrophonePromptTab } from '../../../lib/alert-context'

export const ModelAvailabilityStep: React.FC<{ onOpenAudioSettings?: () => void }> = ({ onOpenAudioSettings }) => {
  const { skipOnboarding, setModelAvailability } = useOnboarding()
  const setup = useLocalSetup()
  const speech = useSpeechRecognition()
  const [voiceNotice, setVoiceNotice] = useState('')
  const pressedAt = useRef(0)
  const ready = setup.initialized && missingSetup(setup.items).length === 0
  const handleCommand = useCallback((text: string) => {
    if (/^(?:please\s+)?(?:download|install|set up|setup|start)(?:\s+(?:all|models|packs|everything|setup|downloads|please))*[.!?]?$/i.test(text.trim())) {
      setVoiceNotice('Starting local setup. If Chrome needs a click, use Retry on that item.')
      void installSetup()
    } else setVoiceNotice('Say “download all” to start setup, or use the download button.')
  }, [])
  const toggleVoice = useCallback(async () => {
    if (speech.isListening || speech.isStarting) {
      handleCommand(await speech.stopListening())
      return
    }
    if (setup.items.find(item => item.id === 'microphone')?.status !== 'ready') {
      openMicrophonePromptTab()
      setVoiceNotice('Allow the microphone in the Pentone tab, then try again.')
      return
    }
    try {
      setVoiceNotice('')
      await speech.startListening(handleCommand, error => setVoiceNotice(error.message))
    } catch (error) { setVoiceNotice(error instanceof Error ? error.message : 'Microphone setup is not ready.') }
  }, [speech.isListening, speech.isStarting, speech.startListening, speech.stopListening, setup.items, handleCommand])
  useEffect(() => {
    setModelAvailability(setup.items.find(item => item.id === 'prompt')?.status === 'ready')
  }, [setup.items, setModelAvailability])
  useEffect(() => {
    const interactive = (target: EventTarget | null) => target instanceof Element && !!target.closest('input, textarea, select, button, a, summary, [contenteditable="true"]')
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || interactive(event.target)) return
      event.preventDefault()
      pressedAt.current = Date.now()
      void toggleVoice()
    }
    const up = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || interactive(event.target)) return
      event.preventDefault()
      if (Date.now() - pressedAt.current > 250 && (speech.isListening || speech.isStarting)) {
        void speech.stopListening().then(handleCommand)
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [toggleVoice, speech.isListening, speech.isStarting, speech.stopListening, handleCommand])

  return <div className="w-full min-w-0 space-y-5">
    <div className="text-center space-y-2">
      <Brain className="w-10 h-10 text-[#005447] dark:text-[#67E2C8] mx-auto" />
      <h1 className="font-display text-2xl font-bold">Local AI Engine Setup</h1>
      <p className="text-xs text-[#77776E] dark:text-[#A6A49B]">Everything Pentone needs, in one place. Prepare available models now and finish any remaining steps in Settings.</p>
    </div>
    <button onClick={() => void toggleVoice()} disabled={setup.busy} className="w-full p-3 rounded-xl border border-[#DDDCCB] dark:border-[#373832] flex items-center justify-center gap-2 text-xs disabled:opacity-40">
      {speech.isStarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
      {speech.isStarting ? 'Cancel microphone setup' : speech.isListening ? 'Stop listening' : 'Press Space or click to say “download all”'}
    </button>
    {(speech.speechStatus || voiceNotice) && <p role="status" className="text-xs">{speech.speechStatus || voiceNotice}</p>}
    <LocalSetupPanel onOpenAudioSettings={onOpenAudioSettings} />
    <button className="w-full p-3 rounded-xl bg-[#005447] dark:bg-[#67E2C8] text-white dark:text-[#171816] font-semibold text-sm flex items-center justify-center gap-2" onClick={skipOnboarding}>
      {ready ? 'Open Pentone' : 'Continue · finish setup later'}<ArrowRight className="w-4 h-4" />
    </button>
    {!ready && <p className="text-[11px] text-center text-[#77776E] dark:text-[#A6A49B]">The Voice page will link to anything still missing. Completed downloads are kept.</p>}
  </div>
}
