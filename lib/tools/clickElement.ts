import type { ToolSpec } from '../tool-types'

async function clickElement(params: { index: number }) {
  try {
    const index = Number(params?.index)
    if (params?.index === undefined || params?.index === null || !Number.isInteger(index) || index < 0) {
      return { success: false, error: 'Element index is required and must be a non-negative integer' }
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    // Check if on internal page
    if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://') || tab.url?.startsWith('about:')) {
      return { success: false, error: 'Cannot interact with browser internal pages' }
    }

    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (elementIndex: number) => {
        const element = (document.querySelector(`[data-pentone-${elementIndex}]`) || document.querySelector(`[data-marionette-${elementIndex}]`)) as HTMLElement
        
        if (!element) {
          return { success: false, error: `Element with index ${elementIndex} not found. Call findElements or getAccessibilitySnapshot first to refresh current element indices.` }
        }
        
        // Check if element is disabled
        if (element.hasAttribute('disabled') || (element as any).disabled) {
          return { success: false, error: 'Element is disabled' }
        }
        
        // Scroll into view
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        
        // Click the element
        element.click()
        
        // Get element info for confirmation
        const role = element.getAttribute('role') || element.tagName.toLowerCase()
        const name = element.getAttribute('aria-label') || element.textContent?.trim() || 'unnamed element'
        
        return { 
          success: true, 
          message: `Clicked ${role}: "${name.substring(0, 50)}"` 
        }
      },
      args: [index]
    })

    const response = result[0]?.result
    
    if (response?.success === false) {
      return { success: false, error: response.error }
    }
    
    return { 
      success: true, 
      result: response?.message || `Clicked element ${index}`
    }
  } catch (error: any) {
    return { success: false, error: error?.message || 'Failed to click element' }
  }
}

export const spec: ToolSpec = {
  name: 'clickElement',
  description: 'Clicks an interactive element on the page (button, link, video card, control) by its index number. Must call findElements or getAccessibilitySnapshot first to discover current element indices.',
  parameters: [
    {
      name: 'index',
      type: 'number',
      description: 'The index number of the element to click (from findElements or getAccessibilitySnapshot)',
      required: true
    }
  ],
  spokenLine: "Clicking element {index}",
  examples: [
    'User: "click submit" → clickElement with index: 3',
    'User: "click first video" → findElements "video", then clickElement with index'
  ]
}

export default clickElement
