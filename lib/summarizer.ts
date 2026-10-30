// Conversation summarization using Chrome's built-in Summarizer API with LanguageModel fallback
import type { Message } from './messages'
import { 
  SUMMARIZER_SHARED_CONTEXT, 
  SUMMARIZER_CONTEXT_PROMPT, 
  formatSummaryMessage 
} from './prompts/summarizer-prompts'
import { formatTaskStateForSummary, type ActiveTaskState } from './task-state'

// Re-export for convenience
export { formatSummaryMessage }

export const MAX_CONTEXT_SIZE = 9216
export const PROACTIVE_CONTEXT_LIMIT = 5500 // Proactive compaction threshold (~60% of context window)
export const CONTEXT_RESERVE_TOKENS = MAX_CONTEXT_SIZE - PROACTIVE_CONTEXT_LIMIT // 3716 tokens of guaranteed reserve
export const SAFE_CONTEXT_LIMIT = PROACTIVE_CONTEXT_LIMIT

const getGlobalScope = (): any => (typeof self !== 'undefined' ? self : globalThis)

export function shouldSummarize(currentTokens: number, thresholdTokens: number = SAFE_CONTEXT_LIMIT): boolean {
  return currentTokens >= thresholdTokens
}

/**
 * Prunes bulky old tool results in conversation history,
 * preserving only the last 2 tool results in full, and compressing older ones.
 */
export function pruneBulkyToolResults(messages: Message[]): Message[] {
  const toolResultIndices: number[] = []
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].messageType === 'tool_result' || messages[i].content.startsWith('[TOOL RESULT]')) {
      toolResultIndices.push(i)
    }
  }

  // Keep last 2 tool results intact; prune older ones if they exceed 200 characters
  const recentThreshold = 2
  const indicesToPrune = toolResultIndices.slice(0, Math.max(0, toolResultIndices.length - recentThreshold))

  return messages.map((msg, idx) => {
    if (indicesToPrune.includes(idx) && msg.content.length > 200) {
      const preview = msg.content.slice(0, 150)
      return {
        ...msg,
        content: `${preview}...\n[Earlier tool result truncated to conserve context tokens]`
      }
    }
    return msg
  })
}

async function summarizeWithPromptAPI(conversationText: string): Promise<string> {
  const scope = getGlobalScope()
  const lm = scope.LanguageModel || scope.ai?.languageModel
  if (!lm) {
    throw new Error('Neither Summarizer API nor LanguageModel API is available for conversation compaction')
  }

  const session = await lm.create({
    systemPrompt: `${SUMMARIZER_SHARED_CONTEXT}. ${SUMMARIZER_CONTEXT_PROMPT}`,
    expectedOutputs: [{ type: 'text', languages: ['en'] }]
  })

  try {
    const prompt = `Summarize the following conversation history concisely focusing on key user requests, actions taken, and pending state:\n\n${conversationText.slice(0, 5000)}`
    return await session.prompt(prompt)
  } finally {
    session.destroy?.()
  }
}

export async function summarizeConversation(
  messages: Message[], 
  activeTask?: ActiveTaskState | null
): Promise<string> {
  // Prune bulky older tool results first to fit nicely in summarizer prompt
  const prunedMessages = pruneBulkyToolResults(messages)

  // Filter out internal summary messages and error banners to avoid recursive compaction
  const validMessages = prunedMessages.filter(msg => 
    msg.messageType !== 'summary' &&
    !msg.content.startsWith('[CONTEXT SUMMARY') &&
    !msg.content.startsWith('Failed to summarize')
  )

  const taskPrefix = activeTask ? formatTaskStateForSummary(activeTask) : ''

  if (validMessages.length === 0) {
    return taskPrefix || 'Previous conversation history was empty.'
  }

  // Format conversation for summarization
  const conversationText = validMessages
    .map(msg => {
      let content = msg.content

      // Truncate base64 images if any slipped through
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

  const scope = getGlobalScope()
  let summary = ''

  // Attempt Chrome built-in Summarizer API first
  if ('Summarizer' in scope) {
    try {
      const availability = await scope.Summarizer.availability()
      if (availability !== 'unavailable') {
        const summarizer = await scope.Summarizer.create({
          sharedContext: SUMMARIZER_SHARED_CONTEXT,
          type: 'key-points',
          format: 'plain-text',
          length: 'medium',
          outputLanguage: 'en',
          expectedOutputs: [{ type: 'text', languages: ['en'] }],
          monitor(m: any) {
            m.addEventListener('downloadprogress', (e: any) => {
              console.log(`[Summarizer] Download progress: ${e.loaded}/${e.total}`)
            })
          }
        })

        try {
          summary = await summarizer.summarize(conversationText, {
            context: SUMMARIZER_CONTEXT_PROMPT
          })
        } finally {
          summarizer.destroy?.()
        }
      }
    } catch (err) {
      console.warn('[Summarizer] Chrome Summarizer API failed, falling back to Prompt API LanguageModel:', err)
    }
  }

  // Fallback to Prompt API LanguageModel if Summarizer was unavailable or failed
  if (!summary) {
    summary = await summarizeWithPromptAPI(conversationText)
  }

  // Guarantee that active task state is never lost during compaction
  if (taskPrefix) {
    return `${taskPrefix}\n${summary}`
  }

  return summary
}
