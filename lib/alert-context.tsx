import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { X, AlertCircle, Info } from 'lucide-react'
import { setGlobalAlertHandler } from './chat-context'

type AlertType = 'error' | 'info'

export interface AlertAction {
  label: string
  onClick: () => void
}

// Safe helper to open URL in Chrome tabs or window
const safeOpenUrl = (url: string) => {
  try {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url })
    } else {
      window.open(url, '_blank')
    }
  } catch {
    window.open(url, '_blank')
  }
}

// Helper to open extension permissions page
export const openPermissionsPage = () => {
  const extId = typeof chrome !== 'undefined' && chrome.runtime?.id ? chrome.runtime.id : ''
  const url = `chrome://settings/content/siteDetails?site=chrome-extension://${extId}`
  safeOpenUrl(url)
}

// Helper to open native permission prompt in a tab (side panels cannot show permission prompts)
export const openMicrophonePromptTab = () => {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL && chrome.tabs?.create) {
      const url = chrome.runtime.getURL('tabs/permission.html')
      chrome.tabs.create({ url })
    } else {
      openPermissionsPage()
    }
  } catch {
    openPermissionsPage()
  }
}

// Helper to open Chrome flags for AI model
export const openAIFlagsPage = () => {
  safeOpenUrl('chrome://flags/#prompt-api-for-gemini-nano')
}

// Helper to open Chrome flags for Optimization Guide On-Device Model
export const openOptimizationGuideFlagsPage = () => {
  safeOpenUrl('chrome://flags/#optimization-guide-on-device-model')
}

// Helper to open all required Chrome flags in one click
export const openAllRequiredFlags = () => {
  safeOpenUrl('chrome://flags/#optimization-guide-on-device-model')
  safeOpenUrl('chrome://flags/#prompt-api-for-gemini-nano')
}

// Helper to open Chrome AI documentation
export const openChromeAIDocs = () => {
  safeOpenUrl('https://developer.chrome.com/docs/ai/prompt-api')
}

// Helper to open Chrome flags for Writer API
export const openWriterAPIFlagsPage = () => {
  safeOpenUrl('chrome://flags/#writer-api-for-gemini-nano')
}

// Helper to open Chrome flags for Rewriter API
export const openRewriterAPIFlagsPage = () => {
  safeOpenUrl('chrome://flags/#rewriter-api-for-gemini-nano')
}

// Helper to open Chrome flags for Translator API
export const openTranslatorAPIFlagsPage = () => {
  safeOpenUrl('chrome://flags/#translation-api')
}

// Helper to open Chrome flags for Language Detector API
export const openLanguageDetectorAPIFlagsPage = () => {
  safeOpenUrl('chrome://flags/#language-detection-api')
}

// Helper to open Chrome flags for Summarization API
export const openSummarizationAPIFlagsPage = () => {
  safeOpenUrl('chrome://flags/#summarization-api-for-gemini-nano')
}

interface Alert {
  id: string
  type: AlertType
  title: string
  message: string
  action?: AlertAction
}

interface AlertContextValue {
  showAlert: (type: AlertType, title: string, message: string, action?: AlertAction) => void
  hideAlert: (id: string) => void
}

const AlertContext = createContext<AlertContextValue | null>(null)

export const AlertProvider = ({ children }: { children: ReactNode }) => {
  const [alerts, setAlerts] = useState<Alert[]>([])

  const showAlert = useCallback((type: AlertType, title: string, message: string, action?: AlertAction) => {
    const id = Date.now().toString()
    setAlerts(prev => [...prev, { id, type, title, message, action }])
  }, [])

  const hideAlert = useCallback((id: string) => {
    setAlerts(prev => prev.filter(alert => alert.id !== id))
  }, [])

  // Register global alert handler
  useEffect(() => {
    setGlobalAlertHandler(showAlert)
    return () => setGlobalAlertHandler(() => {})
  }, [showAlert])

  return (
    <AlertContext.Provider value={{ showAlert, hideAlert }}>
      {children}
      
      {/* Alert Display */}
      <div className="fixed top-3 right-3 z-50 flex flex-col gap-2" style={{ maxWidth: '400px' }}>
        {alerts.map(alert => (
          <div
            key={alert.id}
            className={`p-3 rounded border font-mono text-xs ${
              alert.type === 'error'
                ? 'bg-red-950 border-red-800 text-red-200'
                : 'bg-blue-950 border-blue-800 text-blue-200'
            }`}
          >
            <div className="flex items-start gap-2">
              <div className="flex-shrink-0 mt-0.5">
                {alert.type === 'error' ? (
                  <AlertCircle className="w-4 h-4" />
                ) : (
                  <Info className="w-4 h-4" />
                )}
              </div>
              <div className="flex-1">
                <div className="font-bold mb-1">{alert.title}</div>
                <div className="text-[10px] whitespace-pre-wrap">{alert.message}</div>
                {alert.action && (
                  <button
                    onClick={() => {
                      alert.action?.onClick()
                      hideAlert(alert.id)
                    }}
                    className="mt-2 px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-[10px] font-bold cursor-pointer"
                  >
                    {alert.action.label}
                  </button>
                )}
              </div>
              <button
                onClick={() => hideAlert(alert.id)}
                className="flex-shrink-0 p-0.5 hover:bg-black/30 rounded"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </AlertContext.Provider>
  )
}

export const useAlert = () => {
  const context = useContext(AlertContext)
  if (!context) {
    throw new Error('useAlert must be used within AlertProvider')
  }
  return context
}
