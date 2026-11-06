import type { ToolSpec } from '../tool-registry'

interface FillParams {
  index?: number | string
  query?: string
  selector?: string
  value?: string
}

async function fillInput(params: FillParams) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    const valueToFill = params.value !== undefined ? params.value : ''

    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (args: { index?: number | string, query?: string, selector?: string, value: string }) => {
        let inputEl: HTMLInputElement | HTMLTextAreaElement | null = null

        // 1. Check index
        if (args.index !== undefined && args.index !== null) {
          const rawIdx = typeof args.index === 'string' ? parseInt(args.index, 10) : args.index
          if (!isNaN(rawIdx)) {
            inputEl = document.querySelector(`[data-pentone-${rawIdx}]`) as HTMLInputElement
          }
        }

        // 2. Check selector
        if (!inputEl && args.selector) {
          try {
            inputEl = document.querySelector(args.selector) as HTMLInputElement
          } catch {}
        }

        // 3. Check query or active element
        if (!inputEl) {
          const query = (args.query || '').toLowerCase().trim()
          
          if (document.activeElement && (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement)) {
            inputEl = document.activeElement
          } else {
            const allInputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]')) as (HTMLInputElement | HTMLTextAreaElement)[]
            
            if (query) {
              inputEl = allInputs.find(el => {
                const placeholder = (el.placeholder || '').toLowerCase()
                const name = (el.name || '').toLowerCase()
                const aria = (el.getAttribute('aria-label') || '').toLowerCase()
                const id = (el.id || '').toLowerCase()
                return placeholder.includes(query) || name.includes(query) || aria.includes(query) || id.includes(query)
              }) || null
            }

            if (!inputEl && allInputs.length > 0) {
              inputEl = allInputs[0]
            }
          }
        }

        if (!inputEl) {
          return { success: false, error: 'No editable input field found on this page.' }
        }

        inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
        inputEl.focus()

        // Set value
        inputEl.value = args.value
        inputEl.dispatchEvent(new Event('input', { bubbles: true }))
        inputEl.dispatchEvent(new Event('change', { bubbles: true }))

        const actionName = args.value === '' ? 'Cleared' : `Entered "${args.value}" into`
        const fieldName = inputEl.placeholder || inputEl.getAttribute('aria-label') || inputEl.name || 'input field'

        return {
          success: true,
          message: `${actionName} ${fieldName}.`
        }
      },
      args: [{ ...params, value: valueToFill }]
    })

    const response = result[0]?.result

    if (response?.success === false) {
      return { success: false, error: response.error }
    }

    return {
      success: true,
      result: response?.message || (valueToFill === '' ? 'Cleared the input.' : `Entered "${valueToFill}".`)
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'fillInput',
  description: 'Fills or clears a text input or textarea on the page with a specified value.',
  parameters: [
    {
      name: 'value',
      type: 'string',
      description: 'The text value to fill into the input (pass "" to clear the field)',
      required: false
    },
    {
      name: 'query',
      type: 'string',
      description: 'Description of the input (e.g. "search", "email", "username")',
      required: false
    },
    {
      name: 'index',
      type: 'number',
      description: 'The index of the input element (from findElements)',
      required: false
    }
  ],
  spokenLine: 'Entering text',
  examples: [
    'User: "type my email" → fillInput with query: "email", value: "user@example.com"',
    'User: "clear the search box" → fillInput with query: "search", value: ""',
    'User: "clear input" → fillInput with value: ""'
  ]
}

export default fillInput
