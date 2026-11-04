import React, { useState, useEffect } from "react"
import { ChatProvider } from "./lib/chat-context"
import { AlertProvider } from "./lib/alert-context"
import { MediaDeviceProvider } from "./lib/media-device-context"
import { TTSProvider } from "./lib/tts-context"
import { ThemeProvider } from "./lib/theme-context"
import { OnboardingProvider } from "./components/onboarding/onboarding-provider"
import { MainScreen } from "./screens/main-screen"
import { ChatScreen } from "./screens/chat-screen"
import { HistoryScreen } from "./screens/history-screen"
import { ToolsScreen } from "./screens/tools-screen"
import { MemoryScreen } from "./screens/memory-screen"
import { SettingsScreen } from "./screens/settings-screen"
import { DebugScreen } from "./screens/debug-screen"
import { DEFAULT_SCREEN, type Screen } from "./lib/config"
import "./style.css"

const SidePanel = () => {
  const [currentScreen, setCurrentScreen] = useState<Screen>(DEFAULT_SCREEN)

  useEffect(() => {
    // Force full height
    document.body.style.height = '100vh'
    document.body.style.margin = '0'
    document.body.style.overflow = 'hidden'
    document.documentElement.style.height = '100vh'
    
    // Listen for ping messages to detect if sidepanel is open
    const handleMessage = (message: any, sender: any, sendResponse: (response?: any) => void) => {
      if (message.type === 'ping_sidepanel') {
        console.log('[Sidepanel] Responding to ping')
        sendResponse({ alive: true })
        return true
      }
    }
    
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(handleMessage)
      return () => {
        chrome.runtime.onMessage.removeListener(handleMessage)
      }
    }
  }, [])

  return (
    <div className="w-full h-screen min-h-0 min-w-0 flex flex-col overflow-hidden bg-[#FFFEEF] dark:bg-[#171816]">
      <ThemeProvider>
        <AlertProvider>
          <OnboardingProvider isPopup={false}>
            <MediaDeviceProvider>
              <TTSProvider>
                <ChatProvider>
                  {currentScreen === 'main' ? (
                    <MainScreen 
                      onNavigate={(screen) => setCurrentScreen(screen)}
                      onNavigateToDebug={() => setCurrentScreen('debug')} 
                      onNavigateToSettings={() => setCurrentScreen('settings')}
                      fullHeight 
                    />
                  ) : currentScreen === 'chat' ? (
                    <ChatScreen onNavigate={(screen) => setCurrentScreen(screen)} />
                  ) : currentScreen === 'history' ? (
                    <HistoryScreen onNavigate={(screen) => setCurrentScreen(screen)} />
                  ) : currentScreen === 'tools' ? (
                    <ToolsScreen onNavigate={(screen) => setCurrentScreen(screen)} />
                  ) : currentScreen === 'memory' ? (
                    <MemoryScreen onNavigate={(screen) => setCurrentScreen(screen)} />
                  ) : currentScreen === 'settings' ? (
                    <SettingsScreen onBack={() => setCurrentScreen('main')} />
                  ) : (
                    <DebugScreen onNavigateToMain={() => setCurrentScreen('main')} fullHeight />
                  )}
                </ChatProvider>
              </TTSProvider>
            </MediaDeviceProvider>
          </OnboardingProvider>
        </AlertProvider>
      </ThemeProvider>
    </div>
  )
}

export default SidePanel
