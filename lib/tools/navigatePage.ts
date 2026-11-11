// navigatePage tool - Controls browser navigation (back, forward, reload, home, url)
import type { ToolSpec } from '../tool-registry'

const COMMON_SITES: Record<string, string> = {
  youtube: 'https://www.youtube.com',
  google: 'https://www.google.com',
  github: 'https://github.com',
  reddit: 'https://www.reddit.com',
  twitter: 'https://x.com',
  x: 'https://x.com',
  linkedin: 'https://www.linkedin.com',
  wikipedia: 'https://www.wikipedia.org',
  amazon: 'https://www.amazon.com',
  netflix: 'https://www.netflix.com',
  facebook: 'https://www.facebook.com',
  instagram: 'https://www.instagram.com',
  gmail: 'https://mail.google.com',
  chatgpt: 'https://chatgpt.com',
  spotify: 'https://open.spotify.com'
}

interface NavigateParams {
  action?: 'back' | 'forward' | 'reload' | 'refresh' | 'home' | 'main' | 'url' | 'goto' | string
  url?: string
  to?: string
}

async function navigatePage(params: NavigateParams) {
  try {
    const rawAction = (params.action || '').trim().toLowerCase()
    let targetUrl = (params.url || params.to || '').trim()

    // If action itself is a URL or domain or site name
    if (!targetUrl && (rawAction.includes('://') || rawAction.includes('.') || COMMON_SITES[rawAction])) {
      targetUrl = rawAction
    }

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

    // 1. Back
    if (rawAction === 'back' || rawAction === 'previous') {
      await chrome.tabs.goBack(tab.id)
      return { success: true, result: 'Navigated back to previous page.' }
    }

    // 2. Forward
    if (rawAction === 'forward' || rawAction === 'next') {
      await chrome.tabs.goForward(tab.id)
      return { success: true, result: 'Navigated forward to next page.' }
    }

    // 3. Reload / Refresh
    if (rawAction === 'reload' || rawAction === 'refresh') {
      await chrome.tabs.reload(tab.id)
      return { success: true, result: 'Reloaded the page.' }
    }

    // 4. Home / Main page of current tab (e.g. YouTube video -> YouTube main page)
    if (rawAction === 'home' || rawAction === 'main' || rawAction === 'homepage' || rawAction === 'root') {
      let homeUrl = 'https://www.google.com'
      if (tab.url) {
        try {
          const parsed = new URL(tab.url)
          if (parsed.origin && parsed.origin !== 'null' && /^https?:/i.test(parsed.protocol)) {
            homeUrl = parsed.origin + '/'
          }
        } catch (_) {}
      }

      // If on YouTube, try clicking YouTube logo for instant SPA transition
      if (tab.url && tab.url.includes('youtube.com') && typeof chrome.scripting?.executeScript === 'function') {
        try {
          const clicked = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const logo = document.querySelector('a#logo, ytd-topbar-logo-renderer a, #logo-icon') as HTMLElement | null
              if (logo) {
                logo.click()
                return true
              }
              return false
            }
          })
          if (clicked?.[0]?.result) {
            return { success: true, result: `Navigated to ${homeUrl}` }
          }
        } catch (_) {}
      }

      await chrome.tabs.update(tab.id, { url: homeUrl })
      return { success: true, result: `Navigated to ${homeUrl}` }
    }

    // 5. Navigate to URL in the same tab
    if (targetUrl) {
      let finalUrl = targetUrl
      const lower = finalUrl.toLowerCase()
      if (COMMON_SITES[lower]) {
        finalUrl = COMMON_SITES[lower]
      } else if (!/^https?:\/\//i.test(finalUrl) && !finalUrl.startsWith('chrome://') && !finalUrl.startsWith('about:')) {
        finalUrl = 'https://' + finalUrl
      }

      // If YouTube main page requested while on YouTube, try clicking YouTube logo for instant transition
      if ((finalUrl.includes('youtube.com') || lower === 'youtube') && tab.url && tab.url.includes('youtube.com') && typeof chrome.scripting?.executeScript === 'function') {
        try {
          const clicked = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const logo = document.querySelector('a#logo, ytd-topbar-logo-renderer a, #logo-icon') as HTMLElement | null
              if (logo) {
                logo.click()
                return true
              }
              return false
            }
          })
          if (clicked?.[0]?.result) {
            return { success: true, result: `Navigated to ${finalUrl} in current tab.` }
          }
        } catch (_) {}
      }

      await chrome.tabs.update(tab.id, { url: finalUrl })
      return { success: true, result: `Navigated to ${finalUrl} in current tab.` }
    }

    return { success: false, error: `Unknown navigation action: ${rawAction || 'none'}` }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'navigatePage',
  description: 'Navigates browser history, goes to home page, reloads, or navigates to a URL in the active tab: "back" to return to previous page, "forward" to go forward, "reload" to refresh, "home" to go to the main/home page of the current site, or url to navigate in the same tab.',
  parameters: [
    {
      name: 'action',
      type: 'string',
      description: 'The navigation action: "back", "forward", "reload", "home", or "url".',
      required: false
    },
    {
      name: 'url',
      type: 'string',
      description: 'The URL or website to navigate to in the current tab.',
      required: false
    }
  ],
  spokenLine: 'Navigating page',
  examples: [
    'User: "go back" → navigatePage with action: "back"',
    'User: "go to previous page" → navigatePage with action: "back"',
    'User: "go forward" → navigatePage with action: "forward"',
    'User: "refresh page" → navigatePage with action: "reload"',
    'User: "go to home page" → navigatePage with action: "home"',
    'User: "go to main youtube page" → navigatePage with url: "https://www.youtube.com"',
    'User: "navigate to google.com" → navigatePage with url: "https://www.google.com"'
  ]
}

export default navigatePage
