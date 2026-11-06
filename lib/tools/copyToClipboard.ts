// copyToClipboard tool - Copies page URL, page title, selected text, or custom content to clipboard
import type { ToolSpec } from '../tool-registry'

interface CopyToClipboardParams {
  text?: string
  type?: 'url' | 'title' | 'title_and_url' | 'text' | 'selection'
}

async function copyToClipboard(params?: CopyToClipboardParams) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    let textToCopy = params?.text || ''
    const copyType = params?.type || (textToCopy ? 'text' : 'url')

    if (copyType === 'url') {
      textToCopy = tab.url || ''
    } else if (copyType === 'title') {
      textToCopy = tab.title || ''
    } else if (copyType === 'title_and_url') {
      textToCopy = `${tab.title || ''} (${tab.url || ''})`.trim()
    }

    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (explicitText: string, reqType: string) => {
        let content = explicitText
        if (reqType === 'selection' || (!content && reqType === 'text')) {
          content = window.getSelection()?.toString() || ''
        }

        if (!content) {
          content = window.location.href
        }

        try {
          await navigator.clipboard.writeText(content)
          return { copied: true, text: content }
        } catch {
          // Fallback via textarea execCommand
          const ta = document.createElement('textarea')
          ta.value = content
          ta.style.position = 'fixed'
          ta.style.opacity = '0'
          document.body.appendChild(ta)
          ta.select()
          const success = document.execCommand('copy')
          document.body.removeChild(ta)
          return { copied: success, text: content }
        }
      },
      args: [textToCopy, copyType]
    })

    const res = injectionResults?.[0]?.result
    if (res?.copied) {
      const preview = res.text.length > 60 ? res.text.substring(0, 57) + '...' : res.text
      return {
        success: true,
        result: `Copied to clipboard: "${preview}".`
      }
    }

    return { success: false, error: 'Could not copy to clipboard.' }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'copyToClipboard',
  description: 'Copies content to clipboard: page URL ("url"), page title ("title"), currently highlighted text ("selection"), or custom text.',
  parameters: [
    {
      name: 'type',
      type: 'string',
      description: 'The type of content to copy: "url", "title", "title_and_url", "selection", or "text"',
      required: false
    },
    {
      name: 'text',
      type: 'string',
      description: 'Custom text to copy (optional)',
      required: false
    }
  ],
  spokenLine: 'Copying to clipboard',
  examples: [
    'User: "copy page url" → copyToClipboard with type: "url"',
    'User: "copy link" → copyToClipboard with type: "url"',
    'User: "copy current url" → copyToClipboard with type: "url"',
    'User: "copy title and url" → copyToClipboard with type: "title_and_url"',
    'User: "copy selected text" → copyToClipboard with type: "selection"'
  ]
}

export default copyToClipboard
