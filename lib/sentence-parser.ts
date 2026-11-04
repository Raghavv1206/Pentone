// Sentence parser - splits text into complete natural sentences for TTS streaming
const isCompleteSentence = (s: string): boolean => {
  const t = s.trim()
  if (!t) return false
  // Never treat ellipses as end of sentence in streaming
  if (/\.\.\.$/.test(t)) return false
  // Complete if it ends with terminal punctuation (. ! ?), optionally followed by quotes, brackets, or emojis
  // E.g.: "Hello!", "Hello! 😊", "How can I help you? 😊", "It is done. 👍"
  return /[.!?]+[\s\p{Emoji}\p{Extended_Pictographic}"')\]]*$/u.test(t)
}

export function splitIntoSentences(text: string): string[] {
  if (!text || !text.trim()) return []

  const lines = text.split(/\n+/).filter(line => line.trim().length > 0)
  const sentences: string[] = []

  for (const line of lines) {
    // Split on terminal punctuation followed by whitespace or emoji/quote or end of line
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
