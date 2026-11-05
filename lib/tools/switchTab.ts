import type { ToolSpec } from '../tool-registry'

async function switchTab(params: { index?: number | string; id?: number | string }, context?: string) {
  try {
    let tabId: number | undefined
    
    // If index is provided, find the tab by index
    if (params.index !== undefined) {
      const idx = typeof params.index === 'string' ? parseInt(params.index, 10) : params.index
      const tabs = await chrome.tabs.query({ currentWindow: true })
      
      if (isNaN(idx) || idx < 0 || idx >= tabs.length) {
        return { 
          success: false, 
          error: `Invalid tab index ${params.index}. Valid range: 0-${tabs.length - 1}` 
        }
      }
      
      tabId = tabs[idx].id
    } 
    // Otherwise use the provided tab ID
    else if (params.id !== undefined) {
      const parsedId = typeof params.id === 'string' ? parseInt(params.id, 10) : params.id;
      tabId = isNaN(parsedId) ? undefined : parsedId
    } 
    else {
      return { success: false, error: 'Either index or id parameter is required' }
    }
    
    if (!tabId) {
      return { success: false, error: 'Tab not found' }
    }
    
    // Switch to the tab
    await chrome.tabs.update(tabId, { active: true })
    
    // Get the tab info for confirmation
    const tab = await chrome.tabs.get(tabId)
    
    return {
      success: true,
      result: `Switched to tab: "${tab.title}"`
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'switchTab',
  description: 'Switch to a different browser tab by its index or ID',
  parameters: [
    {
      name: 'index',
      type: 'number',
      description: 'The tab index from getTabs (0-based)',
      required: false
    },
    {
      name: 'id',
      type: 'number',
      description: 'The tab ID (use index instead for easier switching)',
      required: false
    }
  ],
  examples: [
    'After getTabs shows "[2] Gmail" → switchTab with index: 2',
    'User: "go back to the first tab" → switchTab with index: 0',
    'User: "switch to Gmail" → First getTabs to find index, then switchTab',
    'User: "go to the Vercel tab" → First getTabs to find index, then switchTab'
  ],
  spokenLine: 'Switching to tab'
}

export default switchTab

