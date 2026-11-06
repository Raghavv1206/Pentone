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
  spotify: 'https://open.spotify.com',
  extensions: 'chrome://extensions',
  extension: 'chrome://extensions',
  settings: 'chrome://settings',
  flags: 'chrome://flags',
  downloads: 'chrome://downloads',
  history: 'chrome://history',
  bookmarks: 'chrome://bookmarks'
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
    'as a large language model',
    'as an ai language model',
    'as an ai, i',
    'as an ai model',
    'as a text-based ai',
    'i am a large language model',
    'i am an ai',
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
    'i must reiterate that i still cannot',
    "i can't do it",
    "i cannot do it",
    "i can't open",
    "i can't browse",
    'closing tabs',
    'such as closing tabs',
    'interact with or control your web browser',
    'interact with or control your web browser or any applications',
    'do not have the ability to interact with or control your web browser',
    'cannot close tabs',
    'cannot close your tabs',
    'cannot close this tab',
    'not have the ability to interact with or control',
    'control your web browser or operating system',
    'do not have direct access to control your web browser',
    'direct access to control your web browser',
    'cannot control your web browser',
    'control your web browser',
    // Chrome extension and local application refusal phrases
    'interact with your local applications',
    'directly interact with your local applications',
    'do not have the capability to directly interact',
    'cannot directly interact with',
    'opening chrome extensions',
    'opening chrome extension',
    'such as opening chrome extensions',
    'to open your chrome extension',
    'you will need to do it manually',
    'clicking on the extension icon',
    'interact with local applications',
    // Search hesitation phrases
    'search is required',
    'a search is required',
    'searching is required'
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

  // 1. YouTube Search (supports "YouTube and search for...", "open YouTube and search for...", "search YouTube for...", "search X on YouTube")
  const ytRegex = /\b(?:(?:open\s+|go\s+to\s+|on\s+)?youtube\s+(?:and\s+|to\s+)?search\s+(?:for\s+)?|search\s+(?:for\s+)?(.+?)\s+(?:on|in)\s+youtube|search\s+youtube\s+(?:for\s+)?)(.+?)(?=(?:\s+(?:and\s+then|then|and\s+also)\s+|\s+and\s+(?:remember|store|save|check|take|open|go\s+to|navigate|summarize|list|find|show|close|shut|kill)\b|,\s*|\s+remember\s+|\s+store\s+in\s+memory|\s+check\s+|\s+take\s+a\s+screenshot|\s+summarize\s+|\s+close\s+|$))/i
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

  // 2. Web / Google Search (supports "search for...", "search...", "look up...", "search Google for...", "search on google for...", etc.)
  if (!ytMatch) {
    const searchRegex = /\b(?:search\s+(?:for\s+|about\s+)?(.+?)\s+(?:on|in)\s+google|(?:open\s+|go\s+to\s+|on\s+)?google\s+(?:and\s+|to\s+)?search\s+(?:for\s+|about\s+)?|google\s+search\s+(?:for\s+|about\s+)?|look\s+up\s+(?:for\s+|about\s+)?|search\s+(?:(?:on\s+|in\s+)?google\s+|the\s+web\s+|the\s+internet\s+|online\s+)?(?:for\s+|about\s+)?(?!this\s+page\b|the\s+page\b|vault\b|memories\b|memory\b|tabs\b|types\b))(.+?)(?=(?:\s+(?:and\s+then|then|and\s+also)\s+|\s+and\s+(?:remember|store|save|check|take|open|go\s+to|navigate|summarize|list|find|show|close|shut|kill|scroll|switch|listen)\b|,\s*|\s+remember\s+|\s+store\s+in\s+memory|\s+check\s+|\s+take\s+a\s+screenshot|\s+summarize\s+|\s+close\s+|$))/i
    const sMatch = remaining.match(searchRegex)
    if (sMatch) {
      let q = (sMatch[1] || sMatch[2] || '').trim().replace(/\s+(?:on|in)\s+google$/i, '').replace(/^["']|["']$/g, '').replace(/[?.!]+$/, '').trim()
      if (q) {
        tasks.push({
          toolCall: {
            function: 'openTab',
            arguments: { url: `https://www.google.com/search?q=${encodeURIComponent(q)}` }
          },
          confirmationText: `Searching Google for "${q}".`
        })
        remaining = remaining.replace(sMatch[0], ' ')
      }
    }
  }

  // 3. Chrome Internal Management Pages (extensions, settings, flags, downloads, history, bookmarks, new tab)
  const chromeDirectUrlRegex = /\b(?:open|go\s+to|navigate\s+to|launch|show)\s+(chrome:\/\/[a-z0-9_/-]+)\b/i
  let directMatch: RegExpExecArray | RegExpMatchArray | null
  while ((directMatch = remaining.match(chromeDirectUrlRegex)) !== null) {
    const rawUrl = directMatch[1].toLowerCase()
    let conf = 'Opening Chrome page.'
    if (rawUrl.includes('extension')) conf = 'Opening extensions management.'
    else if (rawUrl.includes('setting')) conf = 'Opening Chrome settings.'
    else if (rawUrl.includes('flag')) conf = 'Opening Chrome flags.'
    else if (rawUrl.includes('download')) conf = 'Opening downloads.'
    else if (rawUrl.includes('histor')) conf = 'Opening browser history.'
    else if (rawUrl.includes('bookmark')) conf = 'Opening bookmarks.'
    else if (rawUrl.includes('newtab')) conf = 'Opening a new tab.'

    tasks.push({
      toolCall: { function: 'openTab', arguments: { url: rawUrl } },
      confirmationText: conf
    })
    remaining = remaining.replace(directMatch[0], ' ')
  }

  const chromePageRegex = /\b(?:open|go\s+to|navigate\s+to|launch|show)\s+(?:(?:the|a|my)\s+)?(?:chrome\s+)?(?:(?:the|a|my)\s+)?(extensions?(?:\s+management)?(?:\s+page)?|extension\s+management(?:\s+page)?|settings(?:\s+page)?|flags(?:\s+page)?|downloads?(?:\s+page)?|history(?:\s+page)?|bookmarks?(?:\s+page|\s+manager)?|new\s+tab)\b/i
  let pageMatch: RegExpExecArray | RegExpMatchArray | null
  while ((pageMatch = remaining.match(chromePageRegex)) !== null) {
    const pageKey = pageMatch[1].toLowerCase()
    let url = 'chrome://extensions'
    let conf = 'Opening extensions management.'

    if (pageKey.startsWith('setting')) {
      url = 'chrome://settings'
      conf = 'Opening Chrome settings.'
    } else if (pageKey.startsWith('flag')) {
      url = 'chrome://flags'
      conf = 'Opening Chrome flags.'
    } else if (pageKey.startsWith('download')) {
      url = 'chrome://downloads'
      conf = 'Opening downloads.'
    } else if (pageKey.startsWith('histor')) {
      url = 'chrome://history'
      conf = 'Opening browser history.'
    } else if (pageKey.startsWith('bookmark')) {
      url = 'chrome://bookmarks'
      conf = 'Opening bookmarks.'
    } else if (pageKey.startsWith('new')) {
      url = 'chrome://newtab'
      conf = 'Opening a new tab.'
    } else {
      url = 'chrome://extensions'
      conf = 'Opening extensions management.'
    }

    tasks.push({
      toolCall: { function: 'openTab', arguments: { url } },
      confirmationText: conf
    })
    remaining = remaining.replace(pageMatch[0], ' ')
  }

  // 4. Direct site open
  const navRegex = /\b(?:open|go\s+to|navigate\s+to|launch)\s+(?!what\b|which\b|my\b|the\b|and\b|this\b)([a-z0-9.-]+)\b/gi
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
  const memoryRegex = /\b(?:remember\s+(?:that\s+)?|store\s+(?:in\s+memory\s+|that\s+)?|save\s+(?:to\s+memory\s+|that\s+)?|keep\s+in\s+mind\s+(?:that\s+)?)(.+?)(?=(?:\s+(?:and\s+then|then|and\s+also)\s+|\s+and\s+(?:check|take|open|go\s+to|navigate|summarize|list|find|show|close|shut|kill)\b|,\s*|\s+check\s+|\s+take\s+|\s+open\s+|\s+summarize\s+|\s+close\s+|$))/i
  if (!/\bwhat\s+(?:do\s+you\s+)?remember\b/i.test(remaining)) {
    const memMatch = remaining.match(memoryRegex)
    if (memMatch) {
      const memContent = memMatch[1].trim()
      if (memContent.length > 2) {
        const cleanContent = memContent.replace(/^that\s+/i, '').trim()
        const formatted = /^i\s+/i.test(cleanContent)
          ? `User ${cleanContent.substring(2)}`
          : cleanContent
        tasks.push({
          toolCall: {
            function: 'storeMemory',
            arguments: {
              content: formatted,
              tags: ['user-preference']
            }
          },
          confirmationText: `Saving to memory that ${cleanContent}.`
        })
        remaining = remaining.replace(memMatch[0], ' ')
      }
    }
  }

  // 6. Tab listing (supports speech homophones: tabs, types, taps, apps, pages)
  const tabsRegex = /\b(?:check\s+(?:what|which|my)\s+(?:tabs|types|taps|apps|pages)\s+(?:I\s+currently\s+have\s+open|are\s+open|are\s+there|open)|what\s+(?:tabs|types|taps|apps|pages)\s+(?:do\s+I\s+have\s+open|are\s+open|I\s+currently\s+have\s+open)|list\s+(?:all\s+|my\s+)?(?:open\s+)?(?:tabs|types|taps|apps|pages)|show\s+(?:all\s+|my\s+)?(?:tabs|types|taps|apps|pages)|get\s+(?:tabs|types|taps|apps|pages))\b/i
  const tabsMatch = remaining.match(tabsRegex)
  if (tabsMatch) {
    tasks.push({
      toolCall: { function: 'getTabs', arguments: {} },
      confirmationText: 'Checking your open tabs.'
    })
    remaining = remaining.replace(tabsMatch[0], ' ')
  }

  // 6b. Close Tab (supports "close all tabs", "close other tabs", "close tab", "close this tab", "close current tab", "close YouTube tab", "close tab 2", "close YouTube")
  // 1. Close other tabs
  const otherTabsMatch = remaining.match(/\b(?:close|shut|kill)\s+(?:(?:all\s+(?:the\s+)?|every\s+|the\s+)?other\s+tabs?|tabs?\s+except\s+(?:this|current|active)(?:\s+one)?)\b/i)
  if (otherTabsMatch) {
    tasks.push({
      toolCall: { function: 'closeTab', arguments: { other: true } },
      confirmationText: 'Closing other tabs.'
    })
    remaining = remaining.replace(otherTabsMatch[0], ' ')
  } else {
    // 2. Close all tabs
    const allTabsMatch = remaining.match(/\b(?:close|shut|kill)\s+(?:all\s+(?:the\s+|my\s+|open\s+|of\s+my\s+)?tabs?|every\s+tab)\b/i)
    if (allTabsMatch) {
      tasks.push({
        toolCall: { function: 'closeTab', arguments: { all: true } },
        confirmationText: 'Closing all tabs.'
      })
      remaining = remaining.replace(allTabsMatch[0], ' ')
    } else {
      // 3. Tab by number
      const numTabMatch = remaining.match(/\b(?:close|shut|kill)\s+(?:the\s+)?tab\s+(?:number\s+|#)?(\d+)\b/i)
      if (numTabMatch) {
        const idx = parseInt(numTabMatch[1], 10)
        tasks.push({
          toolCall: { function: 'closeTab', arguments: { index: idx } },
          confirmationText: `Closing tab ${idx}.`
        })
        remaining = remaining.replace(numTabMatch[0], ' ')
      } else {
        // 4. Tab by ordinal
        const ordMatch = remaining.match(/\b(?:close|shut|kill)\s+(?:the\s+)?(first|second|third|fourth|fifth)\s+tab\b/i)
        if (ordMatch) {
          const ordMap = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4 }
          const ord = ordMatch[1].toLowerCase()
          const idx = ordMap[ord] ?? 0
          tasks.push({
            toolCall: { function: 'closeTab', arguments: { index: idx } },
            confirmationText: `Closing the ${ord} tab.`
          })
          remaining = remaining.replace(ordMatch[0], ' ')
        } else {
          // 5. Tab by site name (e.g. "close youtube tab")
          const siteTabMatch = remaining.match(/\b(?:close|shut|kill)\s+(?:the\s+)?([a-z0-9.-]+)\s+tabs?\b/i)
          if (siteTabMatch && !['this', 'current', 'active', 'open', 'the', 'my', 'all', 'other'].includes(siteTabMatch[1].toLowerCase())) {
            const site = siteTabMatch[1].toLowerCase()
            const cleanSite = site.charAt(0).toUpperCase() + site.slice(1)
            tasks.push({
              toolCall: { function: 'closeTab', arguments: { query: site } },
              confirmationText: `Closing the ${cleanSite} tab.`
            })
            remaining = remaining.replace(siteTabMatch[0], ' ')
          } else {
            // 6. Direct site name (e.g. "close youtube")
            const directSiteMatch = remaining.match(/\b(?:close|shut|kill)\s+([a-z0-9.-]+)\b/i)
            if (directSiteMatch && (COMMON_SITES[directSiteMatch[1].toLowerCase()] || (directSiteMatch[1].includes('.') && directSiteMatch[1].length > 3))) {
              const s = directSiteMatch[1].toLowerCase()
              const cleanSite = s.charAt(0).toUpperCase() + s.slice(1)
              tasks.push({
                toolCall: { function: 'closeTab', arguments: { query: s } },
                confirmationText: `Closing the ${cleanSite} tab.`
              })
              remaining = remaining.replace(directSiteMatch[0], ' ')
            } else {
              // 7. Single or current tab (e.g. "close tab", "close this tab", "close current tab", "close tabs")
              const currentTabMatch = remaining.match(/\b(?:close|shut|kill)\s+(?:(?:this|the|my|current|active)\s+)*tabs?\b/i)
              if (currentTabMatch) {
                tasks.push({
                  toolCall: { function: 'closeTab', arguments: { current: true } },
                  confirmationText: 'Closing the current tab.'
                })
                remaining = remaining.replace(currentTabMatch[0], ' ')
              }
            }
          }
        }
      }
    }
  }

  // 7. Screenshot (supports speech homophones: page, speech, screen, tab, sheet)
  const screenshotRegex = /\b(?:take\s+a\s+screenshot(?:\s+of\s+(?:this\s+)?(?:page|speech|screen|tab|sheet))?|capture\s+(?:a\s+)?screenshot|capture\s+(?:this\s+)?(?:screen|speech|page)|screenshot\s+this\s+(?:page|speech|tab|screen))\b/i
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

  // 9. Scrolling (scroll down, scroll up)
  const scrollDownRegex = /\b(?:scroll\s+down(?:\s+(?:the\s+)?page)?|go\s+down(?:\s+(?:the\s+)?page)?|page\s+down)\b/i
  const sdMatch = remaining.match(scrollDownRegex)
  if (sdMatch) {
    tasks.push({
      toolCall: { function: 'scrollDown', arguments: {} },
      confirmationText: 'Scrolling down.'
    })
    remaining = remaining.replace(sdMatch[0], ' ')
  } else {
    const scrollUpRegex = /\b(?:scroll\s+up(?:\s+(?:the\s+)?page)?|go\s+up(?:\s+(?:the\s+)?page)?|page\s+up)\b/i
    const suMatch = remaining.match(scrollUpRegex)
    if (suMatch) {
      tasks.push({
        toolCall: { function: 'scrollUp', arguments: {} },
        confirmationText: 'Scrolling up.'
      })
      remaining = remaining.replace(suMatch[0], ' ')
    }
  }

  // 10. Switch Tab (switch to tab 2, switch to the second tab, switch to YouTube tab)
  const switchNumMatch = remaining.match(/\b(?:switch\s+(?:to\s+)?|go\s+to\s+)(?:the\s+)?tab\s+(?:number\s+|#)?(\d+)\b/i)
  if (switchNumMatch) {
    const idx = parseInt(switchNumMatch[1], 10)
    tasks.push({
      toolCall: { function: 'switchTab', arguments: { index: idx } },
      confirmationText: `Switching to tab ${idx}.`
    })
    remaining = remaining.replace(switchNumMatch[0], ' ')
  } else {
    const switchOrdMatch = remaining.match(/\b(?:switch\s+(?:to\s+)?|go\s+to\s+)(?:the\s+)?(first|second|third|fourth|fifth)\s+tab\b/i)
    if (switchOrdMatch) {
      const ordMap = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4 }
      const ord = switchOrdMatch[1].toLowerCase()
      const idx = ordMap[ord] ?? 0
      tasks.push({
        toolCall: { function: 'switchTab', arguments: { index: idx } },
        confirmationText: `Switching to the ${ord} tab.`
      })
      remaining = remaining.replace(switchOrdMatch[0], ' ')
    } else {
      const switchSiteMatch = remaining.match(/\b(?:switch\s+(?:to\s+)?)(?:the\s+)?([a-z0-9.-]+)\s+tab\b/i)
      if (switchSiteMatch && !['this', 'current', 'active', 'open', 'the', 'my'].includes(switchSiteMatch[1].toLowerCase())) {
        const site = switchSiteMatch[1].toLowerCase()
        const cleanSite = site.charAt(0).toUpperCase() + site.slice(1)
        tasks.push({
          toolCall: { function: 'switchTab', arguments: { query: site } },
          confirmationText: `Switching to the ${cleanSite} tab.`
        })
        remaining = remaining.replace(switchSiteMatch[0], ' ')
      }
    }
  }

  // 11. Page Title (what is the page title, get page title, what page is this)
  const titleRegex = /\b(?:what(?:'s|\s+is)\s+the\s+(?:page\s+)?title|get\s+(?:the\s+)?page\s+title|what\s+page\s+is\s+this)\b/i
  const titleMatch = remaining.match(titleRegex)
  if (titleMatch) {
    tasks.push({
      toolCall: { function: 'getPageTitle', arguments: {} },
      confirmationText: 'Checking the page title.'
    })
    remaining = remaining.replace(titleMatch[0], ' ')
  }

  // 12. Audio Listen (listen, what are they saying, listen to this audio)
  const listenRegex = /\b(?:listen(?:\s+to\s+(?:this\s+)?(?:page|tab|audio|video))?|what\s+are\s+they\s+saying|transcribe\s+(?:the\s+)?audio)\b/i
  const listenMatch = remaining.match(listenRegex)
  if (listenMatch) {
    tasks.push({
      toolCall: { function: 'listen', arguments: {} },
      confirmationText: 'Listening to page audio.'
    })
    remaining = remaining.replace(listenMatch[0], ' ')
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

/**
 * Checks if user is asking who made, created, built, or developed Pentone.
 */
export function isCreatorQuestion(input: string): boolean {
  if (!input || typeof input !== 'string') return false
  const clean = input.trim().toLowerCase().replace(/[?!.,;:]+$/, '')

  // 1. "who [actually/really] made/created/built/designed/developed/programmed/coded/invented/authored/wrote you/penton/pentone/this app"
  const actionRegex = /\bwho(?:\s+(?:actually|really))?\s+(?:made|created|built|designed|developed|programmed|coded|invented|authored|wrote)\s+(?:you|penton|pentone|this(?:\s+(?:app|ai|agent|extension|tool|assistant|system))?)\b/i

  // 2. "who is/are you made/created/built/developed/programmed/coded by"
  const passiveRegex = /\bwho(?:\s+(?:is|are|were))?\s+(?:you|penton|pentone|this(?:\s+(?:app|ai|agent|extension|tool|assistant|system))?)\s+(?:made|created|built|developed|designed|coded|programmed)\s+by\b/i

  // 3. "who is/was your/the creator/maker/developer/designer/author/builder/programmer/architect/founder"
  const possessiveRegex = /\bwho(?:\s+is|'s|\s+are|\s+was)\s+(?:your|the)\s+(?:creator|maker|developer|designer|author|programmer|builder|architect|founder|father|coder)(?:\s+of\s+(?:you|penton|pentone|this(?:\s+(?:app|ai|agent|extension|tool|assistant|system))?))?\b/i

  // 4. "who is the creator of pentone"
  const creatorOfRegex = /\bwho(?:\s+is|'s|\s+was)\s+(?:the\s+)?(?:creator|maker|developer|author|programmer|builder|architect|founder)\s+of\s+(?:penton|pentone|this|you)\b/i

  // 5. "tell me who made/created you", "do you know who made you", "can you tell me who made you"
  const embeddedRegex = /\b(?:tell\s+me|know|wondering|say)\s+who\s+(?:made|created|built|designed|developed|coded|programmed)\s+(?:you|penton|pentone|this)\b/i

  // 6. "who gave you life", "whose creation are you", "who is behind pentone"
  const otherRegex = /\b(?:who\s+gave\s+you\s+life|whose\s+(?:project|creation|ai|assistant)\s+(?:is\s+this|are\s+you)|who(?:\s+is|'s)\s+behind\s+(?:you|penton|pentone|this))\b/i

  return actionRegex.test(clean) || passiveRegex.test(clean) || possessiveRegex.test(clean) || creatorOfRegex.test(clean) || embeddedRegex.test(clean) || otherRegex.test(clean)
}

