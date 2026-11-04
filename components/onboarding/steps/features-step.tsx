import React, { useState } from 'react'
import { ArrowRight, Camera, Keyboard, Highlighter, PenLine, Sparkles } from 'lucide-react'
import { useOnboarding } from '../onboarding-provider'
import { saveSettings } from '../../../lib/settings'

export const FeaturesStep: React.FC = () => {
  const { nextStep } = useOnboarding()
  const [isEnabling, setIsEnabling] = useState(false)
  const [showReloadDialog, setShowReloadDialog] = useState(false)

  const handleEnable = async () => {
    setIsEnabling(true)
    await saveSettings({
      captureOverlayEnabled: true,
      globalShortcutsEnabled: true,
      textSelectionEnabled: true,
      writeCommandEnabled: true
    })
    setShowReloadDialog(true)
  }

  const handleReload = async () => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tabs[0]?.id) {
        await chrome.tabs.reload(tabs[0].id)
      }
    }
    nextStep()
  }

  return (
    <div className="flex flex-col items-center justify-center space-y-5 text-center">
      <div className="space-y-1.5">
        <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-[#191919] dark:text-[#F5F1E7]">
          Enable Browsing Features
        </h1>
        <p className="font-sans text-xs text-[#77776E] dark:text-[#A6A49B]">
          Activate intelligent in-page interaction tools
        </p>
      </div>

      <div className="w-full space-y-2.5 text-left">
        <div className="p-3.5 rounded-2xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] flex items-start gap-3">
          <div className="p-2 bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#005447] dark:text-[#67E2C8] rounded-xl shrink-0">
            <Camera className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-sans font-semibold text-xs text-[#191919] dark:text-[#F5F1E7]">Capture Overlay</h3>
            <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B] mt-0.5 leading-relaxed">
              Floating buttons on web pages for rapid screenshot and audio capture.
            </p>
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] flex items-start gap-3">
          <div className="p-2 bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#005447] dark:text-[#67E2C8] rounded-xl shrink-0">
            <Highlighter className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-sans font-semibold text-xs text-[#191919] dark:text-[#F5F1E7]">Text Selection Tooltip</h3>
            <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B] mt-0.5 leading-relaxed">
              Highlight text to instantly explain, rewrite, or send context to assistant.
            </p>
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] flex items-start gap-3">
          <div className="p-2 bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#005447] dark:text-[#67E2C8] rounded-xl shrink-0">
            <PenLine className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-sans font-semibold text-xs text-[#191919] dark:text-[#F5F1E7]">/write Command</h3>
            <p className="text-[11px] text-[#77776E] dark:text-[#A6A49B] mt-0.5 leading-relaxed">
              Type <code className="font-mono bg-[#DDDCCB]/50 dark:bg-[#373832]/60 px-1 rounded">/write</code> into text inputs to generate neural drafts inline.
            </p>
          </div>
        </div>
      </div>

      <button
        onClick={handleEnable}
        disabled={isEnabling || showReloadDialog}
        className="w-full bg-[#005447] hover:bg-[#003F36] dark:bg-[#67E2C8] dark:hover:bg-[#52C5AD] text-white dark:text-[#171816] px-5 py-3 rounded-xl font-sans font-semibold text-xs tracking-wide transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-40"
      >
        <span>{isEnabling ? 'Enabling Features...' : 'Enable & Continue'}</span>
        {!isEnabling && !showReloadDialog && <ArrowRight className="w-4 h-4" />}
      </button>

      {/* Reload Dialog */}
      {showReloadDialog && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-50 p-4">
          <div className="bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] rounded-2xl p-6 max-w-sm w-full shadow-2xl text-center space-y-4 animate-fadeIn">
            <div className="w-10 h-10 rounded-full bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#005447] dark:text-[#67E2C8] flex items-center justify-center mx-auto">
              <Sparkles className="w-5 h-5" />
            </div>
            <h3 className="font-display text-base font-bold text-[#191919] dark:text-[#F5F1E7]">
              Features Activated
            </h3>
            <p className="text-xs text-[#77776E] dark:text-[#A6A49B] leading-relaxed">
              The active tab will reload to inject browser assistance tools. Then onboarding will complete.
            </p>
            <button
              onClick={handleReload}
              className="w-full py-2.5 bg-[#005447] hover:bg-[#003F36] dark:bg-[#67E2C8] dark:hover:bg-[#52C5AD] text-white dark:text-[#171816] rounded-xl font-sans text-xs font-semibold shadow-sm transition-all"
            >
              Reload Page & Complete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
