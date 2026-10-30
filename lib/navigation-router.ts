import { validateToolCallSchema, type ToolCall } from './tool-parser'
import { analyzeSpokenInput } from './intent-validator'

export interface NavigationRouteResult {
  isMatch: boolean
  toolCall?: ToolCall
  error?: string
  isCompoundTask?: boolean
  remainingInstructions?: string
  isAmbiguous?: boolean
  suggestedQuery?: string
  clarificationPrompt?: string
}

/**
 * Deterministically routes search and navigation user intents
 * to validated openTab tool calls using standard URL and URLSearchParams APIs.
 * 
 * Guarantees zero security bypasses: validates schema, tool allowlist, and URL protocols.
 * Supports technical phonetic disambiguation and compound task detection.
 */
export function resolveDeterministicNavigation(userInput: string): NavigationRouteResult {
  if (!userInput || typeof userInput !== 'string') {
    return { isMatch: false }
  }

  const trimmed = userInput.trim()

  // Pre-check for phonetic collisions and ambiguity
  const analysis = analyzeSpokenInput(trimmed)
  if (analysis.shouldClarify) {
    return {
      isMatch: false,
      isAmbiguous: true,
      suggestedQuery: analysis.suggestedQuery,
      clarificationPrompt: analysis.suggestedClarification
    }
  }

  // Work with canonical / repaired query if unambiguous phonetic collision was detected
  const effectiveInput = analysis.suggestedQuery || trimmed

  // Helper to split off compound instructions (e.g. ", identify the first three video results...")
  const splitCompoundInstruction = (queryTail: string): { cleanQuery: string; hasCompound: boolean; remaining: string } => {
    const compoundRegex = /(?:,\s*|\s+(?:and\s+then|then)\s+)(?:identify|find|get|list|look\s+for|click|summarize|read|tell\s+me)\b([\s\S]*)$/i
    const match = queryTail.match(compoundRegex)
    if (match) {
      const clean = queryTail.slice(0, match.index).trim().replace(/[,.!?]+$/, '')
      return {
        cleanQuery: clean,
        hasCompound: true,
        remaining: match[0].replace(/^,\s*/, '').trim()
      }
    }
    return { cleanQuery: queryTail.replace(/[,.!?]+$/, ''), hasCompound: false, remaining: '' }
  }

  // 1. YouTube Search:
  // e.g. "Open YouTube and search for the best React tutorials.", "Search YouTube for React", "Search for React on YouTube"
  const ytSearchMatch = 
    effectiveInput.match(/^(?:please\s+)?(?:open\s+youtube\s+(?:and\s+)?search\s+(?:for\s+)?|search\s+youtube\s+(?:for\s+)?|search\s+(?:for\s+)?(.+?)\s+on\s+youtube)(.+)$/i) ||
    effectiveInput.match(/^(?:please\s+)?search\s+youtube\s+for\s+(.+)$/i)

  if (ytSearchMatch) {
    const rawTail = (ytSearchMatch[2] ?? ytSearchMatch[1] ?? '').trim()
    const { cleanQuery, hasCompound, remaining } = splitCompoundInstruction(rawTail)

    if (cleanQuery) {
      const urlObj = new URL('https://www.youtube.com/results')
      urlObj.searchParams.set('search_query', cleanQuery)
      
      const validation = validateToolCallSchema('openTab', { 
        url: urlObj.toString(),
        tabName: 'YouTube'
      })
      if (validation.valid && validation.toolCall) {
        return { 
          isMatch: true, 
          toolCall: validation.toolCall,
          isCompoundTask: hasCompound,
          remainingInstructions: remaining
        }
      }
    }
  }

  // 2. Google Search:
  // e.g. "Open Google and search for the best AI tools.", "Search Google for AI tools"
  const googleSearchMatch = 
    effectiveInput.match(/^(?:please\s+)?(?:open\s+google\s+(?:and\s+)?search\s+(?:for\s+)?|search\s+google\s+(?:for\s+)?|search\s+(?:for\s+)?(.+?)\s+on\s+google)(.+)$/i) ||
    effectiveInput.match(/^(?:please\s+)?search\s+google\s+for\s+(.+)$/i)

  if (googleSearchMatch) {
    const rawTail = (googleSearchMatch[2] ?? googleSearchMatch[1] ?? '').trim()
    const { cleanQuery, hasCompound, remaining } = splitCompoundInstruction(rawTail)

    if (cleanQuery) {
      const urlObj = new URL('https://www.google.com/search')
      urlObj.searchParams.set('q', cleanQuery)
      
      const validation = validateToolCallSchema('openTab', { 
        url: urlObj.toString(),
        tabName: 'Google'
      })
      if (validation.valid && validation.toolCall) {
        return { 
          isMatch: true, 
          toolCall: validation.toolCall,
          isCompoundTask: hasCompound,
          remainingInstructions: remaining
        }
      }
    }
  }

  // 3. GitHub Search:
  // e.g. "Open GitHub and search for popular React repositories."
  const ghSearchMatch = 
    effectiveInput.match(/^(?:please\s+)?(?:open\s+github\s+(?:and\s+)?search\s+(?:for\s+)?|search\s+github\s+(?:for\s+)?)(.+)$/i)

  if (ghSearchMatch) {
    const rawTail = (ghSearchMatch[1] ?? '').trim()
    const { cleanQuery, hasCompound, remaining } = splitCompoundInstruction(rawTail)

    if (cleanQuery) {
      const urlObj = new URL('https://github.com/search')
      urlObj.searchParams.set('q', cleanQuery)
      
      const validation = validateToolCallSchema('openTab', { 
        url: urlObj.toString(),
        tabName: 'GitHub'
      })
      if (validation.valid && validation.toolCall) {
        return { 
          isMatch: true, 
          toolCall: validation.toolCall,
          isCompoundTask: hasCompound,
          remainingInstructions: remaining
        }
      }
    }
  }

  // 4. Simple direct domain navigation:
  // e.g. "Open GitHub", "Navigate to GitHub", "Open a new tab and navigate to GitHub"
  const directNavMatch = 
    effectiveInput.match(/^(?:please\s+)?(?:open(?:\s+a\s+new\s+tab\s+(?:and\s+)?)?(?:navigate\s+to\s+)?|navigate\s+to\s+)(github|youtube|google|wikipedia|reddit|twitter|x)\.?(?:com)?$/i)

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
