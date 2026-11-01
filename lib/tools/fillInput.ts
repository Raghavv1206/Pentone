import type { ToolSpec } from '../tool-types'

type FillResult = {
  success: boolean
  error?: string
  message?: string
}

async function fillInput(params: { index: number; value: string }) {
  try {
    const index = Number(params?.index)
    if (params?.index === undefined || params?.index === null || !Number.isInteger(index) || index < 0) {
      return { success: false, error: 'Element index is required and must be a non-negative integer' }
    }
    
    if (params.value === undefined || params.value === null) {
      return { success: false, error: 'Value is required' }
    }

    const stringVal = String(params.value)

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://') || tab.url?.startsWith('about:')) {
      return { success: false, error: 'Cannot interact with browser internal pages' }
    }

    // ALL fillInput goes through content script
    const contentResponse = await new Promise<{ success: boolean; result?: string; error?: string }>((resolve) => {
      chrome.tabs.sendMessage(tab.id, {
        type: 'fill_input',
        selector: `[data-pentone-${index}], [data-marionette-${index}]`,
        value: stringVal
      }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message })
        } else {
          resolve(response || { success: false, error: "No response from content script" })
        }
      })
    })
    
    if (!contentResponse.success) {
      // Resilient fallback: Direct script execution if content script is not yet mounted or connection timed out
      try {
        const fallbackResults = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (idx: number, val: string) => {
            let el = document.querySelector(`[data-pentone-${idx}], [data-marionette-${idx}]`) as HTMLElement
            if (!el) {
              // DOM re-index lookup if tag attributes were deferred
              const inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]'))
              if (idx < inputs.length) {
                el = inputs[idx] as HTMLElement
              }
            }
            if (!el) {
              return { success: false, error: `Element [${idx}] not found on page` }
            }
            el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            el.focus()
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
              el.value = val
              el.dispatchEvent(new Event('input', { bubbles: true }))
              el.dispatchEvent(new Event('change', { bubbles: true }))
              return { success: true, message: `Filled "${el.getAttribute('aria-label') || el.placeholder || 'input field'}"` }
            } else if (el.isContentEditable || el.getAttribute('role') === 'textbox') {
              el.click()
              el.focus()
              const ok = document.execCommand('insertText', false, val)
              if (!ok) {
                el.textContent = val
                el.dispatchEvent(new InputEvent('input', { bubbles: true }))
              }
              return { success: true, message: `Filled editable element [${idx}]` }
            }
            return { success: false, error: 'Target element is not an input, textarea, or editable element' }
          },
          args: [index, stringVal]
        })
        const fb = fallbackResults?.[0]?.result
        if (fb?.success) {
          return { success: true, result: fb.message || `Filled element ${index}` }
        }
        return { success: false, error: fb?.error || contentResponse.error || 'Failed to fill input' }
      } catch (scriptErr: any) {
        return { success: false, error: contentResponse.error || scriptErr?.message || 'Failed to fill input' }
      }
    }
    
    const response = { success: true, message: contentResponse.result } as FillResult
    
    if (response?.success === false) {
      return { success: false, error: response.error || 'Unknown error' }
    }
    
    return { 
      success: true, 
      result: response?.message || `Filled element ${index}`
    }
  } catch (error: any) {
    return { success: false, error: error?.message || 'Failed to fill input' }
  }
}

export const spec: ToolSpec = {
  name: 'fillInput',
  description: 'Fills a text input or textarea on the page with a value. Must call findElements or getAccessibilitySnapshot first to get element indices.',
  parameters: [
    {
      name: 'index',
      type: 'number',
      description: 'The index number of the input field (from findElements or getAccessibilitySnapshot)',
      required: true
    },
    {
      name: 'value',
      type: 'string',
      description: 'The text value to enter into the field',
      required: true
    }
  ],
  spokenLine: "Entering text into field",
  examples: [
    'User: "type hello in the search box" → fillInput with index: 2, value: "hello"',
    'User: "enter my email" → fillInput with index: 5, value: "user@example.com"',
    'After findElements shows [1] TEXTBOX: "Email" → fillInput with index: 1, value: "test@example.com"',
    'User: "fill in the message box" → fillInput with index: 8, value: "Thank you for your help"'
  ]
}

export default fillInput
