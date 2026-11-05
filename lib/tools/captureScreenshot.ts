import type { ToolSpec } from '../tool-registry'

async function captureScreenshot(params: any) {
  try {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    // Check if the current tab is an internal or restricted browser page (e.g. chrome://, chrome-extension://)
    const isRestrictedUrl = (url?: string) =>
      !url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('devtools://') || url.startsWith('edge://') || url.startsWith('about:')

    if (isRestrictedUrl(tab.url)) {
      // Find a non-restricted web tab in the current window to capture
      const allTabs = await chrome.tabs.query({ currentWindow: true })
      const webTab = allTabs.slice().reverse().find(t => t.url && !isRestrictedUrl(t.url))
      if (webTab?.id) {
        await chrome.tabs.update(webTab.id, { active: true })
        await new Promise(r => setTimeout(r, 200))
        tab = webTab
      } else {
        return {
          success: true,
          result: "Screenshot skipped: Current tab is an internal browser page (chrome://) which cannot be captured due to Chrome security restrictions. Open any web page to take a screenshot."
        }
      }
    }

    // Capture screenshot first so flash effect is never in the captured image
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
    
    // Execute flash animation & camera sound on active tab simultaneously
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          // Play camera shutter sound directly in active tab at exact capture moment
          try {
            const shutterUrl = chrome.runtime.getURL('assets/camera-shutter-close.wav')
            const audio = new Audio(shutterUrl)
            audio.volume = 0.5
            audio.play().catch(() => {})
          } catch {}

          // CSP-safe camera flash animation without <style> tags (works reliably on YouTube, Gmail, GitHub, etc.)
          const flash = document.createElement('div')
          flash.id = 'pentone-screenshot-flash'
          flash.style.position = 'fixed'
          flash.style.top = '0'
          flash.style.left = '0'
          flash.style.width = '100vw'
          flash.style.height = '100vh'
          flash.style.backgroundColor = '#ffffff'
          flash.style.zIndex = '2147483647'
          flash.style.pointerEvents = 'none'
          flash.style.opacity = '0.85'
          flash.style.transition = 'opacity 0.35s cubic-bezier(0.16, 1, 0.3, 1)'

          const parent = document.body || document.documentElement
          if (parent) {
            parent.appendChild(flash)
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                flash.style.opacity = '0'
              })
            })
            setTimeout(() => {
              flash.remove()
            }, 400)
          }
        }
      })
    } catch (flashError) {
      // Continue even if tab is restricted (e.g. chrome://)
      console.warn('Tab flash effect notice:', flashError)
    }
    
    return { 
      success: true, 
      result: dataUrl,
      isImage: true
    }
  } catch (error: any) {
    console.warn('[captureScreenshot] Capture notice:', error)
    return {
      success: true,
      result: `Unable to capture screenshot: ${error?.message || 'Page view cannot be captured due to browser restrictions'}`
    }
  }
}

export const spec: ToolSpec = {
  name: 'captureScreenshot',
  description: 'REQUIRED for visual questions: Takes a screenshot to see the actual page content, layout, images, and text. You only know title/URL without this - use it whenever user asks about what\'s visible.',
  parameters: [],
  spokenLine: "Let me see what you're looking at",
  examples: [
    'User: "what do you see?" → captureScreenshot (REQUIRED to see visual content)',
    'User: "describe this page" → captureScreenshot (REQUIRED to see actual content)',
    'User: "what am i looking at?" → captureScreenshot',
    'User: "what\'s on the page?" → captureScreenshot',
    'User: "show me the page" → captureScreenshot',
    'User: "is there a login button?" → captureScreenshot'
  ]
}

export default captureScreenshot
