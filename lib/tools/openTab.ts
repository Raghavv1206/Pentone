import type { ToolSpec } from '../tool-registry'

function normalizeUrl(rawUrl: string): string {
  let url = (rawUrl || '').trim()
  if (!url) return 'https://www.google.com'

  // If already a valid full protocol
  if (/^https?:\/\//i.test(url) || url.startsWith('chrome://') || url.startsWith('about:')) {
    try {
      return new URL(url).href
    } catch {
      return encodeURI(url)
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

  // Prepend https://
  url = 'https://' + url
  try {
    return new URL(url).href
  } catch {
    return encodeURI(url)
  }
}

async function openTab(params: { url: string }, context?: string) {
  try {
    // Refuse to open tabs from popup context as it would close the popup
    if (context === 'popup') {
      return { 
        success: false, 
        error: 'STOP: Cannot open tabs from popup window. Please ask the user to open Pentone in the side panel by clicking the maximize icon in the top right. Do NOT continue with the task or try other tools - just tell the user this and wait.' 
      }
    }
    
    if (!params.url) {
      return { success: false, error: 'URL is required' }
    }

    const finalUrl = normalizeUrl(params.url)
    const tab = await chrome.tabs.create({ url: finalUrl })
    
    return { 
      success: true, 
      result: `Opened ${finalUrl} in new tab (ID: ${tab.id})` 
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'openTab',
  description: 'Opens any website or search URL in a new browser tab. Use this to open YouTube, Google, links, search results, or any external page.',
  parameters: [
    {
      name: 'url',
      type: 'string',
      description: 'The URL to open (e.g. "https://www.youtube.com", "https://www.youtube.com/results?search_query=...", "https://www.google.com/search?q=...")',
      required: true
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
