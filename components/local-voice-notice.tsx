import React, { useState, useEffect } from 'react'
import { useTTS } from '../lib/tts-context'
import { focusSetup } from '../lib/local-setup'

export function LocalVoiceNotice() {
  const { voiceNotice, audioEnabled } = useTTS()
  const [debouncedNotice, setDebouncedNotice] = useState<'en' | 'hi' | null>(null)

  useEffect(() => {
    if (!voiceNotice || !audioEnabled) {
      setDebouncedNotice(null)
      return
    }
    const timer = setTimeout(() => {
      setDebouncedNotice(voiceNotice)
    }, 450)
    return () => clearTimeout(timer)
  }, [voiceNotice, audioEnabled])

  if (!debouncedNotice || !audioEnabled) return null
  return <div role="status" className="text-xs p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 animate-fadeIn">
    <p>Install a local {debouncedNotice === 'hi' ? 'Hindi' : 'English'} voice to hear replies. Your text response is still available.</p>
    <button className="underline mt-1" onClick={() => {
      focusSetup(debouncedNotice === 'hi' ? 'voice-hi' : 'voice')
      window.dispatchEvent(new Event('pentone:open-local-setup'))
    }}>Open voice setup in Settings</button>
  </div>
}
