import type { ToolSpec } from '../tool-registry'

async function getPageTitle(params: any) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab) {
      return { success: false, error: 'No active tab found' }
    }

    let title = tab.title || ''
    const url = tab.url || ''

    if (!title && tab.id) {
      try {
        const result = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => document.title
        })
        title = result[0]?.result || ''
      } catch {}
    }

    const finalTitle = title || 'Untitled page'
    let domain = ''
    try {
      if (url.startsWith('http')) {
        domain = new URL(url).hostname
      }
    } catch {}

    const detail = domain ? `"${finalTitle}" on ${domain} (${url})` : (url ? `"${finalTitle}" (${url})` : `"${finalTitle}"`)

    return { 
      success: true, 
      result: `Current active page: ${detail}` 
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'getPageTitle',
  description: 'Gets the title and URL of the current active browser tab',
  parameters: [],
  spokenLine: "Checking current page",
  examples: [
    'User: "what\'s the page title" → getPageTitle',
    'User: "what page is this" → getPageTitle',
    'User: "is this page" → getPageTitle',
    'User: "what page am I on" → getPageTitle'
  ]
}

export default getPageTitle
