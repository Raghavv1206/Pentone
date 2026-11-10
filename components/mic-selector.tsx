import React, { useRef } from "react"
import { Mic } from "lucide-react"
import { useMediaDevice } from "../lib/media-device-context"

export const MicSelector: React.FC = () => {
  const { selectedMicId, availableMics, setSelectedMicId } = useMediaDevice()
  const isChangingRef = useRef(false)

  if (availableMics.length === 0) {
    return (
      <div className="flex items-center gap-1.5 w-full min-w-0 bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-xl px-2.5 py-1.5 opacity-60">
        <Mic className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#005447] dark:text-[#67E2C8] shrink-0" />
        <span className="w-full min-w-0 text-xs font-sans text-[#77776E] dark:text-[#A6A49B] truncate">Default Mic</span>
      </div>
    )
  }

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (isChangingRef.current) return
    isChangingRef.current = true
    setSelectedMicId(e.target.value)
    setTimeout(() => {
      isChangingRef.current = false
    }, 300)
  }

  return (
    <div className="flex items-center gap-1.5 w-full min-w-0 bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-xl px-2.5 py-1.5 transition-colors">
      <Mic className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#005447] dark:text-[#67E2C8] shrink-0" />
      <select
        value={selectedMicId || ''}
        onChange={handleChange}
        className="w-full min-w-0 bg-transparent border-none text-xs font-sans text-[#191919] dark:text-[#F5F1E7] focus:outline-none truncate cursor-pointer"
        title="Select input microphone"
      >
        {availableMics.map((mic) => (
          <option key={mic.deviceId} value={mic.deviceId} className="bg-[#FFFEEF] dark:bg-[#171816] text-[#191919] dark:text-[#F5F1E7]">
            {mic.label || `Mic ${mic.deviceId.substring(0, 8)}`}
          </option>
        ))}
      </select>
    </div>
  )
}
