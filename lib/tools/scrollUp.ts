// scrollUp tool - Scroll the current page up or jump directly to the top
import type { ToolSpec } from '../tool-registry'

interface ScrollUpParams {
  to?: 'top'
  amount?: number
}

async function scrollUp(params?: ScrollUpParams) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    const scrollToTop = params?.to === 'top'
    const customAmount = typeof params?.amount === 'number' ? params.amount : 500

    // Execute scroll in content script
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (toTop: boolean, amount: number) => {
        if (toTop) {
          window.scrollTo({
            top: 0,
            behavior: 'smooth'
          })
        } else {
          window.scrollBy({
            top: -amount,
            behavior: 'smooth'
          })
        }
      },
      args: [scrollToTop, customAmount]
    })

    return {
      success: true,
      result: scrollToTop ? 'Scrolled to top of page' : 'Scrolled up'
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'scrollUp',
  description: 'Scrolls the current page up by a fixed amount or jumps directly to the very top when to is "top". Note: Does NOT work on video feed sites like TikTok, Instagram Reels, or YouTube Shorts - use pressKey with "ArrowUp" instead for those.',
  parameters: [
    {
      name: 'to',
      type: 'string',
      description: 'Set to "top" to scroll all the way to the top of the page',
      required: false
    },
    {
      name: 'amount',
      type: 'number',
      description: 'Custom pixel amount to scroll up (defaults to 500)',
      required: false
    }
  ],
  examples: [
    'User: "scroll up" → scrollUp',
    'User: "scroll to top" → scrollUp with to: "top"',
    'User: "go to top of page" → scrollUp with to: "top"',
    'User: "move up on the page" → scrollUp',
    'User on Instagram Reels: "go back" → Use pressKey with key: "ArrowUp" instead'
  ],
  spokenLine: 'Scrolling up'
}

export default scrollUp
