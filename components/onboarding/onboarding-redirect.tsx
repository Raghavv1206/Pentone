import React from 'react'
import { ArrowRight, Sparkles } from 'lucide-react'

export const OnboardingRedirect = () => {
  const handleOpenSidePanel = async () => {
    try {
      const win = await chrome.windows.getCurrent()
      if (win.id) {
        await chrome.sidePanel.open({ windowId: win.id })
      }
      window.close()
    } catch (error) {
      console.error('Failed to open sidepanel:', error)
    }
  }

  return (
    <div className="w-full h-full min-h-[480px] bg-[#FFFEEF] dark:bg-[#171816] text-[#191919] dark:text-[#F5F1E7] flex flex-col items-center justify-center p-6 transition-colors duration-200">
      <div className="max-w-sm w-full text-center space-y-5">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#EBE7D0] dark:bg-[#2A2B26] text-[#005447] dark:text-[#67E2C8] text-xs font-medium mb-1">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Welcome to Pentone</span>
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#191919] dark:text-[#F5F1E7]">
            Setup Pentone in Side Panel
          </h1>
          <p className="font-sans text-xs text-[#77776E] dark:text-[#A6A49B]">
            Pentone runs as an integrated browser side panel with ample room for conversation and automation.
          </p>
        </div>

        <div className="bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] rounded-xl p-4 text-left space-y-2">
          <p className="font-sans text-xs text-[#191919] dark:text-[#F5F1E7] font-medium">
            First Time Setup
          </p>
          <p className="font-sans text-xs text-[#77776E] dark:text-[#A6A49B]">
            Click below to open Pentone in the side panel to complete local AI provisioning and microphone configuration.
          </p>
        </div>

        <button
          onClick={handleOpenSidePanel}
          className="w-full bg-[#005447] hover:bg-[#003F36] dark:bg-[#67E2C8] dark:hover:bg-[#52C5AD] text-white dark:text-[#171816] px-5 py-3 rounded-xl font-sans font-semibold text-xs sm:text-sm transition-all duration-200 flex items-center justify-center gap-2 shadow-sm"
        >
          <span>Open Side Panel</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
