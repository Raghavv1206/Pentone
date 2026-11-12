import type { ToolSpec } from '../tool-registry'

export interface SwitchTabParams {
  index?: number | string
  id?: number | string
  query?: string
  action?: 'previous' | 'next' | 'first' | 'last'
  direction?: 'previous' | 'next'
}

async function switchTab(params: SwitchTabParams = {}, context?: string) {
  try {
    let tabId: number | undefined
    let tabTitle = 'tab'
    
    const tabs = await chrome.tabs.query({ currentWindow: true })
    if (!tabs || tabs.length === 0) {
      return { success: false, error: 'No open tabs found' }
    }

    const isPrevious = 
      params.action === 'previous' || 
      params.direction === 'previous' || 
      (typeof params.query === 'string' && /^(?:previous|prev|last|pichla|pichle|back)\s*(?:tab)?$/i.test(params.query.trim()))

    const isNext = 
      params.action === 'next' || 
      params.direction === 'next' || 
      (typeof params.query === 'string' && /^(?:next|agla|agle|forward)\s*(?:tab)?$/i.test(params.query.trim()))

    const isFirst = 
      params.action === 'first' || 
      (typeof params.query === 'string' && /^(?:first|pehla|initial)\s*(?:tab)?$/i.test(params.query.trim()))

    const isLast = 
      params.action === 'last' && !isPrevious

    // Case 0A: Previous tab (MRU history with left-adjacent fallback)
    if (isPrevious) {
      const activeTab = tabs.find(t => t.active)
      let candidateId: number | undefined

      try {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          const stored = await chrome.storage.local.get(['pentone_previous_tab_id', 'pentone_tab_history'])
          const prevId = stored?.pentone_previous_tab_id
          const history: number[] = Array.isArray(stored?.pentone_tab_history) ? stored.pentone_tab_history : []

          if (prevId && prevId !== activeTab?.id && tabs.some(t => t.id === prevId)) {
            candidateId = prevId
          } else {
            for (const hid of history) {
              if (hid !== activeTab?.id && tabs.some(t => t.id === hid)) {
                candidateId = hid
                break
              }
            }
          }
        }
      } catch {}

      if (!candidateId) {
        if (activeTab && typeof activeTab.index === 'number') {
          const targetIdx = activeTab.index > 0 ? activeTab.index - 1 : (tabs.length > 1 ? tabs.length - 1 : 0)
          candidateId = tabs[targetIdx]?.id
        } else if (tabs.length > 0) {
          candidateId = tabs[0].id
        }
      }

      if (candidateId) {
        tabId = candidateId
        const match = tabs.find(t => t.id === tabId)
        tabTitle = match?.title || 'previous tab'
      } else {
        return { success: false, error: 'No previous tab available' }
      }
    }
    // Case 0B: Next tab
    else if (isNext) {
      const activeTab = tabs.find(t => t.active)
      const curIdx = activeTab?.index ?? 0
      const targetIdx = curIdx < tabs.length - 1 ? curIdx + 1 : 0
      tabId = tabs[targetIdx]?.id
      tabTitle = tabs[targetIdx]?.title || 'next tab'
    }
    // Case 0C: First tab
    else if (isFirst) {
      tabId = tabs[0]?.id
      tabTitle = tabs[0]?.title || 'first tab'
    }
    // Case 0D: Last tab
    else if (isLast) {
      const lastTab = tabs[tabs.length - 1]
      tabId = lastTab?.id
      tabTitle = lastTab?.title || 'last tab'
    }
    // Case 1: Query string provided (e.g. "youtube", "gmail", title or domain match)
    else if (params.query && typeof params.query === 'string' && params.query.trim()) {
      const q = params.query.trim().toLowerCase()
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
      return { success: false, error: 'Either query, index, id, or action parameter is required' }
    }
    
    if (!tabId) {
      return { success: false, error: 'Tab not found' }
    }
    
    const activeTab = tabs.find(t => t.active)

    // Switch to the tab
    await chrome.tabs.update(tabId, { active: true })
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      if (activeTab?.id && activeTab.id !== tabId) {
        await chrome.storage.local.set({
          pentone_previous_tab_id: activeTab.id
        }).catch(() => {})
      }
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
      result: isPrevious 
        ? `Switched to previous tab: "${tabTitle}"` 
        : isNext 
          ? `Switched to next tab: "${tabTitle}"` 
          : `Switched to tab: "${tabTitle}"`
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'switchTab',
  description: 'Switch to a different browser tab by title search, index, ID, or directional navigation (previous/next)',
  parameters: [
    {
      name: 'action',
      type: 'string',
      description: 'Directional tab switch action: "previous", "next", "first", or "last"',
      required: false
    },
    {
      name: 'direction',
      type: 'string',
      description: 'Direction to switch tabs: "previous" or "next"',
      required: false
    },
    {
      name: 'query',
      type: 'string',
      description: 'Search string to find and switch to a specific tab by title or URL (e.g. "youtube", "gmail", "previous")',
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
    'User: "go to previous tab" → switchTab with action: "previous"',
    'User: "switch to next tab" → switchTab with action: "next"',
    'User: "switch to YouTube" → switchTab with query: "youtube"',
    'User: "switch to tab 2" → switchTab with index: 2',
    'User: "go back to the first tab" → switchTab with index: 0',
    'After getTabs shows "[2] Gmail" → switchTab with index: 2'
  ],
  spokenLine: 'Switching to tab'
}

export default switchTab
