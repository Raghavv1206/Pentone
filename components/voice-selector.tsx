import React, { useState } from "react"
import { Volume2, X, Play } from "lucide-react"
import { useTTS } from "../lib/tts-context"

export const VoiceSelector: React.FC = () => {
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
    <div className="flex items-center gap-1.5 w-full min-w-0 bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-xl px-2.5 py-1.5 transition-colors">
      <Volume2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#005447] dark:text-[#67E2C8] shrink-0" />
      <select
        value={selectedVoiceUri || ''}
        onChange={(e) => setSelectedVoiceUri(e.target.value)}
        className="w-full min-w-0 bg-transparent border-none text-xs font-sans text-[#191919] dark:text-[#F5F1E7] focus:outline-none truncate cursor-pointer"
        title="Select assistant voice"
      >
        {availableVoices.map((voice) => (
          <option key={voice.voiceURI} value={voice.voiceURI} className="bg-[#FFFEEF] dark:bg-[#171816] text-[#191919] dark:text-[#F5F1E7]">
            {voice.name}
          </option>
        ))}
      </select>
      <button
        onClick={handlePreview}
        disabled={isDisabled}
        className={`p-1 rounded-lg hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] text-[#56564E] dark:text-[#A6A49B] transition-colors shrink-0 ${
          isError ? 'text-rose-500' : ''
        } ${isDisabled ? 'opacity-40 cursor-wait' : ''}`}
        title={isError ? 'Preview failed' : 'Preview voice audio'}
      >
        {isError ? <X className="w-3 h-3 text-rose-500 shrink-0" /> : <Play className="w-3 h-3 fill-current shrink-0" />}
      </button>
    </div>
  )
}
