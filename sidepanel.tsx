import React, { useState, useEffect } from "react"
import { ChatProvider } from "./lib/chat-context"
import { AlertProvider } from "./lib/alert-context"
import { MediaDeviceProvider } from "./lib/media-device-context"
import { TTSProvider } from "./lib/tts-context"
import { ModelProvisioningProvider } from "./lib/model-provisioning-context"
import { generativeRuntime } from "./lib/generative-runtime"
import { OnboardingProvider } from "./components/onboarding/onboarding-provider"
import { ThemeProvider } from "./lib/theme-context"
import { MainScreen } from "./screens/main-screen"
import { ChatScreen } from "./screens/chat-screen"
import { HistoryScreen } from "./screens/history-screen"
import { ToolsScreen } from "./screens/tools-screen"
import { MemoryScreen } from "./screens/memory-screen"
import { DiagnosticsScreen } from "./screens/diagnostics-screen"
import { SettingsScreen } from "./screens/settings-screen"
import { VoiceEnrollmentScreen } from "./screens/voice-enrollment-screen"
import { DEFAULT_SCREEN, type Screen } from "./lib/config"
import "./style.css"

const SidePanel = () => {
  const [currentScreen, setCurrentScreen] = useState<Screen>(DEFAULT_SCREEN)
  const [enrollmentUserId, setEnrollmentUserId] = useState<string>('default_user')

  useEffect(() => {
    // Ensure full viewport dimensions without body scroll interference
    document.body.style.height = '100%'
    document.body.style.width = '100%'
    document.body.style.margin = '0'
    document.body.style.overflow = 'hidden'
    document.documentElement.style.height = '100%'
    document.documentElement.style.width = '100%'
    
    // Listen for ping messages to detect if sidepanel is open
    const handleMessage = (message: any, sender: any, sendResponse: (response?: any) => void) => {
      if (message.type === 'ping_sidepanel') {
        sendResponse({ alive: true })
        return true
      }
    }
    
    chrome.runtime.onMessage.addListener(handleMessage)

    // Best-effort cleanup when sidepanel closes
    const handleBeforeUnload = () => {
      generativeRuntime.unloadModel().catch(() => {})
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

  return (
    <ThemeProvider>
      <AlertProvider>
        <OnboardingProvider isPopup={false}>
          <MediaDeviceProvider>
            <TTSProvider>
              <ChatProvider>
                <ModelProvisioningProvider>
                <div className="w-full h-full flex flex-col min-h-0 overflow-hidden bg-[#FFFEEF] dark:bg-[#171816] text-[#191919] dark:text-[#F5F1E7] transition-colors duration-200">
                  {currentScreen === 'main' ? (
                    <MainScreen 
                      onNavigate={setCurrentScreen}
                      onNavigateToDebug={() => setCurrentScreen('diagnostics')} 
                      onNavigateToSettings={() => setCurrentScreen('settings')}
                      fullHeight 
                    />
                  ) : currentScreen === 'chat' ? (
                    <ChatScreen onNavigate={setCurrentScreen} />
                  ) : currentScreen === 'history' ? (
                    <HistoryScreen onNavigate={setCurrentScreen} />
                  ) : currentScreen === 'tools' ? (
                    <ToolsScreen onNavigate={setCurrentScreen} />
                  ) : currentScreen === 'memory' ? (
                    <MemoryScreen onNavigate={setCurrentScreen} />
                  ) : currentScreen === 'settings' ? (
                    <SettingsScreen 
                      onBack={() => setCurrentScreen('main')}
                      onNavigateToEnrollment={(userId) => {
                        setEnrollmentUserId(userId)
                        setCurrentScreen('voice-enrollment')
                      }}
                    />
                  ) : currentScreen === 'diagnostics' || currentScreen === 'debug' ? (
                    <DiagnosticsScreen onNavigate={setCurrentScreen} />
                  ) : currentScreen === 'voice-enrollment' ? (
                    <VoiceEnrollmentScreen 
                      userId={enrollmentUserId} 
                      onBack={() => setCurrentScreen('settings')} 
                      onEnrollmentComplete={() => setCurrentScreen('settings')}
                    />
                  ) : (
                    <MainScreen 
                      onNavigate={setCurrentScreen}
                      onNavigateToDebug={() => setCurrentScreen('diagnostics')} 
                      onNavigateToSettings={() => setCurrentScreen('settings')}
                      fullHeight 
                    />
                  )}
                </div>
                </ModelProvisioningProvider>
              </ChatProvider>
            </TTSProvider>
          </MediaDeviceProvider>
        </OnboardingProvider>
      </AlertProvider>
    </ThemeProvider>
  )
}

export default SidePanel
