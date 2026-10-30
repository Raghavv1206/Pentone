// Prompts for conversation summarization

export const SUMMARIZER_SHARED_CONTEXT = 'This is a conversation between a user and an AI browser automation assistant'

export const SUMMARIZER_CONTEXT_PROMPT = 
  'Create a concise factual summary of the conversation history: ' +
  '1) What task or query the user requested, ' +
  '2) What browser actions have already been completed and their factual results, ' +
  '3) Key facts, preferences, or details provided by the user, ' +
  '4) Current progress or pending user questions. ' +
  'CRITICAL: Summarize only factual conversation history. NEVER invent tasks, field names, or unrequested tool commands.'

export function formatSummaryMessage(summary: string, activeTaskSnippet?: string): string {
  const taskHeader = activeTaskSnippet ? `${activeTaskSnippet.trim()}\n\n` : ''
  return `${taskHeader}[CONTEXT SUMMARY - Previous conversation]\n\n${summary}`
}
