// scrollDown tool - Scroll the current page down or jump directly to the bottom
import type { ToolSpec } from '../tool-registry'

interface ScrollDownParams {
  to?: 'bottom'
  amount?: number
}

async function scrollDown(params?: ScrollDownParams) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    const scrollToBottom = params?.to === 'bottom'
    const customAmount = typeof params?.amount === 'number' ? params.amount : 500

    // Execute scroll in content script
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (toBottom: boolean, amount: number) => {
        if (toBottom) {
          window.scrollTo({
            top: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
            behavior: 'smooth'
          })
        } else {
          window.scrollBy({
            top: amount,
            behavior: 'smooth'
          })
        }
      },
      args: [scrollToBottom, customAmount]
    })

    return {
      success: true,
      result: scrollToBottom ? 'Scrolled to bottom of page' : 'Scrolled down'
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'scrollDown',
  description: 'Scrolls the current page down by a fixed amount or jumps directly to the bottom when to is "bottom". Note: Does NOT work on video feed sites like TikTok, Instagram Reels, or YouTube Shorts - use pressKey with "ArrowDown" instead for those.',
  parameters: [
    {
      name: 'to',
      type: 'string',
      description: 'Set to "bottom" to scroll all the way to the bottom of the page',
      required: false
    },
    {
      name: 'amount',
      type: 'number',
      description: 'Custom pixel amount to scroll down (defaults to 500)',
      required: false
    }
  ],
  examples: [
    'User: "scroll down" → scrollDown',
    'User: "scroll to bottom" → scrollDown with to: "bottom"',
    'User: "go to bottom of page" → scrollDown with to: "bottom"',
    'User: "move down on the page" → scrollDown',
    'User on TikTok: "scroll down" → Use pressKey with key: "ArrowDown" instead'
  ],
  spokenLine: 'Scrolling down'
}

export default scrollDown
