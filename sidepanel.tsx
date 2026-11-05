import "./lib/suppress-warnings"
import React, { useState, useEffect } from "react"
import { ChatProvider } from "./lib/chat-context"
import { AlertProvider } from "./lib/alert-context"
import { MediaDeviceProvider } from "./lib/media-device-context"
import { TTSProvider } from "./lib/tts-context"
import { ThemeProvider } from "./lib/theme-context"
import { OnboardingProvider } from "./components/onboarding/onboarding-provider"
import { ErrorBoundary } from "./components/error-boundary"
import { MainScreen } from "./screens/main-screen"
import { ChatScreen } from "./screens/chat-screen"
import { HistoryScreen } from "./screens/history-screen"
import { ToolsScreen } from "./screens/tools-screen"
import { MemoryScreen } from "./screens/memory-screen"
import { SettingsScreen } from "./screens/settings-screen"
import { DebugScreen } from "./screens/debug-screen"
import { DEFAULT_SCREEN, type Screen } from "./lib/config"
import { preloadModel } from "./lib/ai"
import "./style.css"

const SidePanel = () => {
  const [currentScreen, setCurrentScreen] = useState<Screen>(DEFAULT_SCREEN)

  useEffect(() => {
    // Force full height
    document.body.style.height = '100vh'
    document.body.style.margin = '0'
    document.body.style.overflow = 'hidden'
    document.documentElement.style.height = '100vh'

    // Proactively preload the local AI model immediately on launch
    preloadModel().catch(() => {})
    
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
      <ErrorBoundary fallbackTitle="Pentone Startup Notice">
        <ThemeProvider>
          <AlertProvider>
            <OnboardingProvider isPopup={false}>
              <MediaDeviceProvider>
                <TTSProvider>
                  <ChatProvider>
                    <ErrorBoundary fallbackTitle="Screen Notice" onReset={() => setCurrentScreen('main')}>
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
                    </ErrorBoundary>
                  </ChatProvider>
                </TTSProvider>
              </MediaDeviceProvider>
            </OnboardingProvider>
          </AlertProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </div>
  )
}

export default SidePanel
