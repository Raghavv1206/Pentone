import { validateToolCallSchema, type ToolCall } from './tool-parser'

export interface NavigationRouteResult {
  isMatch: boolean
  toolCall?: ToolCall
  error?: string
}

/**
 * Deterministically routes simple, unambiguous search and navigation user intents
 * to validated openTab tool calls using standard URL and URLSearchParams APIs.
 * 
 * Guarantees zero security bypasses: validates schema, tool allowlist, and URL protocols.
 */
export function resolveDeterministicNavigation(userInput: string): NavigationRouteResult {
  if (!userInput || typeof userInput !== 'string') {
    return { isMatch: false }
  }

  const trimmed = userInput.trim()

  // 1. YouTube Search:
  // e.g. "Open YouTube and search for the best React tutorials.", "Search YouTube for React", "Search for React on YouTube"
  const ytSearchMatch = 
    trimmed.match(/^(?:please\s+)?(?:open\s+youtube\s+(?:and\s+)?search\s+(?:for\s+)?|search\s+youtube\s+(?:for\s+)?|search\s+(?:for\s+)?(.+?)\s+on\s+youtube)(.+)$/i) ||
    trimmed.match(/^(?:please\s+)?search\s+youtube\s+for\s+(.+)$/i)

  if (ytSearchMatch) {
    const rawQuery = (ytSearchMatch[2] ?? ytSearchMatch[1] ?? '').trim().replace(/[.!?]+$/, '')
    if (rawQuery) {
      const urlObj = new URL('https://www.youtube.com/results')
      urlObj.searchParams.set('search_query', rawQuery)
      
      const validation = validateToolCallSchema('openTab', { 
        url: urlObj.toString(),
        tabName: 'YouTube'
      })
      if (validation.valid && validation.toolCall) {
        return { isMatch: true, toolCall: validation.toolCall }
      }
    }
  }

  // 2. Google Search:
  // e.g. "Open Google and search for the best AI tools.", "Search Google for AI tools"
  const googleSearchMatch = 
    trimmed.match(/^(?:please\s+)?(?:open\s+google\s+(?:and\s+)?search\s+(?:for\s+)?|search\s+google\s+(?:for\s+)?|search\s+(?:for\s+)?(.+?)\s+on\s+google)(.+)$/i) ||
    trimmed.match(/^(?:please\s+)?search\s+google\s+for\s+(.+)$/i)

  if (googleSearchMatch) {
    const rawQuery = (googleSearchMatch[2] ?? googleSearchMatch[1] ?? '').trim().replace(/[.!?]+$/, '')
    if (rawQuery) {
      const urlObj = new URL('https://www.google.com/search')
      urlObj.searchParams.set('q', rawQuery)
      
      const validation = validateToolCallSchema('openTab', { 
        url: urlObj.toString(),
        tabName: 'Google'
      })
      if (validation.valid && validation.toolCall) {
        return { isMatch: true, toolCall: validation.toolCall }
      }
    }
  }

  // 3. GitHub Search:
  // e.g. "Open GitHub and search for popular React repositories."
  const ghSearchMatch = 
    trimmed.match(/^(?:please\s+)?(?:open\s+github\s+(?:and\s+)?search\s+(?:for\s+)?|search\s+github\s+(?:for\s+)?)(.+)$/i)

  if (ghSearchMatch) {
    const rawQuery = (ghSearchMatch[1] ?? '').trim().replace(/[.!?]+$/, '')
    if (rawQuery) {
      const urlObj = new URL('https://github.com/search')
      urlObj.searchParams.set('q', rawQuery)
      
      const validation = validateToolCallSchema('openTab', { 
        url: urlObj.toString(),
        tabName: 'GitHub'
      })
      if (validation.valid && validation.toolCall) {
        return { isMatch: true, toolCall: validation.toolCall }
      }
    }
  }

  // 4. Simple direct domain navigation:
  // e.g. "Open GitHub", "Navigate to GitHub", "Open a new tab and navigate to GitHub"
  const directNavMatch = 
    trimmed.match(/^(?:please\s+)?(?:open(?:\s+a\s+new\s+tab\s+(?:and\s+)?)?(?:navigate\s+to\s+)?|navigate\s+to\s+)(github|youtube|google|wikipedia|reddit|twitter|x)\.?(?:com)?$/i)

  if (directNavMatch) {
    const domain = directNavMatch[1].toLowerCase()
    const targetUrl = `https://${domain === 'x' ? 'x.com' : domain === 'wikipedia' ? 'wikipedia.org' : domain + '.com'}`
    const validation = validateToolCallSchema('openTab', { 
      url: targetUrl,
      tabName: domain.charAt(0).toUpperCase() + domain.slice(1)
    })
    if (validation.valid && validation.toolCall) {
      return { isMatch: true, toolCall: validation.toolCall }
    }
  }

  return { isMatch: false }
}
