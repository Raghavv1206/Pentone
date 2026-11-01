import type { ToolSpec } from '../tool-types'

// Transient store for pre-acquired tab capture streams obtained during direct user gestures
interface PreAcquiredStream {
  streamId: string
  tabId: number
  acquiredAt: number
  consumed: boolean
}

let preAcquiredStream: PreAcquiredStream | null = null

/**
 * Pre-acquires a media stream ID for tab audio capture during a direct user gesture.
 * Must be called synchronously within a trusted user event handler (e.g. click).
 */
export async function acquireTabCaptureStreamId(targetTabId?: number): Promise<string> {
  let tabId = targetTabId
  if (!tabId) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!activeTab?.id) {
      throw new Error('No active tab found to capture audio from')
    }
    tabId = activeTab.id
  }

  if (!chrome.tabCapture?.getMediaStreamId) {
    throw new Error('tabCapture API is not supported in this browser profile')
  }

  return new Promise<string>((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ consumerTabId: tabId! }, (id) => {
      if (chrome.runtime?.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
      } else if (id) {
        preAcquiredStream = {
          streamId: id,
          tabId: tabId!,
          acquiredAt: Date.now(),
          consumed: false
        }
        resolve(id)
      } else {
        reject(new Error('Failed to acquire tab media stream ID'))
      }
    })
  })
}

export function consumePreAcquiredStreamId(tabId: number): string | null {
  if (
    preAcquiredStream &&
    !preAcquiredStream.consumed &&
    preAcquiredStream.tabId === tabId &&
    Date.now() - preAcquiredStream.acquiredAt < 30000 // 30-second TTL
  ) {
    preAcquiredStream.consumed = true
    const id = preAcquiredStream.streamId
    preAcquiredStream = null
    return id
  }
  return null
}

export function clearPreAcquiredStream(): void {
  preAcquiredStream = null
}

async function captureAudio(params?: { duration?: number; streamId?: string }) {
  try {
    const duration = Math.min(Math.max(params?.duration || 5, 1), 30)

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found for audio capture' }
    }

    if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://') || tab.url?.startsWith('about:')) {
      return { success: false, error: 'Cannot capture tab audio from browser internal pages' }
    }

    // 1. Check if streamId is explicitly passed or was pre-acquired during a trusted user gesture
    let streamId = params?.streamId || consumePreAcquiredStreamId(tab.id)

    // 2. If not pre-acquired, attempt to acquire tab media stream ID directly
    if (!streamId) {
      try {
        streamId = await new Promise<string>((resolve, reject) => {
          if (!chrome.tabCapture?.getMediaStreamId) {
            reject(new Error('tabCapture API is not supported in this browser profile'))
            return
          }
          chrome.tabCapture.getMediaStreamId({ consumerTabId: tab.id }, (id) => {
            if (chrome.runtime?.lastError) {
              reject(new Error(chrome.runtime.lastError.message))
            } else if (id) {
              resolve(id)
            } else {
              reject(new Error('Failed to acquire tab media stream ID'))
            }
          })
        })
      } catch (acquireErr: any) {
        const errMsg = acquireErr?.message || ''
        if (
          errMsg.includes('Extension has not been invoked') || 
          errMsg.includes('activeTab') || 
          errMsg.includes('gesture') ||
          errMsg.includes('User gesture') ||
          (typeof navigator !== 'undefined' && !(navigator as any)?.userActivation?.isActive)
        ) {
          return {
            success: false,
            error: 'Tab audio capture requires a direct click gesture (activeTab invocation): please click the extension icon or capture button on this tab first.',
            requiresUserGesture: true,
            isPermissionError: true,
            targetTabId: tab.id,
            recoveryAction: 'CLICK_TAB_CAPTURE'
          }
        }
        throw acquireErr
      }
    }

    // 3. Forward to content script
    const captureResult = await new Promise<{ result?: string; error?: string }>((resolve) => {
      chrome.tabs.sendMessage(tab.id!, {
        type: 'capture_tab_audio',
        streamId,
        duration
      }, (res) => {
        if (chrome.runtime?.lastError) {
          resolve({ error: chrome.runtime.lastError.message })
        } else {
          resolve(res || { error: 'No response from tab audio capture handler' })
        }
      })
    })

    if (captureResult.error) {
      return { success: false, error: captureResult.error }
    }

    return {
      success: true,
      audioDataUrl: captureResult.result,
      result: `Captured ${duration}s of audio from active tab`
    }
  } catch (error: any) {
    const errorMsg = error?.message || 'Failed to capture tab audio'
    if (errorMsg.includes('Extension has not been invoked') || errorMsg.includes('activeTab') || errorMsg.includes('gesture')) {
      return {
        success: false,
        error: 'Tab audio capture requires a direct click gesture (activeTab invocation): please click the extension icon or capture button on this tab first.',
        isPermissionError: true,
        requiresUserGesture: true
      }
    }
    return { success: false, error: errorMsg }
  }
}

export const spec: ToolSpec = {
  name: 'captureAudio',
  description: 'Captures playing audio directly from the active browser tab (NOT microphone input). Requires user invocation/gesture on the active tab.',
  parameters: [
    {
      name: 'duration',
      type: 'number',
      description: 'Duration to record in seconds (between 1 and 30, default: 5)',
      required: false
    },
    {
      name: 'streamId',
      type: 'string',
      description: 'Pre-acquired tab capture stream ID obtained during a direct user gesture',
      required: false
    }
  ],
  examples: [
    'User: "record 5 seconds of audio from this video" → captureAudio with duration: 5',
    'User: "listen to the tab audio" → captureAudio'
  ],
  spokenLine: 'Capturing audio from page',
  requiresUserGesture: true
}

export default captureAudio
