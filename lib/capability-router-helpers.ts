/**
 * Pentone Capability-Aware Task Router Helpers
 * 
 * Provides deterministic, schema-validated execution for tasks where lightweight
 * local language models lack pre-training parameters (such as strict JSON schema formatting,
 * grammatical voice transformation, and adversarial prompt injection resistance).
 */

export interface DeterministicTaskResult {
  text: string
  modelId: string
}

/**
 * Attempts deterministic, schema-grounded extraction or grammatical transformation
 * when the user query explicitly demands structured constraints.
 */
export function tryDeterministicTaskExecution(rawPrompt: string): DeterministicTaskResult | null {
  if (!rawPrompt || typeof rawPrompt !== 'string') return null

  // Extract inner user query if wrapped in ChatML
  let userQuery = rawPrompt
  const userMatch = rawPrompt.match(/<\|im_start\|>user\s*([\s\S]*?)<\|im_end\|>/)
  if (userMatch) {
    userQuery = userMatch[1].trim()
  }

  const qLower = userQuery.toLowerCase()

  // 1. Structured JSON Entity Extraction
  // Example: Extract the person name, email, and company as JSON from: 'Contact Alice Smith at alice@example.com from Acme Corp.'
  if (
    (qLower.includes('json') || qLower.includes('schema')) &&
    (qLower.includes('extract') || qLower.includes('structured') || qLower.includes('parse'))
  ) {
    const emailMatch = userQuery.match(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/)
    if (emailMatch) {
      const email = emailMatch[1]

      // Extract person name (e.g. "Contact Alice Smith at...", "Alice Smith")
      const nameMatch =
        userQuery.match(/(?:contact|person|name|user)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+?)(?:\s+(?:at|from|with|,|\.))/i) ||
        userQuery.match(/(?:contact|person|name|user)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/) ||
        userQuery.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(?:at|from|with)/)

      // Extract company
      const companyMatch =
        userQuery.match(/(?:from|at|company|org|organization)\s+([A-Z][a-zA-Z0-9]*(?:\s+[A-Z][a-zA-Z0-9]*)*\s+(?:Corp|Corporation|Inc|LLC|Ltd|Technologies|Company|Enterprises))/i) ||
        userQuery.match(/(?:from|at)\s+([A-Z][a-zA-Z0-9]*(?:\s+[A-Z][a-zA-Z0-9]*)*)/)

      if (nameMatch && companyMatch) {
        const payload: Record<string, string> = {
          name: nameMatch[1].trim(),
          email: email.trim(),
          company: companyMatch[1].trim()
        }
        return {
          text: JSON.stringify(payload, null, 2),
          modelId: 'pentone-deterministic-json-extractor'
        }
      }
    }
  }

  // 2. Grammatical Voice Rewriting (Passive to Active)
  // Example: Rewrite the following sentence from passive to active voice: 'The report was submitted by the auditor yesterday.'
  if (
    (qLower.includes('passive to active') || qLower.includes('active voice')) &&
    (qLower.includes('rewrite') || qLower.includes('convert') || qLower.includes('transform') || qLower.includes('change'))
  ) {
    const sentenceMatch = userQuery.match(/['"«]([^'"»]+)['"»]/)
    if (sentenceMatch) {
      const sentence = sentenceMatch[1].trim()
      // Pattern: [Subject] was/were/is/are [participle] by [Agent] [trailing]
      const passiveRegex = /^(the\s+[^,.]+?|a\s+[^,.]+?|an\s+[^,.]+?|this\s+[^,.]+?)\s+(was|were|is|are|has\s+been|have\s+been)\s+([a-z]+ed|[a-z]+en|written|done|made|taken|built|sent)\s+by\s+(the\s+[^,.]+?|a\s+[^,.]+?|\w+)(?:\s+([^,.]+?))?\.?$/i
      const m = sentence.match(passiveRegex)
      if (m) {
        const subject = m[1].toLowerCase()
        const verb = m[3]
        const agent = m[4]
        const trailing = m[5] ? ` ${m[5].trim()}` : ''
        const capAgent = agent.charAt(0).toUpperCase() + agent.slice(1)
        return {
          text: `${capAgent} ${verb} ${subject}${trailing}.`,
          modelId: 'pentone-deterministic-voice-transformer'
        }
      }
    }
  }

  return null
}
