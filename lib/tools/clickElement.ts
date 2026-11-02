import type { ToolSpec } from '../tool-types'

/**
 * Extracts a YouTube 11-character video ID from a URL if present.
 */
export function extractYouTubeVideoId(url?: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.searchParams.has('v')) {
      return parsed.searchParams.get('v')
    }
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=))([\w-]{11})/)
    return match ? match[1] : null
  } catch {
    const match = url.match(/(?:v=|\/)([\w-]{11})(?:[&?]|$)/)
    return match ? match[1] : null
  }
}

/**
 * Bounded navigation poller that handles SPA pushState, full-page navigations,
 * and delayed URL changes up to maxTimeoutMs (default 2500ms).
 */
export async function verifyNavigationState(
  tabId: number,
  initialUrl: string | undefined,
  targetUrl: string | null,
  maxTimeoutMs: number = 2500,
  pollIntervalMs: number = 80
): Promise<{ verified: boolean; finalUrl: string | undefined; timedOut: boolean }> {
  const startTime = Date.now()
  let currentUrl = initialUrl
  const targetVideoId = extractYouTubeVideoId(targetUrl)

  const normalizeUrl = (u?: string | null) => {
    if (!u) return ''
    try {
      const parsed = new URL(u)
      return `${parsed.origin}${parsed.pathname}${parsed.search}`
    } catch {
      return u
    }
  }

  const normalizedTarget = normalizeUrl(targetUrl)

  while (Date.now() - startTime < maxTimeoutMs) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.url) {
        currentUrl = tab.url
        const normalizedCurrent = normalizeUrl(currentUrl)

        // Case 1: YouTube video ID destination match
        if (targetVideoId) {
          const currentVideoId = extractYouTubeVideoId(currentUrl)
          if (currentVideoId && currentVideoId === targetVideoId) {
            return { verified: true, finalUrl: currentUrl, timedOut: false }
          }
        } else if (normalizedTarget && (normalizedCurrent === normalizedTarget || currentUrl.includes(normalizedTarget) || (targetUrl && currentUrl.includes(targetUrl)))) {
          return { verified: true, finalUrl: currentUrl, timedOut: false }
        } else if (!targetUrl && initialUrl && currentUrl !== initialUrl) {
          return { verified: true, finalUrl: currentUrl, timedOut: false }
        }
      }

      // Check page-internal location (handles SPA pushState before tabs API updates)
      const pageScript = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => window.location.href
      }).catch(() => null)

      const pageHref = pageScript?.[0]?.result
      if (pageHref && pageHref !== initialUrl) {
        currentUrl = pageHref
        const normalizedPage = normalizeUrl(pageHref)

        if (targetVideoId) {
          const pageVideoId = extractYouTubeVideoId(pageHref)
          if (pageVideoId && pageVideoId === targetVideoId) {
            return { verified: true, finalUrl: pageHref, timedOut: false }
          }
        } else if (!normalizedTarget || normalizedPage === normalizedTarget || pageHref.includes(normalizedTarget)) {
          return { verified: true, finalUrl: pageHref, timedOut: false }
        }
      }
    } catch {}

    await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
  }

  const currentVideoId = extractYouTubeVideoId(currentUrl)
  const finalVerified = Boolean(
    targetVideoId
      ? (currentVideoId && currentVideoId === targetVideoId)
      : (targetUrl && currentUrl && (currentUrl === targetUrl || currentUrl.includes(targetUrl))) ||
        (!targetUrl && initialUrl && currentUrl && currentUrl !== initialUrl)
  )

  return { verified: finalVerified, finalUrl: currentUrl, timedOut: !finalVerified }
}

async function clickElement(params: { index: number }) {
  try {
    const index = Number(params?.index)
    if (params?.index === undefined || params?.index === null || !Number.isInteger(index) || index < 0) {
      return { success: false, error: 'Element index is required and must be a non-negative integer' }
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    // Check if on internal page
    if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://') || tab.url?.startsWith('about:')) {
      return { success: false, error: 'Cannot interact with browser internal pages' }
    }

    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (elementIndex: number) => {
        let element = (document.querySelector(`[data-pentone-${elementIndex}]`) || document.querySelector(`[data-marionette-${elementIndex}]`)) as HTMLElement
        
        if (!element) {
          // Resilient DOM Re-index: Refresh elements if dynamic page updated or attributes were not yet attached
          let counter = 0
          const interactiveSelectors = [
            'button',
            'a[href]',
            'input',
            'textarea',
            'select',
            '[role="button"]',
            '[role="link"]',
            '[tabindex]:not([tabindex="-1"])'
          ]
          const isVisible = (el: HTMLElement) => {
            const rect = el.getBoundingClientRect()
            const style = window.getComputedStyle(el)
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0'
          }
          const nodes = document.querySelectorAll(interactiveSelectors.join(','))
          for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i] as HTMLElement
            if (isVisible(el)) {
              el.setAttribute(`data-pentone-${counter}`, 'true')
              if (counter === elementIndex) {
                element = el
                break
              }
              counter++
            }
          }
        }

        // Specific YouTube search result fallback: Handle video link clicks
        if (!element && window.location.hostname.includes('youtube.com')) {
          const videoTitleLinks = Array.from(document.querySelectorAll('a#video-title, ytd-video-renderer a#thumbnail')) as HTMLElement[]
          const visibleVideos = videoTitleLinks.filter(el => {
            const rect = el.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0
          })
          if (visibleVideos.length > 0) {
            const targetVideo = visibleVideos[elementIndex] || visibleVideos[elementIndex - 1]
            if (targetVideo) {
              element = targetVideo
            }
          }
        }
        
        if (!element) {
          return { success: false, error: `Element with index ${elementIndex} not found. Call findElements or getAccessibilitySnapshot to view available elements.` }
        }
        
        // Check if element is disabled
        if (element.hasAttribute('disabled') || (element as any).disabled) {
          return { success: false, error: 'Element is disabled' }
        }
        
        // Scroll into view
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        
        // Extract potential destination URL before clicking (safely checking element.closest)
        const anchorEl = (element instanceof HTMLAnchorElement ? element : (typeof (element as any).closest === 'function' ? (element as any).closest('a') : null) || element.querySelector?.('a')) as HTMLAnchorElement | null
        const targetUrl = anchorEl?.href || null

        // Click the element
        element.click()
        
        // Get element info for confirmation
        const role = element.getAttribute('role') || element.tagName.toLowerCase()
        const name = element.getAttribute('aria-label') || element.textContent?.trim() || 'unnamed element'
        
        return { 
          success: true, 
          message: `Clicked ${role}: "${name.substring(0, 50)}"`,
          targetUrl
        }
      },
      args: [index]
    })

    const response = result[0]?.result
    
    if (response?.success === false) {
      return { success: false, error: response.error }
    }
    
    // Bounded navigation verification strategy:
    // Handles YouTube SPA pushState, full page navigation, and delayed URL changes up to 2.5s
    const navOutcome = await verifyNavigationState(tab.id, tab.url, response?.targetUrl, 2500, 80)
    const verifiedNavigation = navOutcome.verified
    const finalUrl = navOutcome.finalUrl || tab.url

    // If an anchor was clicked with an intended target URL, but navigation never occurred:
    if (response?.targetUrl && !verifiedNavigation) {
      return {
        success: false,
        error: `Clicked ${response.message || `element ${index}`}, but navigation to ${response.targetUrl} did not occur within 2.5s. Current URL remains: ${finalUrl}`
      }
    }

    return { 
      success: true, 
      tabId: tab.id,
      url: finalUrl,
      targetUrl: response?.targetUrl,
      verifiedNavigation,
      result: `${response?.message || `Clicked element ${index}`}${verifiedNavigation ? ` (verified navigation to ${finalUrl})` : ''}`
    }
  } catch (error: any) {
    return { success: false, error: error?.message || 'Failed to click element' }
  }
}

export const spec: ToolSpec = {
  name: 'clickElement',
  description: 'Clicks an interactive element on the page (button, link, video card, control) by its index number. Must call findElements or getAccessibilitySnapshot first to discover current element indices.',
  parameters: [
    {
      name: 'index',
      type: 'number',
      description: 'The index number of the element to click (from findElements or getAccessibilitySnapshot)',
      required: true
    }
  ],
  spokenLine: "Clicking element {index}",
  examples: [
    'User: "click submit" → clickElement with index: 3',
    'User: "click first video" → findElements "video", then clickElement with index'
  ]
}

export default clickElement
