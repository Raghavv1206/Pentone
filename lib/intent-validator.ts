/**
 * Technical Vocabulary & Intent Ambiguity Validator
 * 
 * Detects common phonetic collisions in speech recognition (especially for developer terms,
 * programming languages, and Indian English / Hinglish pronunciations).
 * 
 * Rules:
 * 1. Preserves original user transcript for logging and debugging.
 * 2. Never silently replaces user input without high-confidence criteria.
 * 3. Asks clarification when confidence is medium or ambiguous.
 * 4. Does not nag the user when the intent is already unambiguous.
 */

export interface IntentAnalysisResult {
  originalTranscript: string
  hasAmbiguity: boolean
  confidence: 'high' | 'medium' | 'low'
  detectedTerms: string[]
  suggestedQuery?: string
  suggestedClarification?: string
  isPhoneticCollision: boolean
  hasPhoneticCollision: boolean
  shouldClarify: boolean
}

// Well-known technical vocabulary terms (canonical representations)
export const TECHNICAL_TERMS = [
  'React',
  'React tutorials',
  'JavaScript',
  'TypeScript',
  'Python',
  'GitHub',
  'Next.js',
  'Node.js',
  'Vue.js',
  'Angular',
  'Tailwind CSS',
  'Docker',
  'Kubernetes',
  'VS Code',
  'HTML',
  'CSS',
  'Redux',
  'GraphQL',
  'PostgreSQL',
  'MongoDB'
]

// Phonetic collision mapping for developer tools and technical keywords
// Maps common speech-recognition misinterpretations (in English/Indian English) to canonical intents
interface PhoneticRule {
  pattern: RegExp
  canonicalTerm: string
  contextClues: RegExp[]
  clarificationQuestion: string
}

const PHONETIC_RULES: PhoneticRule[] = [
  {
    // "reactor to real", "reactor real", "react to real" -> "React tutorials"
    pattern: /\b(?:reactor\s+to\s+real|react\s+to\s+real|reactor\s+real|reactor\s+tutorial|reactor\s+tutorials)\b/i,
    canonicalTerm: 'React tutorials',
    contextClues: [/\b(?:youtube|search|tutorial|tutorials|learn|video|videos|best|guide|sikhao|batao|dekhao|padhao|kholo)\b/i],
    clarificationQuestion: "Did you mean 'React tutorials'? (Say yes to search for React tutorials, or no to keep your exact phrase)."
  },
  {
    // "type scripture" -> "TypeScript"
    pattern: /\b(?:type\s+scripture|type\s+script)\b/i,
    canonicalTerm: 'TypeScript',
    contextClues: [/\b(?:code|tutorial|github|repo|javascript|learn|search)\b/i],
    clarificationQuestion: "Did you mean 'TypeScript'?"
  },
  {
    // "git hub", "get hub" -> "GitHub"
    pattern: /\b(?:get\s+hub|git\s+hub)\b/i,
    canonicalTerm: 'GitHub',
    contextClues: [/\b(?:open|search|repo|repository|code|commit|profile)\b/i],
    clarificationQuestion: "Did you mean 'GitHub'?"
  },
  {
    // "pie thon", "pipe on" -> "Python"
    pattern: /\b(?:pie\s+thon|pipe\s+on)\b/i,
    canonicalTerm: 'Python',
    contextClues: [/\b(?:code|script|tutorial|search|learn|programming)\b/i],
    clarificationQuestion: "Did you mean 'Python'?"
  },
  {
    // "next chase", "next js" -> "Next.js"
    pattern: /\b(?:next\s+chase|neck\s+js)\b/i,
    canonicalTerm: 'Next.js',
    contextClues: [/\b(?:react|framework|frontend|tutorial|search)\b/i],
    clarificationQuestion: "Did you mean 'Next.js'?"
  }
]

/**
 * Analyzes spoken user input to identify technical keywords, phonetic collisions,
 * and potential ambiguities.
 */
export function analyzeSpokenInput(
  rawTranscript: string,
  context?: { conversationHistory?: string[] }
): IntentAnalysisResult {
  if (!rawTranscript || typeof rawTranscript !== 'string') {
    return {
      originalTranscript: '',
      hasAmbiguity: false,
      confidence: 'high',
      detectedTerms: [],
      isPhoneticCollision: false,
      hasPhoneticCollision: false,
      shouldClarify: false
    }
  }

  const trimmed = rawTranscript.trim()
  const detectedTerms: string[] = []

  // Check for clean technical terms already present
  for (const term of TECHNICAL_TERMS) {
    const regex = new RegExp(`\\b${term.replace('.', '\\.')}\\b`, 'i')
    if (regex.test(trimmed)) {
      detectedTerms.push(term)
    }
  }

  // Check for phonetic collisions
  for (const rule of PHONETIC_RULES) {
    if (rule.pattern.test(trimmed)) {
      // Check if context clues (like "search", "youtube", "best") support technical intent
      const hasClue = rule.contextClues.some(clue => clue.test(trimmed))

      // If the query contains words like "search youtube for the best reactor to real":
      // "reactor to real" is an unambiguous phonetic corruption of "React tutorials".
      const repaired = trimmed.replace(rule.pattern, rule.canonicalTerm)
      
      // If clues are strongly aligned with a web search / programming query:
      // High confidence for technical repair, but flag ambiguity if user might literally mean "reactor"
      const isLiteralReactorQuery = /\b(?:nuclear|chemical|power\s+plant|physics)\b/i.test(trimmed)

      if (isLiteralReactorQuery) {
        // User could genuinely mean a physical reactor
        return {
          originalTranscript: trimmed,
          hasAmbiguity: true,
          confidence: 'medium',
          detectedTerms: [rule.canonicalTerm],
          suggestedQuery: repaired,
          suggestedClarification: rule.clarificationQuestion,
          isPhoneticCollision: true,
          hasPhoneticCollision: true,
          shouldClarify: true
        }
      }

      // Strong search / developer context (e.g. "search for the best reactor to real")
      return {
        originalTranscript: trimmed,
        hasAmbiguity: true,
        confidence: hasClue ? 'high' : 'medium',
        detectedTerms: [rule.canonicalTerm],
        suggestedQuery: repaired,
        suggestedClarification: rule.clarificationQuestion,
        isPhoneticCollision: true,
        hasPhoneticCollision: true,
        shouldClarify: !hasClue // If clue is strong ("search youtube for the best..."), interpret appropriately; else clarify
      }
    }
  }

  return {
    originalTranscript: trimmed,
    hasAmbiguity: false,
    confidence: 'high',
    detectedTerms,
    suggestedQuery: trimmed,
    isPhoneticCollision: false,
    hasPhoneticCollision: false,
    shouldClarify: false
  }
}

/**
 * Checks if a string contains any recognized technical term.
 */
export function containsTechnicalTerm(text: string): boolean {
  if (!text || typeof text !== 'string') return false
  return TECHNICAL_TERMS.some(term => new RegExp(`\\b${term.replace('.', '\\.')}\\b`, 'i').test(text))
}

/**
 * Returns any matching phonetic collision rules for a string.
 */
export function detectPhoneticCollisions(text: string): PhoneticRule[] {
  if (!text || typeof text !== 'string') return []
  return PHONETIC_RULES.filter(rule => rule.pattern.test(text))
}

export interface RepeatIntentAnalysis {
  isExplicitRepeat: boolean
  actionType?: 'reload' | 'reopen' | 'refresh' | 'navigate_again'
  targetSubject?: string
}

/**
 * Identifies explicit user intent to repeat navigation, reload, or reopen a page.
 * Distinguishes intentional repeated navigation from accidental autonomous duplicate loops
 * and conversational idioms (e.g. "refresh my memory about React").
 */
export function detectExplicitRepeatIntent(userInput: string): RepeatIntentAnalysis {
  if (!userInput || typeof userInput !== 'string') {
    return { isExplicitRepeat: false }
  }

  const text = userInput.trim().toLowerCase()

  // 1. Guard against conversational / memory recall idioms:
  // e.g. "refresh my memory about React", "refresh me on React", "refresh our memory about the project"
  if (/\brefresh\s+(?:(?:my|our|the)\s+memory|me\s+on)\b/i.test(text)) {
    return { isExplicitRepeat: false }
  }

  // 2. Explicit reload / refresh patterns (browser tab, page, website, or site name):
  // e.g. "reload the current page", "refresh page", "refresh tab", "reload website", "refresh youtube", "reload github"
  const reloadMatch = text.match(/\b(?:reload|refresh)\s+(?:the\s+)?(?:current\s+)?(page|tab|website)(?:\s+(.+))?/i) ||
                      text.match(/\b(?:reload|refresh)\s+([a-z0-9_.-]+(?:\.[a-z]{2,})?)\b/i) ||
                      text.match(/^(?:reload|refresh)(?:\s+(?:the\s+)?(?:page|tab|website))?[.!?]?$/i)

  if (reloadMatch) {
    const rawTarget = reloadMatch[2] || reloadMatch[1]
    const target = (rawTarget && !['page', 'tab', 'website'].includes(rawTarget.toLowerCase())) ? rawTarget.trim() : undefined
    return {
      isExplicitRepeat: true,
      actionType: 'reload',
      targetSubject: target
    }
  }

  // 3. Explicit "again" / "once more" patterns (e.g. "open github again", "navigate to youtube again", "open the same url again")
  const repeatMatch = text.match(/\b(?:open|navigate\s+to|go\s+to|visit|launch)\s+(.+?)\s+(?:again|once\s+more|one\s+more\s+time)\b/i) ||
                      text.match(/\b(?:again|once\s+more)\s+(?:open|navigate\s+to|go\s+to)\s+(.+)/i)
  if (repeatMatch) {
    return {
      isExplicitRepeat: true,
      actionType: 'navigate_again',
      targetSubject: (repeatMatch[1] || '').trim()
    }
  }

  // 4. Explicit "reopen" patterns (e.g. "reopen github", "re-open the tab")
  const reopenMatch = text.match(/\b(?:reopen|re-open)\s+(.+)/i)
  if (reopenMatch) {
    return {
      isExplicitRepeat: true,
      actionType: 'reopen',
      targetSubject: reopenMatch[1].trim()
    }
  }

  return { isExplicitRepeat: false }
}
