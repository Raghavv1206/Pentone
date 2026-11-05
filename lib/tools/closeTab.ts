import type { ToolSpec } from '../tool-registry'

interface CloseTabParams {
  index?: number | string
  id?: number | string
  query?: string
  current?: boolean
}

async function closeTab(params: CloseTabParams = {}, context?: string) {
  try {
    let targetTabId: number | undefined
    let targetTabTitle = 'tab'

    // Case 1: Specific tab index provided
    if (params.index !== undefined) {
      const idx = typeof params.index === 'string' ? parseInt(params.index, 10) : params.index
      const tabs = await chrome.tabs.query({ currentWindow: true })
      if (!isNaN(idx) && idx >= 0 && idx < tabs.length && tabs[idx].id) {
        targetTabId = tabs[idx].id
        targetTabTitle = tabs[idx].title || `Tab #${idx}`
      } else {
        return {
          success: false,
          error: `Invalid tab index ${params.index}. Valid range: 0-${tabs.length - 1}`
        }
      }
    }
    // Case 2: Specific tab ID provided
    else if (params.id !== undefined) {
      const parsedId = typeof params.id === 'string' ? parseInt(params.id, 10) : params.id
      if (!isNaN(parsedId)) {
        try {
          const tab = await chrome.tabs.get(parsedId)
          targetTabId = tab.id
          targetTabTitle = tab.title || `Tab #${parsedId}`
        } catch {
          return { success: false, error: `Tab with ID ${parsedId} not found` }
        }
      }
    }
    // Case 3: Query string provided (e.g. "youtube", "gmail", title or domain match)
    else if (params.query && typeof params.query === 'string' && params.query.trim()) {
      const q = params.query.trim().toLowerCase()
      const tabs = await chrome.tabs.query({ currentWindow: true })
      const matchingTab = tabs.find(t => 
        (t.title && t.title.toLowerCase().includes(q)) || 
        (t.url && t.url.toLowerCase().includes(q))
      )
      if (matchingTab && matchingTab.id) {
        targetTabId = matchingTab.id
        targetTabTitle = matchingTab.title || q
      }
    }

    // Case 4: Default or current: true -> Close active tab in current/focused window
    if (!targetTabId) {
      const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true })
      const activeTab = activeTabs[0] || (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]
      if (activeTab && activeTab.id) {
        // Prevent closing internal extension sidepanel if run as standalone
        targetTabId = activeTab.id
        targetTabTitle = activeTab.title || 'Current tab'
      }
    }

    if (!targetTabId) {
      return { success: false, error: 'No active tab found to close' }
    }

    await chrome.tabs.remove(targetTabId)

    return {
      success: true,
      result: `Closed tab: "${targetTabTitle}"`
    }
  } catch (error: any) {
    return { success: false, error: error?.message || 'Failed to close tab' }
  }
}

export const spec: ToolSpec = {
  name: 'closeTab',
  description: 'Close the current browser tab, or a specific tab by title, domain, index, or ID',
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'Search string to find and close a specific tab by title or URL (e.g. "youtube")',
      required: false
    },
    {
      name: 'index',
      type: 'number',
      description: 'The 0-based index of the tab to close from getTabs',
      required: false
    },
    {
      name: 'id',
      type: 'number',
      description: 'The numeric tab ID to close',
      required: false
    },
    {
      name: 'current',
      type: 'boolean',
      description: 'Whether to close the currently active tab (defaults to true)',
      required: false
    }
  ],
  examples: [
    'User: "close this tab" → closeTab with current: true',
    'User: "close tab" → closeTab with current: true',
    'User: "close YouTube" → closeTab with query: "youtube"',
    'User: "close the first tab" → closeTab with index: 0'
  ],
  spokenLine: 'Closing tab'
}

export default closeTab
