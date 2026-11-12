import type { ToolSpec } from '../tool-registry'

function normalizeUrl(rawUrl: string): string {
  let url = (rawUrl || '').trim()
  if (!url) throw new Error('URL is required')
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^(https?:|chrome:|about:)/i.test(url)) throw new Error('Unsupported URL scheme')
  if (/^about:/i.test(url) && url !== 'about:blank') throw new Error('Unsupported browser page')
  if (/^chrome:/i.test(url) && !/^chrome:\/\/(extensions|settings|flags|downloads|history|bookmarks|newtab)\/?(?:[?#].*)?$/i.test(url)) throw new Error('Unsupported browser page')

  // If already a valid full protocol
  if (/^https?:\/\//i.test(url) || url.startsWith('chrome://') || url.startsWith('about:')) {
    try {
      const parsed = new URL(url)
      if (parsed.username || parsed.password) throw new Error('Credentials in URLs are not allowed')
      return parsed.href
    } catch {
      throw new Error('Invalid URL')
    }
  }

  // Handle common shorthand site names
  const lower = url.toLowerCase()
  if (lower === 'youtube' || lower === 'youtube.com') return 'https://www.youtube.com'
  if (lower === 'google' || lower === 'google.com') return 'https://www.google.com'
  if (lower === 'github' || lower === 'github.com') return 'https://github.com'
  if (lower === 'reddit' || lower === 'reddit.com') return 'https://www.reddit.com'
  if (lower === 'twitter' || lower === 'x' || lower === 'x.com' || lower === 'twitter.com') return 'https://x.com'
  if (lower === 'linkedin' || lower === 'linkedin.com') return 'https://www.linkedin.com'
  if (lower === 'wikipedia' || lower === 'wikipedia.org') return 'https://www.wikipedia.org'

  // Chrome internal pages shortcuts
  if (lower === 'extensions' || lower === 'extension' || lower === 'chrome extension' || lower === 'chrome extensions' || lower === 'extension management page' || lower === 'chrome://extensions') return 'chrome://extensions'
  if (lower === 'settings' || lower === 'chrome settings' || lower === 'chrome://settings') return 'chrome://settings'
  if (lower === 'flags' || lower === 'chrome flags' || lower === 'chrome://flags') return 'chrome://flags'
  if (lower === 'downloads' || lower === 'chrome downloads' || lower === 'chrome://downloads') return 'chrome://downloads'
  if (lower === 'history' || lower === 'chrome history' || lower === 'chrome://history') return 'chrome://history'
  if (lower === 'bookmarks' || lower === 'chrome bookmarks' || lower === 'chrome://bookmarks') return 'chrome://bookmarks'
  if (lower === 'new tab' || lower === 'newtab' || lower === 'chrome://newtab') return 'chrome://newtab'

  // Prepend https://
  url = 'https://' + url
  try {
    return new URL(url).href
  } catch {
    throw new Error('Invalid URL')
  }
}

export function getDomain(urlStr?: string | null): string {
  if (!urlStr || typeof urlStr !== 'string') return ''
  try {
    const parsed = new URL(urlStr)
    let hostname = parsed.hostname.toLowerCase()
    hostname = hostname.replace(/^(?:www|m|mobile|web)\./, '')
    const parts = hostname.split('.')
    if (parts.length >= 2) {
      const sld = parts[parts.length - 2]
      if (['co', 'com', 'org', 'net', 'edu', 'gov'].includes(sld) && parts.length >= 3) {
        return parts.slice(-3).join('.')
      }
      return parts.slice(-2).join('.')
    }
    return hostname
  } catch {
    return ''
  }
}

export function isSameWebsite(urlA?: string | null, urlB?: string | null): boolean {
  if (!urlA || !urlB) return false
  const domainA = getDomain(urlA)
  const domainB = getDomain(urlB)
  if (!domainA || !domainB) return false
  return domainA === domainB
}

export function isBlankOrNewTab(urlStr?: string | null): boolean {
  if (!urlStr) return true
  const lower = urlStr.toLowerCase().trim()
  return (
    lower === 'about:blank' ||
    lower.startsWith('chrome://newtab') ||
    lower.startsWith('chrome://welcome') ||
    lower.startsWith('edge://newtab')
  )
}

async function openTab(params: { url: string; autoPlay?: boolean; sameTab?: boolean; inSameTab?: boolean; currentTab?: boolean; newTab?: boolean; inNewTab?: boolean }, context?: string) {
  try {
    const isExplicitSameTab = !!(params.sameTab || params.inSameTab || params.currentTab)
    const isExplicitNewTab = !!(params.newTab || params.inNewTab)
    // Refuse to open tabs from popup context as it would close the popup (unless sameTab is requested)
    if (context === 'popup' && !isExplicitSameTab) {
      return { 
        success: false, 
        error: 'STOP: Cannot open tabs from popup window. Please ask the user to open Pentone in the side panel by clicking the maximize icon in the top right. Do NOT continue with the task or try other tools - just tell the user this and wait.' 
      }
    }
    
    if (!params.url) {
      return { success: false, error: 'URL is required' }
    }

    const finalUrl = normalizeUrl(params.url)
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
    const sameSite = activeTab?.url ? isSameWebsite(activeTab.url, finalUrl) : false
    const blankTab = activeTab?.url ? isBlankOrNewTab(activeTab.url) : false
    const shouldReuseTab = !isExplicitNewTab && (isExplicitSameTab || sameSite || blankTab)

    let tab = activeTab
    if (shouldReuseTab && activeTab?.id) {
      tab = await chrome.tabs.update(activeTab.id, { url: finalUrl })
    } else {
      tab = await chrome.tabs.create({ url: finalUrl, active: true })
      // Track previously active tab for seamless "go to previous tab" switching
      if (activeTab?.id && typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get(['pentone_tab_history']).then((stored) => {
          const hist: number[] = Array.isArray(stored?.pentone_tab_history) ? stored.pentone_tab_history : []
          const filtered = hist.filter(id => id !== tab.id && id !== activeTab.id)
          const updated = [tab.id, activeTab.id, ...filtered].slice(0, 20)
          chrome.storage.local.set({
            pentone_tab_history: updated,
            pentone_previous_tab_id: activeTab.id
          }).catch(() => {})
        }).catch(() => {})
      }
    }
    // Ensure Pentone remains the selected voice target on the newly created tab
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({
        pentone_selected: true,
        pentone_sidepanel_open: true,
        pentone_selected_timestamp: Date.now()
      }).catch(() => {})
    }

    // Auto-play top video or track when opening media destination (e.g. YouTube play intent)
    if (params.autoPlay && tab?.id && typeof chrome !== 'undefined' && chrome.scripting?.executeScript) {
      const tabId = tab.id
      const triggerMediaAutoPlay = () => {
        try {
          chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
              const start = Date.now()
              const tryPlayMedia = () => {
                // 1. Direct video element
                const video = document.querySelector('video') as HTMLVideoElement | null
                if (video && video.paused) {
                  video.play().catch(() => {})
                }

                // 2. Play button or first video link on search results
                const playSelectors = [
                  'ytd-video-renderer a#video-title',
                  'ytd-rich-item-renderer a#video-title-link',
                  'ytd-compact-video-renderer a#video-title',
                  'ytd-video-renderer a#thumbnail',
                  'a#video-title',
                  'a[href*="/watch?v="]',
                  'button.ytp-play-button',
                  'button[data-testid="play-button"]',
                  'button[aria-label*="Play" i]'
                ]

                for (const sel of playSelectors) {
                  const els = document.querySelectorAll(sel)
                  for (const el of Array.from(els)) {
                    const htmlEl = el as HTMLElement
                    const rect = htmlEl.getBoundingClientRect()
                    if (rect.width > 0 && rect.height > 0) {
                      htmlEl.click()
                      return
                    }
                  }
                }

                if (Date.now() - start < 5000) {
                  setTimeout(tryPlayMedia, 300)
                }
              }
              tryPlayMedia()
            }
          }).catch(() => {})
        } catch {}
      }

      if (chrome.tabs?.onUpdated) {
        const updateListener = (updatedId: number, info: any) => {
          if (updatedId === tabId && info.status === 'complete') {
            try { chrome.tabs.onUpdated.removeListener(updateListener) } catch {}
            triggerMediaAutoPlay()
          }
        }
        try { chrome.tabs.onUpdated.addListener(updateListener) } catch {}
        setTimeout(() => {
          try { chrome.tabs.onUpdated.removeListener(updateListener) } catch {}
          triggerMediaAutoPlay()
        }, 3000)
      } else {
        setTimeout(triggerMediaAutoPlay, 1000)
      }
    }

    // Ensure Chrome registers the newly opened tab as active before chained actions
    await new Promise(r => setTimeout(r, 150))
    
    return { 
      success: true, 
      result: shouldReuseTab 
        ? `Navigated current tab to ${finalUrl} (ID: ${tab?.id})` 
        : `Opened ${finalUrl} in new tab (ID: ${tab?.id})` 
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'openTab',
  description: 'Opens any website or search URL in a browser tab. Intelligently updates current tab if already on the same website, or opens a new tab for a new website.',
  parameters: [
    {
      name: 'url',
      type: 'string',
      description: 'The URL to open (e.g. "https://www.youtube.com", "https://www.youtube.com/results?search_query=...", "https://www.google.com/search?q=...")',
      required: true
    },
    {
      name: 'autoPlay',
      type: 'boolean',
      description: 'When true, automatically starts playback of the top matching video or song once loaded.',
      required: false
    },
    {
      name: 'sameTab',
      type: 'boolean',
      description: 'When true, forces navigation in the active tab instead of opening a new tab.',
      required: false
    },
    {
      name: 'newTab',
      type: 'boolean',
      description: 'When true, explicitly opens in a new tab even if the active tab is already on this site.',
      required: false
    }
  ],
  spokenLine: "Opening {url}",
  examples: [
    'User: "open youtube and search for react tutorials" → openTab with url: "https://www.youtube.com/results?search_query=react+tutorials"',
    'User: "open youtube" → openTab with url: "https://www.youtube.com"',
    'User: "open google and search for latest news" → openTab with url: "https://www.google.com/search?q=latest+news"',
    'User: "go to reddit" → openTab with url: "https://www.reddit.com"',
    'User: "click first video" → findElements "video" shows [118] LINK with (https://youtube.com/watch?v=...), then openTab with that URL'
  ]
}

export default openTab
