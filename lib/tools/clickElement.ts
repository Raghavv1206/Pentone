import type { ToolSpec } from '../tool-registry'

interface ClickParams {
  index?: number | string
  query?: string
  text?: string
  selector?: string
  ordinal?: number | string
}

async function clickElement(params: ClickParams) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:'))) {
      return { success: false, error: `Cannot click elements on internal browser pages (${tab.url.split('/')[2] || tab.url}). Please navigate to a standard website first.` }
    }

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({
        pentone_selected: true,
        pentone_sidepanel_open: true,
        pentone_selected_timestamp: Date.now()
      }).catch(() => {})
    }

    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (args: ClickParams) => {
        let element: HTMLElement | null = null

        // 1. Direct index lookup if [data-pentone-X] exists
        if (args.index !== undefined && args.index !== null) {
          const rawIdx = typeof args.index === 'string' ? parseInt(args.index, 10) : args.index
          if (!isNaN(rawIdx)) {
            element = document.querySelector(`[data-pentone-${rawIdx}]`) as HTMLElement
          }
        }

        // 2. Direct CSS selector
        if (!element && args.selector) {
          try {
            element = document.querySelector(args.selector) as HTMLElement
          } catch {}
        }

        // 3. Query or text lookup
        const query = (args.query || args.text || '').toLowerCase().trim()
        
        // Resolve target ordinal (0 for first, 1 for second, etc.)
        let targetOrdinal = 0
        if (args.ordinal !== undefined && args.ordinal !== null) {
          targetOrdinal = typeof args.ordinal === 'string' ? parseInt(args.ordinal, 10) : args.ordinal
          if (isNaN(targetOrdinal)) targetOrdinal = 0
        } else if (query) {
          if (/\b(?:first|1st|#1)\b/i.test(query)) targetOrdinal = 0
          else if (/\b(?:second|2nd|#2)\b/i.test(query)) targetOrdinal = 1
          else if (/\b(?:third|3rd|#3)\b/i.test(query)) targetOrdinal = 2
          else if (/\b(?:fourth|4th|#4)\b/i.test(query)) targetOrdinal = 3
          else if (/\b(?:fifth|5th|#5)\b/i.test(query)) targetOrdinal = 4
        }

        if (!element && (query || args.index !== undefined)) {
          const isYouTube = window.location.hostname.includes('youtube.com')
          const isSkipAd = /\b(?:skip\s*(?:the\s+)?ad|skip\s*ad|skip\s*this\s*ad|skip\s*ads|skip\s*video\s*ad|skip|close\s*ad)\b/i.test(query)
          const isMediaOrVideoQuery = (
            /\b(?:video|videos|song|songs|music|track|tracks|audio|canción|canciones|chanson|chansons|lied|lieder|canzone|canzoni|canção|canções|песня|песни|песню|музыка|музыку|曲|歌|गाने?|गाना|गीत|الأغاني|أغنية|اغنية|موسيقى)\b/i.test(query) ||
            (isYouTube && args.ordinal !== undefined)
          ) && !isSkipAd

          // A. Video Ad Skipping on YouTube or video sites
          if (isSkipAd) {
            const skipAdSelectors = [
              '.ytp-skip-ad-button',
              '.ytp-ad-skip-button-modern',
              '.ytp-ad-skip-button',
              'button.ytp-ad-skip-button-modern',
              'button.ytp-ad-skip-button',
              '.ytp-ad-skip-button-text',
              '.ytp-ad-skip-button-container button',
              '[id^="skip-button:"] button',
              '.ytp-ad-overlay-close-button',
              'button.ytp-ad-overlay-close-button',
              '.videoAdUiSkipButton',
              'button[aria-label*="Skip" i]',
              'button[aria-label*="skip" i]',
              '.ytp-ad-skip-button-slot button',
              'button:has(.ytp-ad-skip-button-icon)',
              '[class*="skip-button"]',
              '[aria-label*="Skip ad" i]',
              '[aria-label*="Skip video" i]',
              '.ytp-ad-text.ytp-ad-preview-text',
              'button.ytp-ad-button'
            ]

            for (const sel of skipAdSelectors) {
              try {
                const matched = document.querySelectorAll(sel)
                for (const el of Array.from(matched)) {
                  const htmlEl = el as HTMLElement
                  if (htmlEl) {
                    element = htmlEl
                    break
                  }
                }
                if (element) break
              } catch {}
            }

            // Fallback: If ad skip button not found yet, check if video player is in an ad and advance it
            const moviePlayer = document.querySelector('#movie_player')
            const video = document.querySelector('video')
            if (!element && moviePlayer && moviePlayer.classList.contains('ad-showing') && video) {
              try {
                video.currentTime = video.duration || 999999
                return { success: true, message: 'Skipped video ad' }
              } catch {}
            }
          }

          // B. Video & Song / Music Click on YouTube or media sites
          if (!element && isMediaOrVideoQuery) {
            const isWatchPage = window.location.pathname.includes('/watch')
            const videoSelectors = isWatchPage ? [
              'button.ytp-play-button',
              'video',
              'button[data-testid="play-button"]',
              'button[aria-label*="Play" i]',
              'button[aria-label*="play" i]',
              'ytd-compact-video-renderer a#video-title',
              'a#video-title'
            ] : [
              'ytd-video-renderer a#video-title',
              'ytd-rich-item-renderer a#video-title-link',
              'ytd-compact-video-renderer a#video-title',
              'ytd-video-renderer a#thumbnail',
              'a#video-title',
              'a[href*="/watch?v="]',
              'button[data-testid="play-button"]',
              'button[aria-label*="Play" i]',
              'button[aria-label*="play" i]',
              'button.ytp-play-button',
              'video'
            ]

            const candidates: HTMLElement[] = []
            for (const sel of videoSelectors) {
              const matched = document.querySelectorAll(sel)
              matched.forEach((el) => {
                const htmlEl = el as HTMLElement
                const rect = htmlEl.getBoundingClientRect()
                if (rect.width > 0 && rect.height > 0 && !candidates.includes(htmlEl)) {
                  candidates.push(htmlEl)
                }
              })
              if (candidates.length > targetOrdinal) break
            }

            if (candidates.length > targetOrdinal) {
              element = candidates[targetOrdinal]
            } else if (candidates.length > 0) {
              element = candidates[0]
            }
          }

          // B. General Link / Search Result query
          if (!element && (query.includes('link') || query.includes('result') || query.includes('first') || query.includes('item'))) {
            const resultSelectors = [
              '#search a h3',
              'div.g a',
              'a:has(h3)',
              '[data-testid="result-title-a"]',
              'main a[href]',
              'article a[href]',
              'a[href]'
            ]

            const candidates: HTMLElement[] = []
            for (const sel of resultSelectors) {
              try {
                const matched = document.querySelectorAll(sel)
                matched.forEach((el) => {
                  const htmlEl = (el.tagName.toLowerCase() === 'h3' && el.parentElement?.tagName.toLowerCase() === 'a' ? el.parentElement : el) as HTMLElement
                  const rect = htmlEl.getBoundingClientRect()
                  const text = (htmlEl.textContent || '').trim()
                  if (rect.width > 0 && rect.height > 0 && text.length > 2 && !candidates.includes(htmlEl)) {
                    candidates.push(htmlEl)
                  }
                })
                if (candidates.length > targetOrdinal) break
              } catch {}
            }

            if (candidates.length > targetOrdinal) {
              element = candidates[targetOrdinal]
            }
          }

          // C. General Interactive Element Semantic/Text Matching
          if (!element && query) {
            // Strip ordinal words to find element name
            const cleanQuery = query.replace(/\b(?:first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|video|link|result|button|the)\b/gi, '').trim()
            const matchTarget = cleanQuery || query

            const interactiveElements = Array.from(document.querySelectorAll('button, a[href], input[type="submit"], input[type="button"], [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])')) as HTMLElement[]
            
            const matched: HTMLElement[] = []
            for (const el of interactiveElements) {
              const rect = el.getBoundingClientRect()
              if (rect.width === 0 || rect.height === 0) continue

              const text = (el.textContent || '').toLowerCase().trim()
              const aria = (el.getAttribute('aria-label') || '').toLowerCase().trim()
              const title = (el.getAttribute('title') || '').toLowerCase().trim()
              const value = (el instanceof HTMLInputElement ? el.value : '').toLowerCase().trim()

              if (text.includes(matchTarget) || aria.includes(matchTarget) || title.includes(matchTarget) || value.includes(matchTarget)) {
                matched.push(el)
              }
            }

            if (matched.length > targetOrdinal) {
              element = matched[targetOrdinal]
            } else if (matched.length > 0) {
              element = matched[0]
            }
          }
        }

        // If still not found and index was passed, provide descriptive error
        if (!element) {
          const detail = args.index !== undefined ? `with index ${args.index}` : `matching "${args.query || args.text || args.selector || 'element'}"`
          return { success: false, error: `Element ${detail} not found on this page.` }
        }

        // Check if element is disabled
        if (element.hasAttribute('disabled')) {
          return { success: false, error: 'Element is disabled' }
        }

        if (element.matches(':disabled, [aria-disabled="true"]')) return { success: false, error: 'Target is disabled' }
        // Scroll into view smoothly
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        element.focus()

        // Get descriptive info before click
        const role = element.getAttribute('role') || element.tagName.toLowerCase()
        const name = element.getAttribute('aria-label') || element.textContent?.trim() || 'unnamed element'
        const anchor = (element.tagName.toLowerCase() === 'a' ? element : element.closest('a')) as HTMLAnchorElement | null
        const href = anchor ? anchor.href : null

        // Realistic mouse/pointer dispatch
        const pointerDown = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, view: document.defaultView })
        const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: document.defaultView })
        const pointerUp = new MouseEvent('pointerup', { bubbles: true, cancelable: true, view: document.defaultView })
        const mouseUp = new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: document.defaultView })
        
        element.dispatchEvent(pointerDown)
        element.dispatchEvent(mouseDown)
        element.dispatchEvent(pointerUp)
        element.dispatchEvent(mouseUp)
        if (element instanceof HTMLVideoElement) {
          if (element.paused) {
            element.play().catch(() => {})
          }
        }
        if (anchor && anchor !== element) {
          anchor.click()
        } else {
          element.click()
        }


        return {
          success: true,
          message: `Clicked ${role}: "${name.substring(0, 50)}"`
        }
      },
      args: [params]
    })

    const response = result[0]?.result

    if (!response?.success) {
      return { success: false, error: response?.error || 'Click injection returned no result' }
    }

    return {
      success: true,
      result: response?.message || `Clicked element`
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'clickElement',
  description: 'Clicks an interactive element, video, link, or button on the page by its natural language description (e.g. "first video", "login link"), index, or selector.',
  parameters: [
    {
      name: 'index',
      type: 'number',
      description: 'The numeric index of the element to click (from findElements or getAccessibilitySnapshot)',
      required: false
    },
    {
      name: 'query',
      type: 'string',
      description: 'Natural language description of what to click (e.g., "first video", "second link", "submit button", "login")',
      required: false
    },
    {
      name: 'ordinal',
      type: 'number',
      description: 'Zero-based ordinal index if multiple items match (0 for first, 1 for second)',
      required: false
    }
  ],
  spokenLine: 'Clicking element',
  examples: [
    'User: "open the first video" → clickElement with query: "first video"',
    'User: "play the second video" → clickElement with query: "second video", ordinal: 1',
    'User: "click the submit button" → clickElement with query: "submit button"',
    'User: "click login" → clickElement with query: "login"',
    'User: "click element 5" → clickElement with index: 5'
  ]
}

export default clickElement
