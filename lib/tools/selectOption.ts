// selectOption tool - Selects an option in a dropdown menu, <select> element, or combobox
import type { ToolSpec } from '../tool-registry'

interface SelectOptionParams {
  query?: string
  value?: string
  selector?: string
  index?: number
}

async function selectOption(params: SelectOptionParams) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (queryText?: string, val?: string, cssSelector?: string, optIndex?: number) => {
        // Strategy 1: Native <select> elements
        let selectElements: HTMLSelectElement[] = []
        if (cssSelector) {
          const el = document.querySelector(cssSelector)
          if (!(el instanceof HTMLSelectElement)) return { selected: false, error: 'Requested dropdown was not found' }
          if (el instanceof HTMLSelectElement) {
            selectElements = [el]
          }
        }
        if (selectElements.length === 0) {
          selectElements = Array.from(document.querySelectorAll('select'))
        }

        const lowerQuery = (queryText || '').toLowerCase().trim()

        for (const select of selectElements) {
          if (select.disabled) continue
          const options = Array.from(select.options)
          let matchIndex = -1

          if (Number.isInteger(optIndex) && optIndex! >= 0 && optIndex < options.length) {
            matchIndex = optIndex
          } else if (val) {
            matchIndex = options.findIndex(o => o.value.toLowerCase() === val.toLowerCase())
          } else if (lowerQuery) {
            // First check exact text
            matchIndex = options.findIndex(o => o.text.toLowerCase().trim() === lowerQuery)
            // Then check substring
            if (matchIndex === -1) {
              matchIndex = options.findIndex(o => o.text.toLowerCase().includes(lowerQuery) || o.value.toLowerCase().includes(lowerQuery))
            }
          }

          if (matchIndex !== -1 && !options[matchIndex].disabled) {
            select.selectedIndex = matchIndex
            const chosen = options[matchIndex]
            select.value = chosen.value

            select.dispatchEvent(new Event('input', { bubbles: true }))
            select.dispatchEvent(new Event('change', { bubbles: true }))

            return {
              selected: true,
              type: 'native_select',
              text: chosen.text.trim(),
              value: chosen.value
            }
          }
        }

        // Strategy 2: Custom ARIA combobox / listbox options
        if (lowerQuery) {
          const customOptions = Array.from(
            document.querySelectorAll('[role="option"], [role="menuitem"], li[data-value], .select-option, .dropdown-item')
          ) as HTMLElement[]

          for (const opt of customOptions) {
            const text = (opt.innerText || opt.textContent || '').toLowerCase().trim()
            if (text === lowerQuery || text.includes(lowerQuery)) {
              opt.click()
              return {
                selected: true,
                type: 'custom_option',
                text: opt.innerText.trim()
              }
            }
          }
        }

        return { selected: false, error: 'Matching option or dropdown was not found' }
      },
      args: [params?.query || '', params?.value || '', params?.selector || '', params?.index ?? null]
    })

    const res = injectionResults?.[0]?.result
    if (res?.selected) {
      return {
        success: true,
        result: `Selected "${res.text}" in dropdown.`
      }
    }

    return {
      success: false,
      error: res?.error || 'Could not find the dropdown option.'
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'selectOption',
  description: 'Selects an option in a <select> dropdown, form selector, or custom combobox menu by text, value, or index.',
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'The visible label or text of the option to select (e.g. "California", "English", "Option 2")',
      required: false
    },
    {
      name: 'value',
      type: 'string',
      description: 'The value attribute of the option if known',
      required: false
    },
    {
      name: 'selector',
      type: 'string',
      description: 'Optional CSS selector of the <select> element',
      required: false
    },
    {
      name: 'index',
      type: 'number',
      description: 'The 0-based index of the option to select',
      required: false
    }
  ],
  spokenLine: 'Selecting dropdown option',
  examples: [
    'User: "select California in the state dropdown" → selectOption with query: "California"',
    'User: "choose English" → selectOption with query: "English"',
    'User: "select the second option" → selectOption with index: 1'
  ]
}

export default selectOption
