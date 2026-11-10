// Sentence parser & streaming speech chunker for natural, fluent TTS
export interface SpeechChunkResult {
  chunk: string
  consumedChars: number
}

// Common abbreviations in English to avoid splitting on false sentence boundaries
const ABBREVIATIONS = new Set([
  'e.g', 'i.e', 'etc', 'vs', 'dr', 'mr', 'mrs', 'ms', 'prof', 'sr', 'jr', 'approx', 'inc', 'ltd', 'corp'
])

// Kept for backward compatibility
export const SHORT_START_WORDS = new Set([
  'hi', 'hey', 'hello', 'ok', 'okay', 'yes', 'yep', 'yeah', 'sure', 'no', 'nope',
  'i', "i'll", "i'm", "i've", 'we', "we'll", 'it', "it's", 'on', 'in', 'at',
  'so', 'now', 'done', 'fine', 'good', 'well', 'here', 'look', 'see', 'let',
  'wait', 'got', 'just', 'all', 'alright'
])

function isTerminalPunctuation(char: string): boolean {
  return char === '.' || char === '!' || char === '?' || char === '।' || char === '॥'
}

/**
 * Extract next speakable sentence or natural clause chunk from text stream for TTS.
 * 
 * Ensures natural human speech flow without breaking sentences into isolated single words
 * (such as "I've", "I'm", or "and"), eliminating unwanted pauses and intonation resets.
 * Complete sentences (ending in . ! ? or \n) and standalone exclamations (e.g. "Hello!", "Done.")
 * start speaking as soon as generated while preserving full sentence prosody.
 */
export function extractNextSpeechChunk(
  text: string,
  _isFirstChunk?: boolean
): SpeechChunkResult | null {
  if (!text || !text.trim()) return null

  // Strip leading formatting/whitespace/emojis but track offset so consumedChars advances accurately
  const leadingMatch = text.match(/^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}*#_`~>\-]+/u)
  const leadingOffset = leadingMatch ? leadingMatch[0].length : 0
  const trimmed = text.slice(leadingOffset)

  if (!trimmed) return null

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i]

    // Newline indicates a natural sentence/line/paragraph break ONLY IF
    // it ends in punctuation OR forms a complete independent thought (>= 3 words)
    // without ending in an open conjunction or contraction.
    // Stray newlines inside a clause (e.g. after "I've\n" or "and\n") are treated as whitespace.
    if (char === '\n') {
      const sentenceCandidate = trimmed.slice(0, i).trim()
      const words = sentenceCandidate.split(/\s+/).filter(Boolean)
      const endsInPunct = sentenceCandidate.length > 0 && isTerminalPunctuation(sentenceCandidate[sentenceCandidate.length - 1])
      
      const endsInContinuation = /\b(?:and|or|but|so|because|to|for|of|with|in|on|at|by|from|that|which|who|where|when|if|as|than|like|about|into|through|after|before|i'm|i've|i'll|it's|that's)\s*$/i.test(sentenceCandidate)

      if (sentenceCandidate.length > 0 && (endsInPunct || (words.length >= 3 && !endsInContinuation))) {
        const after = trimmed.slice(i)
        const trailingWs = after.match(/^[\r\n\s]+/)?.[0] || ''
        return {
          chunk: sentenceCandidate,
          consumedChars: leadingOffset + i + trailingWs.length
        }
      }
      continue
    }

    if (isTerminalPunctuation(char)) {
      // 1. Check for ellipsis: ... or ..
      if (trimmed[i + 1] === '.' || (i > 0 && trimmed[i - 1] === '.')) {
        continue
      }

      // 2. Check if period inside decimal or version (e.g. 3.5, 1.0, v2.4)
      if (char === '.') {
        const isPrevDigit = i > 0 && /\d/.test(trimmed[i - 1])
        const isNextDigit = i + 1 < trimmed.length && /\d/.test(trimmed[i + 1])
        if (isPrevDigit && isNextDigit) {
          continue
        }

        // 3. Check for abbreviations (e.g. "e.g.", "i.e.", "Dr.", "Mr.")
        const textUpToPunct = trimmed.slice(0, i + 1)
        if (/(?:^|\s)(?:[a-z]\.[a-z]|e\.g|i\.e|etc|vs|dr|mr|mrs|ms|prof|sr|jr|approx)\.$/i.test(textUpToPunct)) {
          continue
        }
      }

      // Check if this punctuation mark is followed by boundary: whitespace, emoji, quotes, brackets, or end of string
      const afterPunct = trimmed.slice(i + 1)
      const isAtEnd = afterPunct.length === 0
      const isFollowedByBoundary = /^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}"')\]]/u.test(afterPunct)

      if (isAtEnd || isFollowedByBoundary) {
        // Collect any consecutive punctuation (e.g. "?!", "!!", "??")
        let punctEnd = i + 1
        while (punctEnd < trimmed.length && isTerminalPunctuation(trimmed[punctEnd])) {
          punctEnd++
        }

        // Include any closing quotes, brackets, or parentheses directly attached to the punctuation
        const closingSymbols = trimmed.slice(punctEnd).match(/^["'’”)\]]+/u)?.[0] || ''
        punctEnd += closingSymbols.length

        // Collect trailing emojis and whitespace
        const trailingAfterPunct = trimmed.slice(punctEnd)
        const trailingMatch = trailingAfterPunct.match(/^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}]*/u)?.[0] || ''
        const chunk = trimmed.slice(0, punctEnd).trim()

        if (chunk.length > 0) {
          return {
            chunk,
            consumedChars: leadingOffset + punctEnd + trailingMatch.length
          }
        }
      }
    }
  }

  // Safety fallback: if an unbroken run-on clause is extraordinarily long (> 160 chars) without terminal punctuation,
  // split at a natural major clause boundary (; or : or ,) with at least 40 chars so speech is never indefinitely blocked
  if (trimmed.length > 160) {
    const clauseMatch = trimmed.slice(40, 150).match(/([;:—]|,\s+(?:and|but|or|so|because|although|while)\s+)/i)
    if (clauseMatch && clauseMatch.index !== undefined) {
      const splitIdx = 40 + clauseMatch.index + (clauseMatch[1].startsWith(',') ? 1 : clauseMatch[1].length)
      const chunk = trimmed.slice(0, splitIdx).trim()
      const after = trimmed.slice(splitIdx)
      const trailingWs = after.match(/^\s+/)?.[0] || ''
      if (chunk.length > 0) {
        return {
          chunk,
          consumedChars: leadingOffset + splitIdx + trailingWs.length
        }
      }
    }
  }

  return null
}

export function splitIntoSentences(text: string): string[] {
  if (!text || !text.trim()) return []

  const sentences: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    const res = extractNextSpeechChunk(remaining)
    if (!res || res.consumedChars <= 0) break
    if (res.chunk.trim()) {
      sentences.push(res.chunk.trim())
    }
    remaining = remaining.slice(res.consumedChars)
  }

  // If there is any trailing text that did not terminate with punctuation, include it if non-empty
  if (remaining.trim()) {
    sentences.push(remaining.trim())
  }

  return sentences.filter(s => s.length > 0)
}

export function getCompleteSentences(text: string): string {
  const sentences = splitIntoSentences(text)
  return sentences.join(' ')
}
