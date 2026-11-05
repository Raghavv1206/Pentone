// Sentence parser & streaming speech chunker for low-latency TTS
export interface SpeechChunkResult {
  chunk: string
  consumedChars: number
}

// Common short words and conversational openings in English (2-4 characters)
export const SHORT_START_WORDS = new Set([
  'hi', 'hey', 'hello', 'ok', 'okay', 'yes', 'yep', 'yeah', 'sure', 'no', 'nope',
  'i', "i'll", "i'm", "i've", 'we', "we'll", 'it', "it's", 'on', 'in', 'at',
  'so', 'now', 'done', 'fine', 'good', 'well', 'here', 'look', 'see', 'let',
  'wait', 'got', 'just', 'all', 'alright'
])

/**
 * Extract next speakable chunk from text stream for ultra-low latency TTS.
 * 
 * When isFirstChunk is true:
 * Pentone starts speaking as soon as 2-4 characters are generated (e.g. first word
 * with boundary, short greeting/interjection, or opening phrase), reducing speech latency to near-zero.
 * 
 * For subsequent chunks:
 * Splits on natural speech boundaries (punctuation [.!?], phrase pauses [,:;\n—],
 * or natural word boundary at 30-50 characters) so speech continues smoothly without gaps or stutter.
 */
export function extractNextSpeechChunk(
  text: string,
  isFirstChunk: boolean
): SpeechChunkResult | null {
  if (!text || !text.trim()) return null

  // Strip leading formatting/whitespace/emojis but track offset so consumedChars advances accurately
  const leadingPrefixMatch = text.match(/^[\s\p{Emoji}\p{Extended_Pictographic}*#_`~>\-]+/u)
  const leadingOffset = leadingPrefixMatch ? leadingPrefixMatch[0].length : 0
  const trimmed = text.slice(leadingOffset)

  if (!trimmed) return null

  // --- FIRST CHUNK (Ultra-low latency: 2-4 characters / first word) ---
  if (isFirstChunk) {
    if (trimmed.length < 2) {
      return null // Wait for at least 2 characters
    }

    // 1. Immediate punctuation boundary (e.g. "Hi!", "Ok,", "Yes,", "Sure,", "I,")
    const punctMatch = trimmed.match(/^([^\s.,!?:;—\n]{1,15})([.,!?:;—\n]+)/u)
    if (punctMatch) {
      const word = punctMatch[1]
      const punct = punctMatch[2]

      // Check if period is inside decimal or version (e.g. "3.5", "v1.0")
      const isDecimal = punct.includes('.') && /\d$/.test(word) && /^\.\d/.test(trimmed.slice(word.length))
      const isNumComma = punct.includes(',') && /\d$/.test(word) && /^,\d/.test(trimmed.slice(word.length))

      if (!isDecimal && !isNumComma) {
        const chunkCandidate = (word + punct).trim()
        const afterPunct = trimmed.slice(punctMatch[0].length)
        const trailingWs = afterPunct.match(/^[\s\p{Emoji}\p{Extended_Pictographic}"')\]]*/u)?.[0] || ''
        const consumedChars = leadingOffset + punctMatch[0].length + trailingWs.length

        return {
          chunk: chunkCandidate,
          consumedChars
        }
      }
    }

    // 2. First word boundary via whitespace (e.g. "I will", "Hi there", "Yes I", "Opening YouTube")
    const spaceIdx = trimmed.search(/\s/)
    if (spaceIdx !== -1) {
      const firstWord = trimmed.slice(0, spaceIdx).trim()
      if (firstWord.length >= 1) {
        const afterSpace = trimmed.slice(spaceIdx)
        const trailingWs = afterSpace.match(/^\s+/)?.[0] || ''
        const consumedChars = leadingOffset + spaceIdx + trailingWs.length

        return {
          chunk: firstWord,
          consumedChars
        }
      }
    }

    // 3. No whitespace or punctuation yet: check if current 2-4 chars form a complete short word
    if (trimmed.length >= 2 && trimmed.length <= 4) {
      const cleanWord = trimmed.replace(/[^\w']/g, '').toLowerCase()
      if (SHORT_START_WORDS.has(cleanWord)) {
        return {
          chunk: trimmed,
          consumedChars: leadingOffset + trimmed.length
        }
      }
    }

    // If word is still forming (< 20 chars without boundary), wait for word boundary token
    return null
  }

  // --- SUBSEQUENT CHUNKS ---
  // Look for whichever punctuation mark (terminal .!? or phrase pause ,;:—\n) comes FIRST
  // Ensure we don't split on decimal points (3.5) or thousands separators (1,000)
  const punctRegex = /([.!?]+|[,;:\n—]+)(?=[\s\p{Emoji}\p{Extended_Pictographic}"')\]]|$)/u
  const match = trimmed.match(punctRegex)

  if (match && match.index !== undefined) {
    const punctIdx = match.index
    const punctStr = match[0]
    const beforePunct = trimmed.slice(0, punctIdx)

    // Skip if period inside decimal/version number (e.g. 3.5, v1.0)
    const isDecimal = punctStr.includes('.') && /\d$/.test(beforePunct) && /^\.\d/.test(trimmed.slice(punctIdx))
    // Skip if comma inside numbers (e.g. 1,000)
    const isNumComma = punctStr.includes(',') && /\d$/.test(beforePunct) && /^,\d/.test(trimmed.slice(punctIdx))

    if (!isDecimal && !isNumComma) {
      const pEnd = punctIdx + punctStr.length
      const afterPunct = trimmed.slice(pEnd)
      const trailingWs = afterPunct.match(/^[\s\p{Emoji}\p{Extended_Pictographic}"')\]]*/u)?.[0] || ''
      const chunk = trimmed.slice(0, pEnd).trim()
      const consumedChars = leadingOffset + pEnd + trailingWs.length

      return { chunk, consumedChars }
    }
  }

  // Long clause without punctuation: chunk at natural space boundary (30-50 chars)
  if (trimmed.length >= 35) {
    const windowSlice = trimmed.slice(25, 55)
    const spaceInWindow = windowSlice.lastIndexOf(' ')
    if (spaceInWindow !== -1) {
      const splitIdx = 25 + spaceInWindow
      const chunk = trimmed.slice(0, splitIdx).trim()
      const after = trimmed.slice(splitIdx)
      const trailingWs = after.match(/^\s+/)?.[0] || ''
      const consumedChars = leadingOffset + splitIdx + trailingWs.length
      return { chunk, consumedChars }
    }
  }

  return null
}

const isCompleteSentence = (s: string): boolean => {
  const t = s.trim()
  if (!t) return false
  // Never treat ellipses as end of sentence in streaming
  if (/\.\.\.$/.test(t)) return false
  // Complete if it ends with terminal punctuation (. ! ?), optionally followed by quotes, brackets, or emojis
  return /[.!?]+[\s\p{Emoji}\p{Extended_Pictographic}"')\]]*$/u.test(t)
}

export function splitIntoSentences(text: string): string[] {
  if (!text || !text.trim()) return []

  const lines = text.split(/\n+/).filter(line => line.trim().length > 0)
  const sentences: string[] = []

  for (const line of lines) {
    const parts = line.split(/([.!?]+(?:[\s\p{Emoji}\p{Extended_Pictographic}"')\]]+|$))/u)
    let current = ''

    for (let i = 0; i < parts.length; i++) {
      current += parts[i]
      if (isCompleteSentence(current)) {
        const trimmed = current.trim()
        if (trimmed) {
          sentences.push(trimmed)
        }
        current = ''
      }
    }

    if (current.trim() && isCompleteSentence(current)) {
      const trimmed = current.trim()
      if (trimmed) {
        sentences.push(trimmed)
      }
    }
  }

  return sentences.filter(s => s.length > 0)
}

export function getCompleteSentences(text: string): string {
  const sentences = splitIntoSentences(text)
  return sentences.join(' ')
}
