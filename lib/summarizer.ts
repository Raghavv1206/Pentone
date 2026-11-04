// Conversation summarization using Chrome's built-in Summarizer API with LanguageModel fallback
import type { Message } from './messages'
import { 
  SUMMARIZER_SHARED_CONTEXT, 
  SUMMARIZER_CONTEXT_PROMPT, 
  formatSummaryMessage 
} from './prompts/summarizer-prompts'
import { formatTaskStateForSummary, formatTaskStateForPrompt, type ActiveTaskState } from './task-state'

// Re-export for convenience
export { formatSummaryMessage }

export const MAX_CONTEXT_SIZE = 9216
export const PROACTIVE_CONTEXT_LIMIT = 5500 // Proactive compaction threshold (~60% of context window)
export const CONTEXT_RESERVE_TOKENS = MAX_CONTEXT_SIZE - PROACTIVE_CONTEXT_LIMIT // 3716 tokens of guaranteed reserve
export const SAFE_CONTEXT_LIMIT = PROACTIVE_CONTEXT_LIMIT

// Genuine context budget for local SLM (SmolLM-135M-Instruct: max_position_embeddings = 2048)
export const LOCAL_SLM_CONTEXT_LIMIT = 2048
export const LOCAL_SLM_PROACTIVE_LIMIT = 1500 // Compaction threshold leaving 548 tokens for generation
export const LOCAL_SLM_RESERVE_TOKENS = LOCAL_SLM_CONTEXT_LIMIT - LOCAL_SLM_PROACTIVE_LIMIT // 548 tokens

/**
 * Returns the proactive compaction threshold based on the model's effective context quota.
 * For local SLM (2048 tokens), threshold is 1500 tokens (leaving ~548 tokens for generation).
 * For native Gemini Nano (9216 tokens), threshold is 5500 tokens.
 */
export function getProactiveThreshold(quota: number = MAX_CONTEXT_SIZE): number {
  if (quota <= LOCAL_SLM_CONTEXT_LIMIT) {
    return LOCAL_SLM_PROACTIVE_LIMIT
  }
  return PROACTIVE_CONTEXT_LIMIT
}

/**
 * Baseline tokens allocated for system prompt, tool schemas, and page element dumps
 * when dynamic system prompt text is not provided directly.
 */
export const DEFAULT_SYSTEM_PROMPT_ESTIMATED_TOKENS = 1200

/**
 * Conservative heuristic tokenizer:
 * In typical LLM tokenizers (such as Gemma/BPE), code, JSON structures, CSS selectors,
 * and punctuation average 3.0-3.5 characters per token.
 * To guarantee fail-safe headroom below the 9,216 quota, we estimate tokens as Math.ceil(text.length / 3.0).
 * Note: This is an empirical conservative heuristic, not a guaranteed exact BPE tokenizer.
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 3.0)
}

export interface AssembledContextComponents {
  messages: Message[]
  systemPromptText?: string | null
  activeTask?: ActiveTaskState | null
  activeTabUrl?: string | null
  pageContextText?: string | null
  serializedToolPayload?: string | null
}

export interface EstimatedContextBreakdown {
  totalEstimatedTokens: number
  systemTokens: number
  messageTokens: number
  taskTokens: number
  pageContextTokens: number
  toolPayloadTokens: number
}

/**
 * Calculates a conservative estimate of the entire assembled prompt context
 * that has been (or will be) fed into the LLM session.
 *
 * Accounts for:
 * 1. System instructions (template, current date/time, tool schemas, page elements).
 * 2. Active non-visual conversation messages (excluding visualOnly / pruned messages).
 * 3. Active task state (objective, completed actions, pending actions, variables).
 * 4. Current tab URL and page context text (if not already embedded in messages).
 * 5. Serialized tool results and payloads.
 *
 * Avoids double-counting components already captured in message contents.
 */
export function estimateAssembledContextTokens(components: AssembledContextComponents): EstimatedContextBreakdown {
  // 1. System instructions
  const systemTokens = components.systemPromptText
    ? estimateTextTokens(components.systemPromptText)
    : DEFAULT_SYSTEM_PROMPT_ESTIMATED_TOKENS

  // 2. Active conversation messages (strict filter: exclude visualOnly)
  const nonVisualMessages = (components.messages || []).filter(m => !m.visualOnly)
  let rawMessageChars = 0
  for (const msg of nonVisualMessages) {
    if (msg.content) {
      let content = msg.content
      // Truncate base64 artifacts identically to how prompt is sent to AI
      if (content.includes('data:image/')) {
        content = content.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, '...[IMAGE_TRUNCATED]...')
      }
      if (content.includes('data:audio/')) {
        content = content.replace(/data:audio\/[^;]+;base64,[A-Za-z0-9+/=]+/g, '...[AUDIO_TRUNCATED]...')
      }
      rawMessageChars += content.length
    }
  }
  const messageTokens = estimateTextTokens(rawMessageChars > 0 ? ' '.repeat(rawMessageChars) : '')

  // 3. Active task state
  let taskTokens = 0
  if (components.activeTask) {
    const formattedTask = formatTaskStateForPrompt(components.activeTask)
    taskTokens = estimateTextTokens(formattedTask)
  }

  // 4. Page context & active URL (only if not already embedded in task or messages)
  let pageContextTokens = 0
  if (components.pageContextText) {
    const alreadyPresent = nonVisualMessages.some(m => m.content?.includes(components.pageContextText!))
    if (!alreadyPresent) {
      pageContextTokens += estimateTextTokens(components.pageContextText)
    }
  }
  if (components.activeTabUrl && !components.activeTask?.activeTabUrl) {
    pageContextTokens += estimateTextTokens(`URL: ${components.activeTabUrl}`)
  }

  // 5. Serialized tool payload (only if not already recorded in tool result messages)
  let toolPayloadTokens = 0
  if (components.serializedToolPayload) {
    const alreadyPresent = nonVisualMessages.some(m => m.content?.includes(components.serializedToolPayload!))
    if (!alreadyPresent) {
      toolPayloadTokens += estimateTextTokens(components.serializedToolPayload)
    }
  }

  const totalEstimatedTokens = systemTokens + messageTokens + taskTokens + pageContextTokens + toolPayloadTokens

  return {
    totalEstimatedTokens,
    systemTokens,
    messageTokens,
    taskTokens,
    pageContextTokens,
    toolPayloadTokens
  }
}

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

  // Keep last 2 tool results intact; prune older ones if they exceed 120 characters
  const recentThreshold = 2
  const indicesToPrune = toolResultIndices.slice(0, Math.max(0, toolResultIndices.length - recentThreshold))

  return messages.map((msg, idx) => {
    if (indicesToPrune.includes(idx) && msg.content.length > 120) {
      const preview = msg.content.slice(0, 100)
      return {
        ...msg,
        content: `${preview}...\n[Earlier tool result truncated to conserve context tokens]`
      }
    }
    return msg
  })
}

export interface CompactionOutcome {
  readonly summary: string
  readonly retainedRecentMessages: Message[]
  readonly prunedCount: number
  readonly estimatedTokensBefore: number
  readonly estimatedTokensAfter: number
}

/**
 * Partitions conversation messages into:
 * 1. The most recent 3 conversational turns (retained in full).
 * 2. Older messages to be compacted and pruned.
 */
export function partitionMessagesForCompaction(messages: Message[]): {
  olderMessages: Message[]
  recentMessages: Message[]
} {
  // Find indices of user messages from end to beginning
  const userIndices: number[] = []
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      userIndices.push(i)
      if (userIndices.length === 3) break
    }
  }

  // If 3 or fewer user turns exist, keep all messages as recent
  if (userIndices.length < 3) {
    return { olderMessages: [], recentMessages: [...messages] }
  }

  const splitIndex = userIndices[userIndices.length - 1]
  return {
    olderMessages: messages.slice(0, splitIndex),
    recentMessages: messages.slice(splitIndex),
  }
}

/**
 * Executes bounded incremental context compaction:
 * - Retains the active task and current browser state.
 * - Retains the most recent 3 conversational turns in full.
 * - Compacts older history incrementally into a single concise summary.
 * - Prevents repeatedly summarizing the entire conversation history.
 */
export async function executeIncrementalCompaction(
  allMessages: Message[],
  activeTask?: ActiveTaskState | null
): Promise<CompactionOutcome> {
  const nonVisual = allMessages.filter(m => !m.visualOnly)
  const tokensBefore = nonVisual.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0)

  const { olderMessages, recentMessages } = partitionMessagesForCompaction(nonVisual)

  if (olderMessages.length === 0) {
    return {
      summary: '',
      retainedRecentMessages: recentMessages,
      prunedCount: 0,
      estimatedTokensBefore: tokensBefore,
      estimatedTokensAfter: tokensBefore,
    }
  }

  // Summarize older messages only (never re-summarizes recent turns)
  const summary = await summarizeConversation(olderMessages, activeTask)
  const summaryTokens = Math.ceil(summary.length / 4)
  const recentTokens = recentMessages.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0)
  const tokensAfter = summaryTokens + recentTokens

  return {
    summary,
    retainedRecentMessages: recentMessages,
    prunedCount: olderMessages.length,
    estimatedTokensBefore: tokensBefore,
    estimatedTokensAfter: tokensAfter,
  }
}

async function summarizeWithPromptAPI(conversationText: string): Promise<string> {
  const scope = getGlobalScope()
  const lm = scope.LanguageModel || scope.ai?.languageModel
  if (!lm) {
    throw new Error('Neither Summarizer API nor LanguageModel API is available for conversation compaction')
  }

  const session = await lm.create({
    systemPrompt: `${SUMMARIZER_SHARED_CONTEXT}. ${SUMMARIZER_CONTEXT_PROMPT}`,
    outputLanguage: 'en',
    expectedOutputLanguage: 'en',
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
