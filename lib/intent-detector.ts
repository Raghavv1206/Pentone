import type { ToolCall } from './tools'

export interface DetectedIntent {
  toolCall: ToolCall
  confirmationText: string
}

const COMMON_SITES: Record<string, string> = {
  youtube: 'https://www.youtube.com',
  google: 'https://www.google.com',
  github: 'https://github.com',
  reddit: 'https://www.reddit.com',
  twitter: 'https://x.com',
  x: 'https://x.com',
  linkedin: 'https://www.linkedin.com',
  wikipedia: 'https://www.wikipedia.org',
  amazon: 'https://www.amazon.com',
  netflix: 'https://www.netflix.com',
  facebook: 'https://www.facebook.com',
  instagram: 'https://www.instagram.com',
  gmail: 'https://mail.google.com',
  chatgpt: 'https://chatgpt.com',
  spotify: 'https://open.spotify.com'
}

/**
 * Checks if the assistant output is a standard model refusal/denial
 * (e.g., Gemini Nano falling back to base training claiming it cannot open applications or browse).
 */
export function isModelRefusal(assistantText: string): boolean {
  if (!assistantText || typeof assistantText !== 'string') return false
  const lower = assistantText.toLowerCase()

  const refusalPhrases = [
    'cannot directly open applications',
    'do not have the capability to directly open',
    'cannot open applications',
    'cannot browse the internet',
    'do not have the ability to browse',
    'as a text-based large language model',
    'as a large language model, i',
    'as an ai language model, i',
    'as a text-based ai',
    'i cannot access real-time',
    'i cannot access the internet',
    'cannot perform live searches',
    'unable to open applications',
    'unable to browse the internet',
    'do not have access to real-time internet',
    'do not have the ability to open',
    'cannot check your open tabs',
    'cannot check open tabs',
    'do not have the ability to perform actions within your web browser',
    'cannot view your screen',
    'cannot see what is currently open on your screen',
    'cannot access those real-time browser functionalities',
    'my capabilities are limited to processing the text',
    'still cannot check your open tabs',
    'cannot check what tabs',
    'i must reiterate that i still cannot'
  ]

  return refusalPhrases.some(phrase => lower.includes(phrase))
}

/**
 * Detects all discrete user task intents in a potentially multi-task prompt.
 */
export function detectIntents(userInput: string): DetectedIntent[] {
  if (!userInput || typeof userInput !== 'string') return []
  const tasks: DetectedIntent[] = []
  let remaining = userInput.trim()

  // 1. YouTube Search
  const ytRegex = /\b(?:open\s+youtube\s+(?:and\s+|to\s+)?search\s+(?:for\s+)?|search\s+(?:for\s+)?(.+?)\s+(?:on|in)\s+youtube|search\s+youtube\s+(?:for\s+)?)(.+?)(?=(?:\s+and\s+|\s+then\s+|,\s*|\s+remember\s+|\s+check\s+|\s+take\s+|\s+summarize\s+|$))/i
  const ytMatch = remaining.match(ytRegex)
  if (ytMatch) {
    let q = (ytMatch[2] || ytMatch[1] || '').trim().replace(/^["']|["']$/g, '').trim()
    if (q) {
      tasks.push({
        toolCall: {
          function: 'openTab',
          arguments: { url: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` }
        },
        confirmationText: `Opening YouTube and searching for "${q}".`
      })
      remaining = remaining.replace(ytMatch[0], ' ')
    }
  }

  // 2. Google Search (if no youtube search)
  if (!ytMatch) {
    const googleRegex = /\b(?:open\s+google\s+(?:and\s+|to\s+)?search\s+(?:for\s+)?|search\s+(?:for\s+)?(.+?)\s+(?:on|in)\s+google|search\s+google\s+(?:for\s+)?)(.+?)(?=(?:\s+and\s+|\s+then\s+|,\s*|\s+remember\s+|\s+check\s+|\s+take\s+|\s+summarize\s+|$))/i
    const gMatch = remaining.match(googleRegex)
    if (gMatch) {
      let q = (gMatch[2] || gMatch[1] || '').trim().replace(/^["']|["']$/g, '').trim()
      if (q) {
        tasks.push({
          toolCall: {
            function: 'openTab',
            arguments: { url: `https://www.google.com/search?q=${encodeURIComponent(q)}` }
          },
          confirmationText: `Searching Google for "${q}".`
        });
        remaining = remaining.replace(gMatch[0], ' ')
      }
    }
  }

  // 3. Direct site open
  const navRegex = /\b(?:open|go\s+to|navigate\s+to)\s+(?!what\b|which\b|my\b|the\b|and\b|this\b)([a-z0-9.-]+)\b/gi
  let navMatch: RegExpExecArray | null
  while ((navMatch = navRegex.exec(remaining)) !== null) {
    const site = navMatch[1].toLowerCase()
    const url = COMMON_SITES[site] || (site.includes('.') && site.length > 3 ? `https://${site}` : null)
    if (url) {
      tasks.push({
        toolCall: { function: 'openTab', arguments: { url } },
        confirmationText: `Opening ${site.charAt(0).toUpperCase() + site.slice(1)}.`
      })
      remaining = remaining.replace(navMatch[0], ' ')
      break
    }
  }

  // 4. Memory retrieval (check BEFORE storeMemory to avoid 'what do you remember' matching store)
  const getMemRegex = /\b(?:what\s+(?:do\s+you\s+)?remember(?:\s+about\s+me)?|show\s+(?:my\s+)?memories|recall\s+memories|check\s+memories)\b/i
  const getMemMatch = remaining.match(getMemRegex)
  if (getMemMatch) {
    tasks.push({
      toolCall: { function: 'getMemories', arguments: {} },
      confirmationText: 'Checking my memories.'
    })
    remaining = remaining.replace(getMemMatch[0], ' ')
  }

  // 5. Memory storage
  const memoryRegex = /\b(?:remember\s+(?:that\s+)?|store\s+(?:in\s+memory\s+|that\s+)?|save\s+(?:to\s+memory\s+|that\s+)?|keep\s+in\s+mind\s+(?:that\s+)?)(.+?)(?=(?:\s+and\s+|\s+then\s+|,\s*|\s+check\s+|\s+take\s+|\s+open\s+|\s+summarize\s+|$))/i
  if (!/\bwhat\s+(?:do\s+you\s+)?remember\b/i.test(remaining)) {
    const memMatch = remaining.match(memoryRegex)
    if (memMatch) {
      const memContent = memMatch[1].trim()
      if (memContent.length > 2) {
        const formatted = memContent.startsWith('I ') || memContent.startsWith('i ')
          ? `User ${memContent.substring(2)}`
          : memContent
        tasks.push({
          toolCall: {
            function: 'storeMemory',
            arguments: {
              content: formatted,
              tags: ['user-preference']
            }
          },
          confirmationText: `Saving to memory that ${memContent}.`
        })
        remaining = remaining.replace(memMatch[0], ' ')
      }
    }
  }

  // 6. Tab listing
  const tabsRegex = /\b(?:check\s+(?:what|which|my)\s+tabs\s+(?:I\s+currently\s+have\s+open|are\s+open|are\s+there)|what\s+tabs\s+(?:do\s+I\s+have\s+open|are\s+open|I\s+currently\s+have\s+open)|list\s+(?:all\s+|my\s+)?(?:open\s+)?tabs|show\s+(?:all\s+|my\s+)?tabs|get\s+tabs)\b/i
  const tabsMatch = remaining.match(tabsRegex)
  if (tabsMatch) {
    tasks.push({
      toolCall: { function: 'getTabs', arguments: {} },
      confirmationText: 'Checking your open tabs.'
    })
    remaining = remaining.replace(tabsMatch[0], ' ')
  }

  // 7. Screenshot
  const screenshotRegex = /\b(?:take\s+a\s+screenshot(?:\s+of\s+this\s+page)?|capture\s+(?:a\s+)?screenshot|capture\s+(?:this\s+)?screen|screenshot\s+this\s+page)\b/i
  const ssMatch = remaining.match(screenshotRegex)
  if (ssMatch) {
    tasks.push({
      toolCall: { function: 'captureScreenshot', arguments: {} },
      confirmationText: 'Capturing a screenshot of the page.'
    })
    remaining = remaining.replace(ssMatch[0], ' ')
  }

  // 8. Page summary
  const summaryRegex = /\b(?:summarize\s+(?:this\s+page|the\s+article|the\s+page|key\s+points)|give\s+me\s+(?:a\s+summary|the\s+key\s+points))\b/i
  const sumMatch = remaining.match(summaryRegex)
  if (sumMatch) {
    tasks.push({
      toolCall: { function: 'summarizePage', arguments: { type: 'key-points' } },
      confirmationText: 'Summarizing this page.'
    })
    remaining = remaining.replace(sumMatch[0], ' ')
  }

  return tasks
}

/**
 * Detects the first unambiguous intent from user text (backward compatibility).
 */
export function detectIntent(userInput: string): DetectedIntent | null {
  const all = detectIntents(userInput)
  return all.length > 0 ? all[0] : null
}
