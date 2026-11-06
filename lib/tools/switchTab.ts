import type { ToolSpec } from '../tool-registry'

interface SwitchTabParams {
  index?: number | string
  id?: number | string
  query?: string
}

async function switchTab(params: SwitchTabParams = {}, context?: string) {
  try {
    let tabId: number | undefined
    let tabTitle = 'tab'
    
    // Case 1: Query string provided (e.g. "youtube", "gmail", title or domain match)
    if (params.query && typeof params.query === 'string' && params.query.trim()) {
      const q = params.query.trim().toLowerCase()
      const tabs = await chrome.tabs.query({ currentWindow: true })
      const matchingTab = tabs.find(t => 
        (t.title && t.title.toLowerCase().includes(q)) || 
        (t.url && t.url.toLowerCase().includes(q))
      )
      if (matchingTab && matchingTab.id) {
        tabId = matchingTab.id
        tabTitle = matchingTab.title || q
      } else {
        return { success: false, error: `No open tab matching "${params.query}" found` }
      }
    }
    // Case 2: If index is provided, find the tab by index
    else if (params.index !== undefined) {
      const idx = typeof params.index === 'string' ? parseInt(params.index, 10) : params.index
      const tabs = await chrome.tabs.query({ currentWindow: true })
      
      if (isNaN(idx) || idx < 0 || idx >= tabs.length) {
        return { 
          success: false, 
          error: `Invalid tab index ${params.index}. Valid range: 0-${tabs.length - 1}` 
        }
      }
      
      tabId = tabs[idx].id
      tabTitle = tabs[idx].title || `Tab #${idx}`
    } 
    // Case 3: Otherwise use the provided tab ID
    else if (params.id !== undefined) {
      const parsedId = typeof params.id === 'string' ? parseInt(params.id, 10) : params.id
      tabId = isNaN(parsedId) ? undefined : parsedId
    } 
    else {
      return { success: false, error: 'Either query, index, or id parameter is required' }
    }
    
    if (!tabId) {
      return { success: false, error: 'Tab not found' }
    }
    
    // Switch to the tab
    await chrome.tabs.update(tabId, { active: true })
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({
        pentone_selected: true,
        pentone_sidepanel_open: true,
        pentone_selected_timestamp: Date.now()
      }).catch(() => {})
    }
    
    // Get the tab info for confirmation if title not yet resolved
    if (tabTitle === 'tab') {
      try {
        const tab = await chrome.tabs.get(tabId)
        tabTitle = tab.title || 'tab'
      } catch {}
    }
    
    return {
      success: true,
      result: `Switched to tab: "${tabTitle}"`
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'switchTab',
  description: 'Switch to a different browser tab by title search, index, or ID',
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'Search string to find and switch to a specific tab by title or URL (e.g. "youtube", "gmail")',
      required: false
    },
    {
      name: 'index',
      type: 'number',
      description: 'The tab index from getTabs (0-based)',
      required: false
    },
    {
      name: 'id',
      type: 'number',
      description: 'The numeric tab ID to switch to',
      required: false
    }
  ],
  examples: [
    'User: "switch to YouTube" → switchTab with query: "youtube"',
    'User: "switch to tab 2" → switchTab with index: 2',
    'User: "go back to the first tab" → switchTab with index: 0',
    'After getTabs shows "[2] Gmail" → switchTab with index: 2'
  ],
  spokenLine: 'Switching to tab'
}

export default switchTab
