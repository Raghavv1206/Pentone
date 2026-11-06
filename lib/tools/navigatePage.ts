// navigatePage tool - Controls browser navigation (back, forward, reload)
import type { ToolSpec } from '../tool-registry'

interface NavigateParams {
  action: 'back' | 'forward' | 'reload' | 'refresh'
}

async function navigatePage(params: NavigateParams) {
  try {
    const action = params.action?.toLowerCase() || 'back'

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({
        pentone_selected: true,
        pentone_sidepanel_open: true,
        pentone_selected_timestamp: Date.now()
      }).catch(() => {})
    }

    if (action === 'back') {
      try {
        await chrome.tabs.goBack(tab.id)
      } catch {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => window.history.back()
        })
      }
      return { success: true, result: 'Navigated back to previous page.' }
    }

    if (action === 'forward') {
      try {
        await chrome.tabs.goForward(tab.id)
      } catch {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => window.history.forward()
        })
      }
      return { success: true, result: 'Navigated forward to next page.' }
    }

    if (action === 'reload' || action === 'refresh') {
      try {
        await chrome.tabs.reload(tab.id)
      } catch {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => window.location.reload()
        })
      }
      return { success: true, result: 'Reloaded the page.' }
    }

    return { success: false, error: `Unknown navigation action: ${action}` }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'navigatePage',
  description: 'Navigates browser history or reloads the active tab: "back" to return to previous page, "forward" to go forward, "reload" to refresh.',
  parameters: [
    {
      name: 'action',
      type: 'string',
      description: 'The navigation action: "back", "forward", or "reload"',
      required: true
    }
  ],
  spokenLine: 'Navigating page',
  examples: [
    'User: "go back" → navigatePage with action: "back"',
    'User: "go to previous page" → navigatePage with action: "back"',
    'User: "go forward" → navigatePage with action: "forward"',
    'User: "refresh page" → navigatePage with action: "reload"'
  ]
}

export default navigatePage
