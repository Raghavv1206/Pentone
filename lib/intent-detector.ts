import type { ToolCall } from './tools'

export interface DetectedIntent {
  toolCall: ToolCall
  confirmationText: string
}

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

/**
 * Checks if the assistant output is a standard model refusal/denial
 * (e.g., Gemini Nano falling back to base training claiming it cannot open applications or browse).
 */
export function isModelRefusal(assistantText: string): boolean {
  if (!assistantText || typeof assistantText !== 'string') return false
  const lower = assistantText.toLowerCase()

  const refusalPhrases = [
    'cannot directly open applications',
    'do not have the capability to directly open',
    'cannot open applications',
    'cannot browse the internet',
    'do not have the ability to browse',
    'as a text-based large language model',
    'as a large language model, i',
    'as an ai language model, i',
    'as a text-based ai',
    'i cannot access real-time',
    'i cannot access the internet',
    'cannot perform live searches',
    'unable to open applications',
    'unable to browse the internet',
    'do not have access to real-time internet',
    'do not have the ability to open'
  ]

  return refusalPhrases.some(phrase => lower.includes(phrase))
}

/**
 * Detects unambiguous navigation, search, or action intents from user text.
 */
export function detectIntent(userInput: string): DetectedIntent | null {
  if (!userInput || typeof userInput !== 'string') return null
  const cleaned = userInput.trim()
  const lower = cleaned.toLowerCase()

  // 1. YouTube search patterns:
  // "open youtube and search for X", "search for X on youtube", "search X on youtube", "search youtube for X"
  const ytSearchRegexes = [
    /^(?:please\s+)?(?:open\s+youtube\s+(?:and|to)\s+search\s+(?:for\s+)?)(.+)$/i,
    /^(?:please\s+)?(?:search\s+(?:for\s+)?)(.+?)\s+(?:on|in)\s+youtube$/i,
    /^(?:please\s+)?(?:search\s+youtube\s+(?:for\s+)?)(.+)$/i,
    /^(?:please\s+)?(?:youtube\s+search\s+(?:for\s+)?)(.+)$/i,
    /^(?:please\s+)?(?:find\s+(?:for\s+)?)(.+?)\s+(?:on|in)\s+youtube$/i
  ]

  for (const regex of ytSearchRegexes) {
    const match = cleaned.match(regex)
    if (match && match[1]?.trim()) {
      const query = match[1].trim().replace(/^["']|["']$/g, '')
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
      return {
        toolCall: {
          function: 'openTab',
          arguments: { url }
        },
        confirmationText: `Opening YouTube and searching for "${query}".`
      }
    }
  }

  // 2. Google / generic search patterns:
  // "open google and search for X", "search for X on google", "google X", "search for X"
  const googleSearchRegexes = [
    /^(?:please\s+)?(?:open\s+google\s+(?:and|to)\s+search\s+(?:for\s+)?)(.+)$/i,
    /^(?:please\s+)?(?:search\s+(?:for\s+)?)(.+?)\s+(?:on|in)\s+google$/i,
    /^(?:please\s+)?(?:google\s+(?:search\s+)?(?:for\s+)?)(.+)$/i
  ]

  for (const regex of googleSearchRegexes) {
    const match = cleaned.match(regex)
    if (match && match[1]?.trim()) {
      const query = match[1].trim().replace(/^["']|["']$/g, '')
      const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`
      return {
        toolCall: {
          function: 'openTab',
          arguments: { url }
        },
        confirmationText: `Searching Google for "${query}".`
      }
    }
  }

  // 3. Other sites search patterns: "open reddit and search for X", "search X on github"
  const siteSearchRegex = /^(?:please\s+)?(?:open\s+([a-z]+)\s+(?:and|to)\s+search\s+(?:for\s+)?)(.+)$/i
  const siteMatch = cleaned.match(siteSearchRegex)
  if (siteMatch) {
    const site = siteMatch[1].toLowerCase()
    const query = siteMatch[2].trim().replace(/^["']|["']$/g, '')
    if (site === 'reddit') {
      return {
        toolCall: {
          function: 'openTab',
          arguments: { url: `https://www.reddit.com/search/?q=${encodeURIComponent(query)}` }
        },
        confirmationText: `Searching Reddit for "${query}".`
      }
    } else if (site === 'github') {
      return {
        toolCall: {
          function: 'openTab',
          arguments: { url: `https://github.com/search?q=${encodeURIComponent(query)}` }
        },
        confirmationText: `Searching GitHub for "${query}".`
      }
    } else if (site === 'amazon') {
      return {
        toolCall: {
          function: 'openTab',
          arguments: { url: `https://www.amazon.com/s?k=${encodeURIComponent(query)}` }
        },
        confirmationText: `Searching Amazon for "${query}".`
      }
    }
  }

  // 4. Open website by common name or direct URL:
  // "open youtube", "open google", "go to reddit", "navigate to https://..."
  const openRegex = /^(?:please\s+)?(?:open|go\s+to|navigate\s+to|launch)\s+([^\s]+(?:\s+[^\s]+)?)$/i
  const openMatch = cleaned.match(openRegex)
  if (openMatch) {
    const target = openMatch[1].trim().toLowerCase()
    if (COMMON_SITES[target]) {
      return {
        toolCall: {
          function: 'openTab',
          arguments: { url: COMMON_SITES[target] }
        },
        confirmationText: `Opening ${target.charAt(0).toUpperCase() + target.slice(1)}.`
      }
    }

    // Check if it's a domain like "example.com" or full URL
    if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/.*)?$/i.test(target) || /^https?:\/\//i.test(target)) {
      const url = /^https?:\/\//i.test(target) ? target : `https://${target}`
      return {
        toolCall: {
          function: 'openTab',
          arguments: { url }
        },
        confirmationText: `Navigating to ${target}.`
      }
    }
  }

  // 5. Direct tab queries: "what tabs are open", "list tabs", "show tabs"
  if (
    lower === 'what tabs are open' || 
    lower === 'what tabs do i have' || 
    lower === 'list tabs' || 
    lower === 'list my tabs' || 
    lower === 'show tabs' || 
    lower === 'show open tabs'
  ) {
    return {
      toolCall: {
        function: 'getTabs',
        arguments: {}
      },
      confirmationText: 'Checking your open tabs.'
    }
  }

  // 6. Direct screenshot queries: "take a screenshot", "capture screenshot", "what's on my screen"
  if (
    lower === 'take a screenshot' || 
    lower === 'capture screenshot' || 
    lower === 'screenshot this page' || 
    lower === 'what is on my screen' || 
    lower === "what's on my screen"
  ) {
    return {
      toolCall: {
        function: 'captureScreenshot',
        arguments: {}
      },
      confirmationText: 'Capturing a screenshot of the current page.'
    }
  }

  // 7. Direct summarization: "summarize this page", "summarize page"
  if (
    lower === 'summarize this page' || 
    lower === 'summarize page' || 
    lower === 'give me a summary of this page'
  ) {
    return {
      toolCall: {
        function: 'summarizePage',
        arguments: { type: 'key-points', length: 'medium' }
      },
      confirmationText: 'Summarizing the current page for you.'
    }
  }

  return null
}
