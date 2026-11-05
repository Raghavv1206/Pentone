// Prompts for conversation summarization

export const SUMMARIZER_SHARED_CONTEXT = 'This is a conversation between a user and an AI browser automation assistant'

export const SUMMARIZER_CONTEXT_PROMPT = 
  'Create a concise summary focusing on: ' +
  '1) What task or tasks the user requested, ' +
  '2) What specific actions the assistant has already executed and their outcomes, ' +
  '3) Any key data, preferences, or findings mentioned, ' +
  '4) What remaining steps or questions need to be addressed next.'

export function formatSummaryMessage(summary: string): string {
  return `[CONTEXT SUMMARIZED - Previous conversation]\n\n${summary}\n\n---\n\nContinue assisting the user based on the context summary above. If there are pending actions, proceed with them directly.`
}
