import React from 'react'
import { useTTS } from '../lib/tts-context'
import { focusSetup } from '../lib/local-setup'

export function LocalVoiceNotice() {
  const { voiceNotice, audioEnabled } = useTTS()
  if (!voiceNotice || !audioEnabled) return null
  return <div role="status" className="text-xs p-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
    <p>Install a local {voiceNotice === 'hi' ? 'Hindi' : 'English'} voice to hear replies. Your text response is still available.</p>
    <button className="underline mt-1" onClick={() => {
      focusSetup(voiceNotice === 'hi' ? 'voice-hi' : 'voice')
      window.dispatchEvent(new Event('pentone:open-local-setup'))
    }}>Open voice setup in Settings</button>
  </div>
}
