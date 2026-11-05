export {}

import { initCustomTextSelection, triggerScreenshotMode, triggerAudioCapture } from '~components/custom-text-selection'
import { initCaptureOverlayButtons, setCaptureOverlayVisible } from '~components/capture-overlay-buttons'
import { loadSettings, type PentoneSettings } from '~lib/settings'

console.log('[Pentone] Content script initializing...')

let globalShortcutsEnabled = true

function applySettings(settings: PentoneSettings) {
  if (!settings) return
  console.log('[Pentone Content] Applying settings:', settings)
  
  globalShortcutsEnabled = Boolean(settings.globalShortcutsEnabled)
  
  // Initialize custom text selection overlay engine
  initCustomTextSelection()

  // Dispatch custom event to notify React tree in-page of live settings updates
  window.dispatchEvent(new CustomEvent('pentone_settings_changed', { detail: settings }))

  // Manage capture overlay buttons
  if (settings.captureOverlayEnabled) {
    initCaptureOverlayButtons(triggerScreenshotMode, triggerAudioCapture)
    setCaptureOverlayVisible(true)
  } else {
    setCaptureOverlayVisible(false)
  }
}

// Initial settings load
loadSettings().then(applySettings)

// Storage listener for reactive real-time updates across all tabs
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && (changes.pentone_settings || changes.pentone_legacy_settings)) {
      const newSettings = changes.pentone_settings?.newValue || changes.pentone_legacy_settings?.newValue
      if (newSettings) {
        applySettings(newSettings)
      }
    }
  })
}

// Listen for keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (!globalShortcutsEnabled) return
  
  // Cmd/Ctrl + Shift + S for screenshot
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 's' || e.key === 'S')) {
    e.preventDefault()
    e.stopPropagation()
    triggerScreenshotMode()
  }
  
  // Cmd/Ctrl + Shift + A for audio capture
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'a' || e.key === 'A')) {
    e.preventDefault()
    e.stopPropagation()
    triggerAudioCapture()
  }
})

// Listen for messages from background / popup / sidepanel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'capture_tab_audio') {
    handleTabAudioCapture(message.streamId, message.duration)
      .then(result => sendResponse({ result }))
      .catch(error => sendResponse({ error: error.message }))
    return true
  }
  
  if (message.type === 'fill_input') {
    console.log('[Pentone Content] Received fill_input message:', message)
    handleFillInput(message.selector, message.value)
      .then(result => {
        console.log('[Pentone Content] Fill succeeded:', result)
        sendResponse({ success: true, result })
      })
      .catch(error => {
        console.error('[Pentone Content] Fill failed:', error)
        sendResponse({ success: false, error: error.message })
      })
    return true
  }
  
  if (message.type === 'settings_updated') {
    console.log('[Pentone Content] Received settings_updated message')
    if (message.settings) {
      applySettings(message.settings)
    } else {
      loadSettings().then(applySettings)
    }
    sendResponse({ success: true })
    return true
  }
})

async function handleFillInput(selector: string, value: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const element = document.querySelector(selector) as HTMLElement
    
    if (!element) {
      reject(new Error(`Element not found with selector ${selector}. Call findElements or getAccessibilitySnapshot first to get current element indices.`))
      return
    }
    
    const isInput = element instanceof HTMLInputElement
    const isTextarea = element instanceof HTMLTextAreaElement
    const isContentEditable = element.getAttribute('contenteditable') === 'true' || 
                              element.getAttribute('role') === 'textbox'
    
    if (!isInput && !isTextarea && !isContentEditable) {
      reject(new Error('Element is not an input, textarea, or contenteditable'))
      return
    }
    
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    element.focus()
    
    if (isContentEditable) {
      element.click()
      element.focus()
      
      setTimeout(() => {
        try {
          const success = document.execCommand('insertText', false, value)
          
          if (!success) {
            element.textContent = value
            element.dispatchEvent(new InputEvent('input', { bubbles: true }))
          }
          
          const name = element.getAttribute('aria-label') || 'input field'
          resolve(`Filled "${name.substring(0, 50)}"`)
        } catch (error: any) {
          reject(error)
        }
      }, 100)
    } else {
      try {
        const inputElement = element as HTMLInputElement | HTMLTextAreaElement
        inputElement.value = value
        inputElement.dispatchEvent(new Event('input', { bubbles: true }))
        inputElement.dispatchEvent(new Event('change', { bubbles: true }))
        
        const name = element.getAttribute('aria-label') || 
                     inputElement.labels?.[0]?.textContent?.trim() ||
                     inputElement.placeholder || 
                     'input field'
        resolve(`Filled "${name.substring(0, 50)}"`)
      } catch (error: any) {
        reject(error)
      }
    }
  })
}

async function handleTabAudioCapture(streamId: string, duration: number): Promise<string> {
  try {
    console.log('[Pentone Content] Starting tab audio capture')
    
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      } as any
    } as any)

    const audioContext = new AudioContext()
    const source = audioContext.createMediaStreamSource(stream)
    source.connect(audioContext.destination)

    const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
    const audioChunks: Blob[] = []
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data)
      }
    }
    
    mediaRecorder.start()
    console.log(`[Pentone Content] Recording tab audio for ${duration} seconds`)
    
    setTimeout(() => {
      mediaRecorder.stop()
      stream.getTracks().forEach(track => track.stop())
      audioContext.close()
    }, duration * 1000)
    
    const audioBlob = await new Promise<Blob>((resolve) => {
      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunks, { type: 'audio/webm' })
        resolve(blob)
      }
    })
    
    const reader = new FileReader()
    const audioDataUrl = await new Promise<string>((resolve) => {
      reader.onload = () => resolve(reader.result as string)
      reader.readAsDataURL(audioBlob)
    })
    
    console.log(`[Pentone Content] Audio recording completed: ${audioBlob.size} bytes`)
    return audioDataUrl
    
  } catch (error) {
    console.error('[Pentone Content] Error capturing tab audio:', error)
    throw error
  }
}
