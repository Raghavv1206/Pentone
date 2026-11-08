// Conversation summarization using Chrome's built-in Summarizer API with LanguageModel fallback
import type { Message } from './messages'
import { 
  SUMMARIZER_SHARED_CONTEXT, 
  SUMMARIZER_CONTEXT_PROMPT, 
  formatSummaryMessage 
} from './prompts/summarizer-prompts'
import {
  getLanguageModelAPI,
  getSummarizerAPI,
  checkLanguageModelAvailability,
  checkSummarizerAvailability,
  createLMSession,
  createSummarizerSession
} from './chrome-ai-helpers'

// Re-export for convenience
export { formatSummaryMessage }

export const MAX_CONTEXT_SIZE = 4096
const SUMMARIZATION_THRESHOLD = 0.7 // 70%

export function shouldSummarize(currentTokens: number, quota: number = 4096): boolean {
  const limit = quota > 0 ? quota : MAX_CONTEXT_SIZE
  return currentTokens >= limit * SUMMARIZATION_THRESHOLD
}

export async function summarizeConversation(messages: Message[]): Promise<string> {
  // Format conversation for summarization
  const conversationText = messages
    .map(msg => {
      let content = msg.content

      // Truncate base64 images
      if (content.includes('data:image/')) {
        content = content.replace(
          /data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g,
          (match) => {
            const preview = match.substring(0, 50)
            return `${preview}... [IMAGE_TRUNCATED_${match.length}_CHARS]`
          }
        )
      }

      // Truncate base64 audio
      if (content.includes('data:audio/')) {
        content = content.replace(
          /data:audio\/[^;]+;base64,[A-Za-z0-9+/=]+/g,
          (match) => {
            const preview = match.substring(0, 50)
            return `${preview}... [AUDIO_TRUNCATED_${match.length}_CHARS]`
          }
        )
      }

      return `${msg.role.toUpperCase()}: ${content}`
    })
    .join('\n\n')

  // PATH 1: Try Chrome's dedicated Summarizer API if available
  const Summarizer = getSummarizerAPI()
  if (Summarizer && typeof Summarizer.create === 'function') {
    try {
      const summarizerAvail = await checkSummarizerAvailability(Summarizer, {
        sharedContext: SUMMARIZER_SHARED_CONTEXT,
        type: 'key-points',
        format: 'plain-text',
        length: 'medium',
        outputLanguage: 'en'
      })
      
      if (summarizerAvail === 'available' || summarizerAvail === 'after-download') {
        const summarizer = await createSummarizerSession(Summarizer, {
          sharedContext: SUMMARIZER_SHARED_CONTEXT,
          type: 'key-points',
          format: 'plain-text',
          length: 'medium',
          outputLanguage: 'en'
        })

        const summary = await summarizer.summarize(conversationText, {
          context: SUMMARIZER_CONTEXT_PROMPT
        })

        summarizer.destroy?.()
        if (summary) return summary
      }
    } catch (summarizerErr) {
      console.warn('[summarizer] Dedicated Summarizer API failed, falling back to Prompt API:', summarizerErr)
    }
  }

  // PATH 2: Universal Fallback using Gemini Nano Prompt API (LanguageModel)
  const LM = getLanguageModelAPI()
  if (LM) {
    try {
      const lmAvail = await checkLanguageModelAvailability(LM)
      if (lmAvail === 'available' || lmAvail === 'after-download') {
        const session = await createLMSession(LM, {
          systemPrompt: `${SUMMARIZER_SHARED_CONTEXT}\n${SUMMARIZER_CONTEXT_PROMPT}`
        })

        const summary = await session.prompt(`Please summarize this chat conversation:\n\n${conversationText.slice(0, 15000)}`)
        session.destroy?.()
        if (summary) return summary
      }
    } catch (promptErr) {
      console.error('[summarizer] LanguageModel summarization failed:', promptErr)
    }
  }

  // PATH 3: Resilient structural fallback
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || ''
  return `Summary of previous discussion: The user previously requested assistance regarding "${lastUserMsg.slice(0, 120)}...". Context continues seamlessly.`
}
