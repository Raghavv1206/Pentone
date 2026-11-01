import React, { useState } from "react"
import { Volume2, X } from "lucide-react"
import { useTTS } from "../lib/tts-context"

export const VoiceSelector = () => {
  const { selectedVoiceUri, availableVoices, setSelectedVoiceUri, previewVoice } = useTTS()
  const [isError, setIsError] = useState(false)
  const [isDisabled, setIsDisabled] = useState(false)

  if (availableVoices.length === 0) {
    return null
  }

  const handlePreview = async () => {
    if (!selectedVoiceUri || isDisabled) return
    
    setIsDisabled(true)
    const success = await previewVoice(selectedVoiceUri)
    
    if (!success) {
      setIsError(true)
      setTimeout(() => {
        setIsError(false)
        setIsDisabled(false)
      }, 2000)
    } else {
      setIsDisabled(false)
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={selectedVoiceUri || ''}
        onChange={(e) => setSelectedVoiceUri(e.target.value)}
        className="bg-[#F3F1DF] dark:bg-[#22231F] text-[#191919] dark:text-[#F5F1E7] border border-[#DDDCCB] dark:border-[#373832] rounded-lg px-2 py-1 text-xs font-sans focus:outline-none focus:border-[#005447] dark:focus:border-[#67E2C8] max-w-full truncate shadow-xs transition-colors"
        style={{ maxWidth: '140px' }}
      >
        {availableVoices.map((voice) => (
          <option key={voice.voiceURI} value={voice.voiceURI}>
            {voice.name}
          </option>
        ))}
      </select>
      <button
        onClick={handlePreview}
        disabled={isDisabled}
        className={`p-1 hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] text-[#77776E] dark:text-[#A6A49B] rounded-md transition-colors flex-shrink-0 ${
          isError ? 'text-rose-500' : ''
        } ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={isError ? 'Preview failed' : 'Preview voice'}
      >
        {isError ? <X className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
      </button>
    </div>
  )
}
