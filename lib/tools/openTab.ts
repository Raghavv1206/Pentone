import type { ToolSpec } from '../tool-types'
import { validateAndSanitizeUrl } from '../url-validator'

async function openTab(params: { url: string; tabName?: string }, context?: string) {
  try {
    // Refuse to open tabs from popup context as it would close the popup
    if (context === 'popup') {
      return { 
        success: false, 
        error: 'STOP: Cannot open tabs from popup window. Please ask the user to open Pentone in the side panel by clicking the maximize icon in the top right. Do NOT continue with the task or try other tools - just tell the user this and wait.' 
      }
    }
    
    if (!params.url || typeof params.url !== 'string') {
      return { success: false, error: 'URL is required and must be a string' }
    }

    // Security validation against dangerous schemes (javascript:, data:, file:, internal chrome pages)
    const sanitized = validateAndSanitizeUrl(params.url)
    if (!sanitized.valid || !sanitized.url) {
      return { success: false, error: `Navigation security error: ${sanitized.error}` }
    }

    const tab = await chrome.tabs.create({ url: sanitized.url })
    const label = params.tabName ? ` "${params.tabName}"` : ''
    
    return { 
      success: true, 
      tabId: tab.id,
      url: sanitized.url,
      result: `Opened${label} ${sanitized.url} in new tab (ID: ${tab.id})` 
    }
  } catch (error: any) {
    return { success: false, error: error?.message || 'Failed to open tab' }
  }
}

export const spec: ToolSpec = {
  name: 'openTab',
  description: 'Opens a URL in a new browser tab. Use this to navigate directly to websites or URLs (must start with http:// or https://), or execute direct search queries on YouTube or Google.',
  parameters: [
    {
      name: 'url',
      type: 'string',
      description: 'The full URL to open (must include http:// or https://)',
      required: true
    },
    {
      name: 'tabName',
      type: 'string',
      description: 'Optional friendly title or name of the tab to open',
      required: false
    },
    {
      name: 'tabId',
      type: 'number',
      description: 'Optional source tab identifier (ignored when creating a new tab)',
      required: false
    }
  ],
  spokenLine: "Opening {url}",
  examples: [
    'User: "open youtube" → openTab with url: "https://www.youtube.com"',
    'User: "open youtube and search for react" → openTab with url: "https://www.youtube.com/results?search_query=react"',
    'User: "open google and search for ai tools" → openTab with url: "https://www.google.com/search?q=ai+tools"'
  ]
}

export default openTab
