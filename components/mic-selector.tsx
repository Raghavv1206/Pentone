import React, { useRef } from "react"
import { useMediaDevice } from "../lib/media-device-context"

export const MicSelector = () => {
  const { selectedMicId, availableMics, setSelectedMicId } = useMediaDevice()
  const isChangingRef = useRef(false)

  if (availableMics.length <= 1) {
    return null
  }

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (isChangingRef.current) {
      return // Prevent rapid changes
    }
    
    isChangingRef.current = true
    setSelectedMicId(e.target.value)
    
    // Reset flag after a short delay
    setTimeout(() => {
      isChangingRef.current = false
    }, 300)
  }

  return (
    <select
      value={selectedMicId || ''}
      onChange={handleChange}
      className="bg-[#F3F1DF] dark:bg-[#22231F] text-[#191919] dark:text-[#F5F1E7] border border-[#DDDCCB] dark:border-[#373832] rounded-lg px-2 py-1 text-xs font-sans focus:outline-none focus:border-[#005447] dark:focus:border-[#67E2C8] max-w-full truncate shadow-xs transition-colors"
      style={{ maxWidth: '150px' }}
    >
      {availableMics.map((mic) => (
        <option key={mic.deviceId} value={mic.deviceId}>
          {mic.label || `Mic ${mic.deviceId.substring(0, 8)}`}
        </option>
      ))}
    </select>
  )
}
