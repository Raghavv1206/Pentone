import '~lib/suppress-warnings'
export {}

import { initCustomTextSelection, triggerScreenshotMode, triggerAudioCapture } from '~components/custom-text-selection'
import { initCaptureOverlayButtons, setCaptureOverlayVisible } from '~components/capture-overlay-buttons'
import { initInlineFieldPill } from '~lib/autofill/inline-pill'
import { initSemanticSearchShortcut } from '~lib/ai/semantic-search'
import { showVoiceBadges, hideVoiceBadges, clickVoiceBadge } from '~lib/voice/voice-surfer'
import { loadSettings, type PentoneSettings } from '~lib/settings'

function isContextValid(): boolean {
  try {
    return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id)
  } catch {
    return false
  }
}

console.log('[Pentone] Content script initializing...')

// Initialize 1-click inline field filler pills safely
try {
  initInlineFieldPill()
} catch (err) {
  console.warn('[Pentone Content] initInlineFieldPill notice:', err)
}

// Initialize in-page semantic search (Ctrl + Shift + F / Cmd + Shift + F)
try {
  initSemanticSearchShortcut()
} catch (err) {
  console.warn('[Pentone Content] initSemanticSearchShortcut notice:', err)
}

let globalShortcutsEnabled = true

function applySettings(settings: PentoneSettings) {
  if (!settings) return
  console.log('[Pentone Content] Applying settings:', settings)
  
  globalShortcutsEnabled = Boolean(settings.globalShortcutsEnabled)
  
  // Initialize custom text selection overlay engine
  try {
    initCustomTextSelection()
  } catch (err) {
    console.warn('[Pentone Content] initCustomTextSelection notice:', err)
  }

  // Dispatch custom event to notify React tree in-page of live settings updates
  try {
    window.dispatchEvent(new CustomEvent('pentone_settings_changed', { detail: settings }))
  } catch {}

  // Manage capture overlay buttons
  try {
    if (settings.captureOverlayEnabled) {
      initCaptureOverlayButtons(triggerScreenshotMode, triggerAudioCapture)
      setCaptureOverlayVisible(true)
    } else {
      setCaptureOverlayVisible(false)
    }
  } catch (err) {
    console.warn('[Pentone Content] Capture overlay buttons notice:', err)
  }
}

// Initial settings load with fallback
loadSettings().then(applySettings).catch((err) => {
  console.log('[Pentone Content] Initial loadSettings fallback:', err)
})

// Persistent selection state for Spacebar voice input across tabs
let isPentoneSelected = false
let isSidepanelOpen = false
let isSpaceHeld = false
let spacePressStartTime = 0

// Initialize selection & sidepanel state from storage
if (isContextValid() && chrome.storage?.local) {
  try {
    chrome.storage.local.get(['pentone_selected', 'pentone_sidepanel_open'], (res) => {
      if (chrome.runtime?.lastError || !res) return
      isPentoneSelected = Boolean(res?.pentone_selected)
      isSidepanelOpen = Boolean(res?.pentone_sidepanel_open)
    })
  } catch {}
}

// Refresh on focus
window.addEventListener('focus', () => {
  if (isContextValid() && chrome.storage?.local) {
    try {
      chrome.storage.local.get(['pentone_selected', 'pentone_sidepanel_open'], (res) => {
        if (chrome.runtime?.lastError || !res) return
        isPentoneSelected = Boolean(res?.pentone_selected)
        isSidepanelOpen = Boolean(res?.pentone_sidepanel_open)
      })
    } catch {}
  }
})

// Storage listener for reactive real-time updates across all tabs
if (isContextValid() && chrome.storage?.onChanged) {
  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (!isContextValid()) return
      if (areaName === 'local') {
        if (changes.pentone_settings || changes.pentone_legacy_settings) {
          const newSettings = changes.pentone_settings?.newValue || changes.pentone_legacy_settings?.newValue
          if (newSettings) {
            applySettings(newSettings)
          }
        }
        if (changes.pentone_selected !== undefined) {
          isPentoneSelected = Boolean(changes.pentone_selected.newValue)
        }
        if (changes.pentone_sidepanel_open !== undefined) {
          isSidepanelOpen = Boolean(changes.pentone_sidepanel_open.newValue)
        }
      }
    })
  } catch {}
}

// Webpage interaction listeners - release Pentone selection when user interacts with the webpage
window.addEventListener('mousedown', (e: MouseEvent) => {
  try {
    const target = e.target as HTMLElement | null
    // Do not deselect if interacting with Pentone in-page overlays
    if (target?.closest?.('#pentone-overlay, .pentone-selection-popup, .pentone-capture-buttons, [data-pentone-ui]')) {
      return
    }
    if (isPentoneSelected) {
      console.log('[Pentone Content] User interacted with webpage via mousedown -> releasing Pentone selection')
      isPentoneSelected = false
      if (isContextValid() && chrome.storage?.local) {
        chrome.storage.local.set({ pentone_selected: false }).catch(() => {})
      }
    }
  } catch {}
}, { capture: true, passive: true })

// Webpage keydown listener - handles Spacebar hold-to-talk & releases selection on other keys
window.addEventListener('keydown', (e: KeyboardEvent) => {
  try {
    if (!isContextValid()) return
    const activeEl = document.activeElement
    const isInput = activeEl && (
      activeEl.tagName === 'INPUT' || 
      activeEl.tagName === 'TEXTAREA' || 
      activeEl.tagName === 'SELECT' || 
      (activeEl as HTMLElement).isContentEditable
    )

    // If user is typing in an input field, do not intercept Space and release Pentone selection
    if (isInput) {
      if (isPentoneSelected) {
        isPentoneSelected = false
        if (isContextValid() && chrome.storage?.local) {
          chrome.storage.local.set({ pentone_selected: false }).catch(() => {})
        }
      }
      return
    }

    // If Spacebar pressed while Pentone is selected and sidepanel is open -> INTERCEPT FOR VOICE
    if (e.code === 'Space' && isPentoneSelected && isSidepanelOpen) {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()

      if (!e.repeat && !isSpaceHeld) {
        isSpaceHeld = true
        spacePressStartTime = Date.now()
        console.log('[Pentone Content] Intercepted Spacebar hold for Pentone voice input')
        if (isContextValid() && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: 'pentone_spacebar_down' }).catch(() => {})
        }
      }
      return
    }

    // If user pressed another regular key (letters, numbers, etc.), they are interacting with the webpage
    if (e.code !== 'Space' && !e.ctrlKey && !e.metaKey && !e.altKey && !['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
      if (isPentoneSelected) {
        isPentoneSelected = false
        if (isContextValid() && chrome.storage?.local) {
          chrome.storage.local.set({ pentone_selected: false }).catch(() => {})
        }
      }
    }
  } catch {}
}, { capture: true })

// Webpage keyup listener - completes push-to-talk release
window.addEventListener('keyup', (e: KeyboardEvent) => {
  try {
    if (e.code === 'Space' && isSpaceHeld) {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      isSpaceHeld = false
      const duration = Date.now() - spacePressStartTime
      console.log(`[Pentone Content] Spacebar released after ${duration}ms, signaling speech completion`)
      if (isContextValid() && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'pentone_spacebar_up', duration }).catch(() => {})
      }
    }
  } catch {}
}, { capture: true })

// Listen for keyboard shortcuts
document.addEventListener('keydown', (e) => {
  try {
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
  } catch {}
})

// Listen for messages from background / popup / sidepanel
if (isContextValid() && chrome.runtime?.onMessage) {
  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      try {
        if (message.type === 'capture_tab_audio') {
          handleTabAudioCapture(message.streamId, message.duration)
            .then(result => sendResponse({ result }))
            .catch(error => sendResponse({ error: error?.message || String(error) }))
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
              console.warn('[Pentone Content] Fill notice:', error)
              sendResponse({ success: false, error: error?.message || String(error) })
            })
          return true
        }
        
        if (message.type === 'pentone_set_selected') {
          isPentoneSelected = Boolean(message.selected)
          console.log(`[Pentone Content] Selection state explicitly set to: ${isPentoneSelected}`)
          sendResponse({ success: true, selected: isPentoneSelected })
          return true
        }

        if (message.type === 'settings_updated') {
          console.log('[Pentone Content] Received settings_updated message')
          if (message.settings) {
            applySettings(message.settings)
          } else {
            loadSettings().then(applySettings).catch(() => {})
          }
          sendResponse({ success: true })
          return true
        }

        if (message.type === 'pentone_voice_surfer') {
          if (message.action === 'hide') {
            hideVoiceBadges()
            sendResponse({ success: true, message: 'Voice badges hidden.' })
          } else if (message.action === 'click' && message.index !== undefined) {
            const res = clickVoiceBadge(message.index)
            sendResponse(res)
          } else {
            const res = showVoiceBadges()
            sendResponse({ success: true, count: res.count, message: res.message })
          }
          return true
        }
      } catch (err: any) {
        console.warn('[Pentone Content] onMessage handling notice:', err)
        sendResponse({ success: false, error: err?.message || String(err) })
        return true
      }
    })
  } catch {}
}

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
    console.warn('[Pentone Content] Handled error capturing tab audio:', error)
    throw error
  }
}
