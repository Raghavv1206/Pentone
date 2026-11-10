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

    if (params.value !== undefined && typeof params.value !== 'string') return { success: false, error: 'Value must be a string' }
    const valueToFill = params.value !== undefined ? params.value : ''

    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (args: { index?: number | string, query?: string, selector?: string, value: string }) => {
        const editable = (el: Element | null): el is HTMLElement => el instanceof HTMLElement &&
          !el.matches(':disabled, [readonly], input[type="hidden"], input[type="file"], input[type="button"], input[type="submit"], input[type="reset"], input[type="checkbox"], input[type="radio"]') &&
          (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable || el.getAttribute('contenteditable') === 'true')
        let inputEl: HTMLElement | null = null
        if (args.index !== undefined) {
          const idx = Number(args.index)
          if (!Number.isInteger(idx) || idx < 0) return { success: false, error: 'Invalid element index' }
          inputEl = document.querySelector(`[data-pentone-${idx}]`)
        } else if (args.selector) {
          inputEl = document.querySelector(args.selector)
        } else if (args.query?.trim()) {
          const query = args.query.trim().toLowerCase()
          const candidates = Array.from(document.querySelectorAll<HTMLElement>('input, textarea, [contenteditable="true"]')).filter(editable)
          inputEl = candidates.find(el => [el.id, el.getAttribute('name'), el.getAttribute('placeholder'), el.getAttribute('aria-label'),
            (el as HTMLInputElement).labels?.[0]?.textContent].some(text => text?.toLowerCase().includes(query))) || null
        } else if (editable(document.activeElement)) {
          inputEl = document.activeElement
        } else {
          const candidates = Array.from(document.querySelectorAll<HTMLElement>('input, textarea, [contenteditable="true"]')).filter(editable)
          if (candidates.length === 1) inputEl = candidates[0]
        }
        if (!editable(inputEl)) return { success: false, error: 'Requested editable field was not found. Select a field explicitly.' }
        inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
        inputEl.focus()
        if (inputEl instanceof HTMLInputElement || inputEl instanceof HTMLTextAreaElement) {
          const prototype = inputEl instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
          Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(inputEl, args.value)
          if (inputEl.value !== args.value) return { success: false, error: 'The field rejected this value' }
        } else {
          inputEl.textContent = args.value
        }
        inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
        inputEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
        return { success: true, message: args.value === '' ? 'Cleared the selected field.' : 'Filled the selected field.' }
      },
      args: [{ ...params, value: valueToFill }]
    })

    const response = result[0]?.result

    if (!response?.success) {
      return { success: false, error: response?.error || 'Input injection returned no result' }
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
