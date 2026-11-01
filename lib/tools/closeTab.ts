import type { ToolSpec } from '../tool-types'

async function closeTab(params?: { index?: number; id?: number; closeActive?: boolean }) {
  try {
    let targetTabId: number | undefined = params?.id

    if (params?.index !== undefined && targetTabId === undefined) {
      const tabs = await chrome.tabs.query({ currentWindow: true })
      if (params.index < 0 || params.index >= tabs.length) {
        return {
          success: false,
          error: `Invalid tab index ${params.index}. Valid range: 0-${tabs.length - 1}`
        }
      }
      targetTabId = tabs[params.index].id
    }

    if (!targetTabId) {
      // Prevent silently closing whichever tab is active if request was ambiguous
      if (params?.closeActive !== true && params?.index === undefined && params?.id === undefined) {
        return {
          success: false,
          error: 'Ambiguous target tab: please provide a tab index, tab ID, or set closeActive: true to close the active tab.'
        }
      }

      // Explicitly close currently active tab in current window
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!activeTab?.id) {
        return { success: false, error: 'No active tab found to close' }
      }
      targetTabId = activeTab.id
    }

    const tabInfo = await chrome.tabs.get(targetTabId).catch(() => null)
    const title = tabInfo?.title || `Tab ${targetTabId}`

    await chrome.tabs.remove(targetTabId)

    return {
      success: true,
      result: `Closed tab: "${title}"`
    }
  } catch (error: any) {
    return { success: false, error: error?.message || 'Failed to close tab' }
  }
}

export const spec: ToolSpec = {
  name: 'closeTab',
  description: 'Closes a browser tab by its index, tab ID, or explicitly closing the active tab.',
  parameters: [
    {
      name: 'index',
      type: 'number',
      description: 'The tab index from getTabs to close (0-based)',
      required: false
    },
    {
      name: 'id',
      type: 'number',
      description: 'The exact tab ID to close',
      required: false
    },
    {
      name: 'closeActive',
      type: 'boolean',
      description: 'Set to true when explicitly confirming to close the currently active tab',
      required: false
    }
  ],
  examples: [
    'User: "close this tab" → closeTab with closeActive: true',
    'User: "close tab 2" → closeTab with index: 2'
  ],
  spokenLine: 'Closing tab'
}

export default closeTab
