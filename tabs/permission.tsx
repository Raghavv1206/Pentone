import React, { useEffect, useState } from "react"
import { Mic, CheckCircle2, ShieldCheck } from "lucide-react"
import "../style.css"

export default function PermissionTab() {
  const [status, setStatus] = useState<"requesting" | "granted" | "denied">("requesting")

  useEffect(() => {
    const requestAccess = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach((track) => track.stop())
        setStatus("granted")
        // Close tab automatically after permission is granted
        setTimeout(() => {
          window.close()
        }, 800)
      } catch (err) {
        console.warn("Microphone access denied or dismissed:", err)
        setStatus("denied")
      }
    }

    requestAccess()
  }, [])

  return (
    <div className="min-h-screen bg-[#FFFEEF] dark:bg-[#171816] text-[#191919] dark:text-[#F5F1E7] flex flex-col items-center justify-center p-6 select-none font-sans">
      <div className="max-w-md w-full bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-3xl p-8 text-center space-y-5 shadow-lg">
        <div className="flex justify-center">
          <div className="p-4 rounded-2xl bg-[#E9D2FF]/40 dark:bg-[#CDB0F3]/20 border border-[#D5B8F6] dark:border-[#513E6B]">
            <Mic className="w-10 h-10 text-[#005447] dark:text-[#67E2C8] animate-pulse" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-bold tracking-tight">Microphone Permission</h1>
          <p className="text-xs text-[#77776E] dark:text-[#A6A49B] leading-relaxed">
            Please click <strong>"Allow"</strong> on the browser prompt above to enable hands-free voice commands in Pentone.
          </p>
        </div>

        {status === "granted" && (
          <div className="flex items-center justify-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/40 p-3 rounded-xl border border-emerald-300 dark:border-emerald-800 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Permission granted! Closing window...</span>
          </div>
        )}

        {status === "denied" && (
          <div className="space-y-3">
            <div className="text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/30 p-3 rounded-xl border border-amber-200 dark:border-amber-900/50 leading-relaxed">
              Microphone prompt was dismissed. You can enable it in Chrome Settings or close this tab.
            </div>
            <button
              onClick={() => {
                const extId = typeof chrome !== 'undefined' && chrome.runtime?.id ? chrome.runtime.id : ''
                if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
                  chrome.tabs.create({ url: `chrome://settings/content/siteDetails?site=chrome-extension://${extId}` })
                }
              }}
              className="px-4 py-2 rounded-xl bg-[#005447] text-white text-xs font-semibold hover:bg-[#003F36] transition-colors"
            >
              Open Chrome Site Settings
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
