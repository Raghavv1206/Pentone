// dismissModal tool - Dismisses popups, overlays, dialogs, and cookie consent banners
import type { ToolSpec } from '../tool-registry'

interface DismissModalParams {
  type?: 'any' | 'cookie' | 'popup' | 'overlay'
}

async function dismissModal(params?: DismissModalParams) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (reqType: string) => {
        let dismissed = false
        let actionTaken = ''

        // Strategy 1: High-priority cookie consent buttons
        const cookieSelectors = [
          '#onetrust-accept-btn-handler',
          '#accept-recommended-btn-handler',
          '#onetrust-reject-all-handler',
          '.cc-accept',
          '.cookie-accept',
          '.osano-cm-accept-all',
          '.cmp-accept-btn',
          'button[id*="cookie" i][id*="accept" i]',
          'button[class*="cookie" i][class*="accept" i]',
          'button[id*="consent" i][id*="accept" i]',
          'button[class*="consent" i][class*="accept" i]',
          'a[class*="cookie" i][class*="accept" i]'
        ]

        for (const sel of cookieSelectors) {
          const btn = document.querySelector(sel) as HTMLElement
          if (btn && btn.offsetParent !== null) {
            btn.click()
            return { dismissed: true, method: 'cookie_selector', detail: sel }
          }
        }

        // Strategy 2: Button text scan for cookie consent and dismissals
        const buttons = Array.from(document.querySelectorAll('button, [role="button"], a.btn, input[type="button"], input[type="submit"]')) as HTMLElement[]
        const acceptPatterns = /^(accept\s+all(\s+cookies)?|allow\s+all(\s+cookies)?|accept\s+cookies?|agree\s*(&\s*continue)?|i\s+agree|i\s+accept|got\s+it|understand|allow\s+cookies?)$/i
        const dismissPatterns = /^(close|dismiss|no\s+thanks|not\s+now|maybe\s+later|skip|decline|reject\s+all|continue\s+without\s+accepting)$/i

        for (const btn of buttons) {
          if (btn.offsetParent === null) continue
          const text = (btn.innerText || btn.textContent || '').trim().replace(/\s+/g, ' ')
          if (acceptPatterns.test(text)) {
            btn.click()
            return { dismissed: true, method: 'consent_button_text', detail: text }
          }
        }

        // Strategy 3: Modal dialog close buttons
        const modalContainers = Array.from(document.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"], .modal.show, .modal.in, .popup.active, .overlay, [class*="modal" i]:not([style*="display: none"]), [class*="popup" i]:not([style*="display: none"])')) as HTMLElement[]
        
        for (const modal of modalContainers) {
          if (modal.offsetParent === null) continue
          const closeBtn = modal.querySelector('button[aria-label*="close" i], button[title*="close" i], [aria-label*="dismiss" i], .close, .modal-close, .btn-close, [class*="close-btn" i], svg') as HTMLElement
          if (closeBtn) {
            const clickTarget = (closeBtn.closest('button, [role="button"]') || closeBtn) as HTMLElement
            clickTarget.click()
            return { dismissed: true, method: 'modal_close_button', detail: 'Modal close button clicked' }
          }
        }

        // Strategy 4: Generic dismiss / "No thanks" / "Not now" button scan
        for (const btn of buttons) {
          if (btn.offsetParent === null) continue
          const text = (btn.innerText || btn.textContent || '').trim().replace(/\s+/g, ' ')
          if (dismissPatterns.test(text)) {
            btn.click()
            return { dismissed: true, method: 'dismiss_button_text', detail: text }
          }
        }

        // Strategy 5: Close buttons with aria-label="Close" anywhere on the page
        const closeAria = document.querySelector('button[aria-label="Close" i], button[aria-label="close" i], [title="Close" i]') as HTMLElement
        if (closeAria && closeAria.offsetParent !== null) {
          closeAria.click()
          return { dismissed: true, method: 'aria_close', detail: 'Closed via aria-label' }
        }

        // Strategy 6: Dispatched Escape key
        const escEvent = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true })
        document.dispatchEvent(escEvent)
        window.dispatchEvent(escEvent)

        return { dismissed: true, method: 'escape_key', detail: 'Dispatched Escape key event' }
      },
      args: [params?.type || 'any']
    })

    const res = injectionResults?.[0]?.result
    if (res?.dismissed) {
      return { success: true, result: `Successfully dismissed popup/modal (${res.method}).` }
    }

    return { success: false, error: 'No dismissable popup, banner, or modal was found.' }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'dismissModal',
  description: 'Dismisses open modals, popups, cookie consent banners, newsletter prompts, or subscription dialogs on the active page.',
  parameters: [
    {
      name: 'type',
      type: 'string',
      description: 'Optional filter: "any", "cookie", "popup", or "overlay"',
      required: false
    }
  ],
  spokenLine: 'Dismissing popup',
  examples: [
    'User: "close popup" → dismissModal',
    'User: "accept cookies" → dismissModal with type: "cookie"',
    'User: "dismiss banner" → dismissModal',
    'User: "close this modal" → dismissModal'
  ]
}

export default dismissModal
