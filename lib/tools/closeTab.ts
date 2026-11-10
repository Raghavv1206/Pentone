import type { ToolSpec } from '../tool-registry'

interface CloseTabParams {
  all?: boolean
  other?: boolean
  index?: number | string
  id?: number | string
  query?: string
  current?: boolean
}

async function closeTab(params: CloseTabParams = {}, context?: string) {
  try {
    // Case 1: Close all tabs in the current window
    if (params.all) {
      const tabs = await chrome.tabs.query({ currentWindow: true })
      // Open a fresh blank tab so the browser window and Pentone sidepanel stay open
      const newTab = await chrome.tabs.create({ active: true })
      const idsToRemove = tabs
        .map(t => t.id)
        .filter((id): id is number => typeof id === 'number' && id !== newTab.id)

      if (idsToRemove.length > 0) {
        await chrome.tabs.remove(idsToRemove)
      }
      return {
        success: true,
        result: `Closed all ${idsToRemove.length} tabs.`
      }
    }

    // Case 2: Close other tabs (keep currently active tab)
    if (params.other) {
      const tabs = await chrome.tabs.query({ currentWindow: true })
      const idsToRemove = tabs
        .filter(t => !t.active && typeof t.id === 'number')
        .map(t => t.id!)

      if (idsToRemove.length > 0) {
        await chrome.tabs.remove(idsToRemove)
        return {
          success: true,
          result: `Closed ${idsToRemove.length} other tabs.`
        }
      } else {
        return {
          success: true,
          result: 'No other tabs to close.'
        }
      }
    }

    let targetTabId: number | undefined
    let targetTabTitle = 'tab'

    // Case 3: Specific tab index provided
    if (params.index !== undefined) {
      const idx = typeof params.index === 'string' ? Number(params.index) : params.index
      const tabs = await chrome.tabs.query({ currentWindow: true })
      if (Number.isInteger(idx) && idx >= 0 && idx < tabs.length && tabs[idx].id) {
        targetTabId = tabs[idx].id
        targetTabTitle = tabs[idx].title || `Tab #${idx}`
      } else {
        return {
          success: false,
          error: `Invalid tab index ${params.index}. Valid range: 0-${tabs.length - 1}`
        }
      }
    }
    // Case 4: Specific tab ID provided
    else if (params.id !== undefined) {
      const parsedId = typeof params.id === 'string' ? Number(params.id) : params.id
      if (!Number.isInteger(parsedId) || parsedId < 0) return { success: false, error: 'Invalid tab ID' }
      if (Number.isInteger(parsedId)) {
        try {
          const tab = await chrome.tabs.get(parsedId)
          targetTabId = tab.id
          targetTabTitle = tab.title || `Tab #${parsedId}`
        } catch {
          return { success: false, error: `Tab with ID ${parsedId} not found` }
        }
      }
    }
    // Case 5: Query string provided (e.g. "youtube", "gmail", title or domain match)
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
      } else {
        return { success: false, error: `No tab matches "${params.query}"` }
      }
    }

    // Case 6: Default or current: true -> Close active tab in current/focused window
    if (!targetTabId && params.query !== undefined) return { success: false, error: 'A nonempty tab query is required' }
    if (!targetTabId) {
      const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true })
      const activeTab = activeTabs[0] || (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]
      if (activeTab && activeTab.id) {
        targetTabId = activeTab.id
        targetTabTitle = activeTab.title || 'Current tab'
      }
    }

    if (!targetTabId) {
      return { success: false, error: 'No active tab found to close' }
    }

    // Prevent closing the entire browser window if this is the only tab open
    const windowTabs = await chrome.tabs.query({ currentWindow: true })
    if (windowTabs.length <= 1) {
      await chrome.tabs.create({ active: true })
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
  description: 'Close the current browser tab, all tabs, other tabs, or a specific tab by title, domain, index, or ID',
  parameters: [
    {
      name: 'all',
      type: 'boolean',
      description: 'Whether to close all open tabs in the current window (opens a fresh tab so the window stays open)',
      required: false
    },
    {
      name: 'other',
      type: 'boolean',
      description: 'Whether to close all tabs other than the currently active tab',
      required: false
    },
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
    'User: "close all tabs" → closeTab with all: true',
    'User: "close other tabs" → closeTab with other: true',
    'User: "close this tab" → closeTab with current: true',
    'User: "close tab" → closeTab with current: true',
    'User: "close YouTube" → closeTab with query: "youtube"',
    'User: "close the first tab" → closeTab with index: 0'
  ],
  spokenLine: 'Closing tab'
}

export default closeTab
