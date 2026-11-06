import type { ToolCall } from './tools'
import { matchVoiceIntent } from './voice-intent-matcher.ts'

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
    'searching is required',
    // Page context hesitation and evasion phrases
    'cannot recall the specific page',
    'i cannot recall the specific page',
    'please provide the page you are referring to',
    'provide the page you are referring to',
    'provide the page or url',
    'provide the url or page',
    'cannot see which page is open',
    'do not know which page is open',
    'please provide the url',
    'provide the link or url',
    // Generic capability and action refusals
    'i am unable to perform that action',
    'unable to perform that action',
    'unable to perform this action',
    'cannot perform that action',
    'cannot perform this action',
    'unable to fulfill this request',
    'cannot fulfill this request',
    'cannot interact with the page',
    'unable to interact with the page',
    'cannot click',
    'unable to click',
    'cannot open videos',
    'unable to open videos',
    'cannot open the video',
    'unable to open the video',
    'cannot click on',
    // Video ad capability disclaimers & refusals
    'do not have the capability to interact with or manipulate video ads',
    'interact with or manipulate video ads',
    'manipulate video ads',
    'video ads on external websites',
    'cannot interact with video ads',
    'unable to interact with video ads',
    'cannot manipulate video ads',
    'unable to manipulate video ads',
    'cannot skip ads',
    'unable to skip ads',
    'cannot skip video ads',
    'unable to skip video ads',
    'do not have the capability to interact with or manipulate',
    'i do not have the capability to interact',
    'do not have the capability to interact',
    // Media & playback refusals
    'cannot control media',
    'unable to control media',
    'cannot control video playback',
    'unable to control video playback',
    'cannot pause videos',
    'unable to pause videos',
    'cannot play videos',
    'unable to play videos',
    'cannot adjust volume',
    'unable to adjust volume',
    'cannot mute audio',
    'unable to mute audio',
    // Page zoom & modal refusals
    'cannot zoom',
    'unable to zoom',
    'cannot close popups',
    'unable to close popups'
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

  // 1. Skip Video Ad (supports "skip the ad", "skip ad", "skip this ad", "skip video ad", "skip ads", "close ad", "ad skip karo", "ad hatao", "skip")
  const skipAdRegex = /\b(?:skip(?:\s+the|\s+this)?\s+ads?|skip\s+(?:the\s+)?video\s+ads?|close(?:\s+the|\s+this)?\s+ad|ad\s+skip|^skip$)\b/i
  const skipAdMatch = remaining.match(skipAdRegex)
  if (skipAdMatch) {
    tasks.push({
      toolCall: {
        function: 'clickElement',
        arguments: { query: 'skip ad' }
      },
      confirmationText: 'Skipping the ad.'
    })
    remaining = remaining.replace(skipAdMatch[0], ' ')
  }

  // 1. Video Clicking & Playing (e.g. "open the first video", "play the second video", "open first video", "play video 1", "open video", "watch the first video")
  const videoRegex = /\b(?:open|play|watch|click|start)\s+(?:the\s+)?(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|#?\d+)?\s*videos?\b/i
  const vMatch = remaining.match(videoRegex)
  if (vMatch) {
    const rawOrd = (vMatch[1] || 'first').toLowerCase().replace('#', '')
    const ordMap = {
      first: 0, '1st': 0, '1': 0,
      second: 1, '2nd': 1, '2': 1,
      third: 2, '3rd': 2, '3': 2,
      fourth: 3, '4th': 3, '4': 3,
      fifth: 4, '5th': 4, '5': 4
    }
    const idx = ordMap[rawOrd] ?? (parseInt(rawOrd, 10) > 0 ? parseInt(rawOrd, 10) - 1 : 0)
    const ordName = Object.keys(ordMap).find(k => ordMap[k] === idx && isNaN(Number(k))) || 'first'

    tasks.push({
      toolCall: {
        function: 'clickElement',
        arguments: { query: `${ordName} video`, ordinal: idx }
      },
      confirmationText: `Opening the ${ordName} video.`
    })
    remaining = remaining.replace(vMatch[0], ' ')
  }

  // 1B. Media Playback Controls (pause, play/resume, mute, unmute, speed, seek, restart, fullscreen)
  const mediaPauseRegex = /\b(?:pause(?:\s+(?:the\s+)?video|\s+(?:the\s+)?playback|\s+(?:the\s+)?media)?|stop\s+(?:the\s+)?video|pause\s+it)\b/i
  const mediaPauseMatch = remaining.match(mediaPauseRegex)
  if (mediaPauseMatch) {
    tasks.push({
      toolCall: {
        function: 'controlMedia',
        arguments: { action: 'pause' }
      },
      confirmationText: 'Pausing media playback.'
    })
    remaining = remaining.replace(mediaPauseMatch[0], ' ')
  }

  const mediaPlayRegex = /\b(?:resume(?:\s+(?:the\s+)?video|\s+(?:the\s+)?playback|\s+(?:the\s+)?media)?|unpause(?:\s+(?:the\s+)?video)?|play\s+(?:the\s+)?video|continue\s+playing)\b/i
  const mediaPlayMatch = remaining.match(mediaPlayRegex)
  if (mediaPlayMatch) {
    tasks.push({
      toolCall: {
        function: 'controlMedia',
        arguments: { action: 'play' }
      },
      confirmationText: 'Playing media.'
    })
    remaining = remaining.replace(mediaPlayMatch[0], ' ')
  }

  const mediaMuteRegex = /\b(?:mute(?:\s+(?:the\s+)?(?:video|audio|tab|page|sound))?|sound\s+off|turn\s+off\s+(?:the\s+)?sound)\b/i
  const mediaMuteMatch = remaining.match(mediaMuteRegex)
  if (mediaMuteMatch) {
    tasks.push({
      toolCall: {
        function: 'controlMedia',
        arguments: { action: 'mute' }
      },
      confirmationText: 'Muting audio.'
    })
    remaining = remaining.replace(mediaMuteMatch[0], ' ')
  }

  const mediaUnmuteRegex = /\b(?:unmute(?:\s+(?:the\s+)?(?:video|audio|tab|page|sound))?|sound\s+on|turn\s+on\s+(?:the\s+)?sound)\b/i
  const mediaUnmuteMatch = remaining.match(mediaUnmuteRegex)
  if (mediaUnmuteMatch) {
    tasks.push({
      toolCall: {
        function: 'controlMedia',
        arguments: { action: 'unmute' }
      },
      confirmationText: 'Unmuting audio.'
    })
    remaining = remaining.replace(mediaUnmuteMatch[0], ' ')
  }

  const mediaFullscreenRegex = /\b(?:full\s*screen(?:\s+mode)?|make(?:\s+(?:it|the\s+video))?\s+full\s*screen|exit\s+full\s*screen)\b/i
  const mediaFullscreenMatch = remaining.match(mediaFullscreenRegex)
  if (mediaFullscreenMatch) {
    const isExit = mediaFullscreenMatch[0].toLowerCase().includes('exit')
    tasks.push({
      toolCall: {
        function: 'controlMedia',
        arguments: { action: isExit ? 'exitFullscreen' : 'fullscreen' }
      },
      confirmationText: isExit ? 'Exiting fullscreen mode.' : 'Entering fullscreen mode.'
    })
    remaining = remaining.replace(mediaFullscreenMatch[0], ' ')
  }

  const mediaSpeedRegex = /\b(?:play\s+at\s+|speed\s+(?:to\s+)?|playback\s+speed\s+(?:to\s+)?)([0-2](?:\.\d+)?|\d+)x?\s*(?:speed)?\b/i
  const mediaSpeedMatch = remaining.match(mediaSpeedRegex)
  if (mediaSpeedMatch) {
    const rate = parseFloat(mediaSpeedMatch[1])
    if (!isNaN(rate) && rate > 0) {
      tasks.push({
        toolCall: {
          function: 'controlMedia',
          arguments: { action: 'speed', rate }
        },
        confirmationText: `Setting playback speed to ${rate}x.`
      })
      remaining = remaining.replace(mediaSpeedMatch[0], ' ')
    }
  }

  const mediaSeekFwdRegex = /\b(?:forward|fast\s+forward|skip\s+ahead)\s+(\d+)\s*(?:seconds?|secs?|s)\b/i
  const mediaSeekFwdMatch = remaining.match(mediaSeekFwdRegex)
  if (mediaSeekFwdMatch) {
    const sec = parseInt(mediaSeekFwdMatch[1], 10)
    tasks.push({
      toolCall: {
        function: 'controlMedia',
        arguments: { action: 'seek', seconds: sec }
      },
      confirmationText: `Forwarding ${sec} seconds.`
    })
    remaining = remaining.replace(mediaSeekFwdMatch[0], ' ')
  }

  const mediaSeekBackRegex = /\b(?:rewind|go\s+back|skip\s+back)\s+(\d+)\s*(?:seconds?|secs?|s)\b/i
  const mediaSeekBackMatch = remaining.match(mediaSeekBackRegex)
  if (mediaSeekBackMatch) {
    const sec = parseInt(mediaSeekBackMatch[1], 10)
    tasks.push({
      toolCall: {
        function: 'controlMedia',
        arguments: { action: 'seek', seconds: -sec }
      },
      confirmationText: `Rewinding ${sec} seconds.`
    })
    remaining = remaining.replace(mediaSeekBackMatch[0], ' ')
  }

  const mediaRestartRegex = /\b(?:restart(?:\s+(?:the\s+)?video)?|replay(?:\s+(?:the\s+)?video)?|start(?:\s+(?:the\s+)?video)?\s+from\s+(?:the\s+)?beginning)\b/i
  const mediaRestartMatch = remaining.match(mediaRestartRegex)
  if (mediaRestartMatch) {
    tasks.push({
      toolCall: {
        function: 'controlMedia',
        arguments: { action: 'restart' }
      },
      confirmationText: 'Restarting video.'
    })
    remaining = remaining.replace(mediaRestartMatch[0], ' ')
  }

  // 2. Ordinal Link & Result Clicking (e.g. "click the first link", "open first result", "open the second result", "click the third link")
  const ordLinkRegex = /\b(?:open|click|press)\s+(?:the\s+)?(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|#?\d+)\s+(link|result|website|item|article|button)\b/i
  const olMatch = remaining.match(ordLinkRegex)
  if (olMatch) {
    const rawOrd = (olMatch[1] || 'first').toLowerCase().replace('#', '')
    const itemType = (olMatch[2] || 'item').toLowerCase()
    const ordMap = {
      first: 0, '1st': 0, '1': 0,
      second: 1, '2nd': 1, '2': 1,
      third: 2, '3rd': 2, '3': 2,
      fourth: 3, '4th': 3, '4': 3,
      fifth: 4, '5th': 4, '5': 4
    }
    const idx = ordMap[rawOrd] ?? (parseInt(rawOrd, 10) > 0 ? parseInt(rawOrd, 10) - 1 : 0)
    const ordName = Object.keys(ordMap).find(k => ordMap[k] === idx && isNaN(Number(k))) || 'first'

    tasks.push({
      toolCall: {
        function: 'clickElement',
        arguments: { query: `${ordName} ${itemType}`, ordinal: idx }
      },
      confirmationText: `Opening the ${ordName} ${itemType}.`
    })
    remaining = remaining.replace(olMatch[0], ' ')
  }

  // 3. Clear / Delete Input Fields (e.g. "clear input", "clear search box", "delete text in search", "empty the input")
  const clearRegex = /\b(?:clear\s+(?:the\s+)?(?:input|search|text|field|search\s+box)|delete\s+(?:the\s+)?(?:text|input|search)|empty\s+(?:the\s+)?(?:input|search|field))\b/i
  const clearMatch = remaining.match(clearRegex)
  if (clearMatch) {
    tasks.push({
      toolCall: {
        function: 'fillInput',
        arguments: { query: 'input', value: '' }
      },
      confirmationText: 'Clearing the input field.'
    })
    remaining = remaining.replace(clearMatch[0], ' ')
  }

  // 4. Named Element Clicking (e.g. "click the search button", "click login", "click submit", "click sign in", "click subscribe")
  const clickNamedRegex = /\b(?:click|press)(?:\s+on)?\s+(?:the\s+)?(search\s+button|submit\s+button|login\s+button|sign\s+in\s+button|search|submit|login|sign\s+in|subscribe|like|play|pause|mute|unmute)(?:\s+button|\s+link|\s+icon)?\b/i
  const clickNamedMatch = remaining.match(clickNamedRegex)
  if (clickNamedMatch && !clickNamedMatch[1].toLowerCase().includes('tab')) {
    const targetName = clickNamedMatch[1].trim()
    tasks.push({
      toolCall: {
        function: 'clickElement',
        arguments: { query: targetName }
      },
      confirmationText: `Clicking ${targetName}.`
    })
    remaining = remaining.replace(clickNamedMatch[0], ' ')
  }

  // 4B. Select Dropdown Option (e.g. "select California in dropdown", "choose option 2", "select English in state dropdown")
  const selectOptRegex = /\b(?:select|choose|pick)\s+([a-zA-Z0-9\s_-]+?)\s+(?:in|from|on)\s+(?:the\s+)?(?:[a-zA-Z0-9_-]+\s+)?(?:dropdown|select|menu|picker|list|options?)\b/i
  const selectOptMatch = remaining.match(selectOptRegex)
  if (selectOptMatch) {
    const optName = selectOptMatch[1].trim()
    tasks.push({
      toolCall: {
        function: 'selectOption',
        arguments: { query: optName }
      },
      confirmationText: `Selecting ${optName} in dropdown.`
    })
    remaining = remaining.replace(selectOptMatch[0], ' ')
  }

  // 5. Browser History & Page Navigation (go back, go forward, reload/refresh)
  const backRegex = /\b(?:go\s+back(?:\s+to\s+(?:the\s+)?previous\s+page|\s+page)?|back(?:\s+to\s+(?:the\s+)?previous\s+page)?|previous\s+page)\b/i
  const backMatch = remaining.match(backRegex)
  if (backMatch) {
    tasks.push({
      toolCall: {
        function: 'navigatePage',
        arguments: { action: 'back' }
      },
      confirmationText: 'Going back to the previous page.'
    })
    remaining = remaining.replace(backMatch[0], ' ')
  } else {
    const fwdRegex = /\b(?:go\s+forward(?:\s+to\s+(?:the\s+)?next\s+page|\s+page)?|forward(?:\s+to\s+(?:the\s+)?next\s+page)?|next\s+page)\b/i
    const fwdMatch = remaining.match(fwdRegex)
    if (fwdMatch) {
      tasks.push({
        toolCall: {
          function: 'navigatePage',
          arguments: { action: 'forward' }
        },
        confirmationText: 'Going forward to the next page.'
      })
      remaining = remaining.replace(fwdMatch[0], ' ')
    } else {
      const reloadRegex = /\b(?:reload(?:\s+the)?(?:\s+page|\s+tab)?|refresh(?:\s+the)?(?:\s+page|\s+tab)?)\b/i
      const reloadMatch = remaining.match(reloadRegex)
      if (reloadMatch) {
        tasks.push({
          toolCall: {
            function: 'navigatePage',
            arguments: { action: 'reload' }
          },
          confirmationText: 'Reloading the page.'
        })
        remaining = remaining.replace(reloadMatch[0], ' ')
      }
    }
  }

  // 6. YouTube Search (supports "YouTube and search for...", "open YouTube and search for...", "search YouTube for...", "search X on YouTube")
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

  // 7. Web / Google Search (supports "search for...", "search...", "look up...", "search Google for...", "search on google for...", etc.)
  if (!ytMatch) {
    const searchRegex = /\b(?:search\s+(?:for\s+|about\s+)?(.+?)\s+(?:on|in)\s+google|(?:open\s+|go\s+to\s+|on\s+)?google\s+(?:and\s+|to\s+)?search\s+(?:for\s+|about\s+)?|google\s+search\s+(?:for\s+|about\s+)?|look\s+up\s+(?:for\s+|about\s+)?|search\s+(?:(?:on\s+|in\s+)?google\s+|the\s+web\s+|the\s+internet\s+|online\s+)?(?:for\s+|about\s+)?(?!this\s+page\b|the\s+page\b|vault\b|memories\b|memory\b|tabs\b|types\b|button\b|box\b|bar\b|field\b|input\b))(.+?)(?=(?:\s+(?:and\s+then|then|and\s+also)\s+|\s+and\s+(?:remember|store|save|check|take|open|go\s+to|navigate|summarize|list|find|show|close|shut|kill|scroll|switch|listen)\b|,\s*|\s+remember\s+|\s+store\s+in\s+memory|\s+check\s+|\s+take\s+a\s+screenshot|\s+summarize\s+|\s+close\s+|$))/i
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

  // 8. Page summary (supports "summarize this page", "summarise this page", "summarize", "summarise", "give me a summary", "summary of this page")
  const summaryRegex = /\b(?:summari[sz][e|es|ing]?(?:\s+(?:this\s+page|the\s+page|this|the\s+article|key\s+points|article))?|give\s+me\s+(?:a\s+)?(?:summary|the\s+key\s+points|key\s+points)(?:\s+of\s+(?:this\s+page|the\s+page|this))?|summar[y|ies]\s+(?:of\s+)?(?:this\s+page|the\s+page|this))\b/i
  const sumMatch = remaining.match(summaryRegex)
  if (sumMatch) {
    tasks.push({
      toolCall: { function: 'summarizePage', arguments: { type: 'key-points' } },
      confirmationText: 'Summarizing this page.'
    })
    remaining = remaining.replace(sumMatch[0], ' ')
  }

  // 9. Scrolling (scroll down, scroll up, scroll to top, scroll to bottom)
  const scrollToTopRegex = /\b(?:scroll\s+to\s+(?:the\s+)?top|go\s+to\s+(?:the\s+)?top(?:\s+of\s+(?:the\s+)?page)?|jump\s+to\s+(?:the\s+)?top|back\s+to\s+top)\b/i
  const scrollToTopMatch = remaining.match(scrollToTopRegex)
  if (scrollToTopMatch) {
    tasks.push({
      toolCall: { function: 'scrollUp', arguments: { to: 'top' } },
      confirmationText: 'Scrolling to the top.'
    })
    remaining = remaining.replace(scrollToTopMatch[0], ' ')
  } else {
    const scrollToBottomRegex = /\b(?:scroll\s+to\s+(?:the\s+)?bottom|go\s+to\s+(?:the\s+)?bottom(?:\s+of\s+(?:the\s+)?page)?|jump\s+to\s+(?:the\s+)?bottom|scroll\s+to\s+(?:the\s+)?end|scroll\s+all\s+the\s+way\s+down)\b/i
    const scrollToBottomMatch = remaining.match(scrollToBottomRegex)
    if (scrollToBottomMatch) {
      tasks.push({
        toolCall: { function: 'scrollDown', arguments: { to: 'bottom' } },
        confirmationText: 'Scrolling to the bottom.'
      })
      remaining = remaining.replace(scrollToBottomMatch[0], ' ')
    } else {
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
    }
  }

  // 9B. Page Zooming (zoom in, zoom out, reset zoom, set zoom)
  const zoomResetRegex = /\b(?:reset\s+zoom|normal\s+zoom|default\s+zoom|zoom\s+(?:to\s+)?100%?)\b/i
  const zoomResetMatch = remaining.match(zoomResetRegex)
  if (zoomResetMatch) {
    tasks.push({
      toolCall: { function: 'zoomPage', arguments: { action: 'reset' } },
      confirmationText: 'Resetting zoom to 100%.'
    })
    remaining = remaining.replace(zoomResetMatch[0], ' ')
  } else {
    const zoomSetRegex = /\b(?:set\s+zoom\s+(?:to\s+)?|zoom\s+to\s+)(\d{2,3})%?\b/i
    const zoomSetMatch = remaining.match(zoomSetRegex)
    if (zoomSetMatch) {
      const f = parseInt(zoomSetMatch[1], 10)
      tasks.push({
        toolCall: { function: 'zoomPage', arguments: { action: 'set', factor: f } },
        confirmationText: `Setting zoom to ${f}%.`
      })
      remaining = remaining.replace(zoomSetMatch[0], ' ')
    } else {
      const zoomInRegex = /\b(?:zoom\s+in(?:\s+(?:the\s+)?page)?|increase\s+zoom|zoom\s+more)\b/i
      const zoomInMatch = remaining.match(zoomInRegex)
      if (zoomInMatch) {
        tasks.push({
          toolCall: { function: 'zoomPage', arguments: { action: 'in' } },
          confirmationText: 'Zooming in.'
        })
        remaining = remaining.replace(zoomInMatch[0], ' ')
      } else {
        const zoomOutRegex = /\b(?:zoom\s+out(?:\s+(?:the\s+)?page)?|decrease\s+zoom|zoom\s+less)\b/i
        const zoomOutMatch = remaining.match(zoomOutRegex)
        if (zoomOutMatch) {
          tasks.push({
            toolCall: { function: 'zoomPage', arguments: { action: 'out' } },
            confirmationText: 'Zooming out.'
          })
          remaining = remaining.replace(zoomOutMatch[0], ' ')
        }
      }
    }
  }

  // 9C. Modals, Popups & Cookie Banners
  const acceptCookiesRegex = /\b(?:accept(?:\s+all)?\s+cookies?|allow(?:\s+all)?\s+cookies?|agree\s+to\s+cookies?|dismiss\s+cookie\s+banner|close\s+cookie\s+banner)\b/i
  const acceptCookiesMatch = remaining.match(acceptCookiesRegex)
  if (acceptCookiesMatch) {
    tasks.push({
      toolCall: { function: 'dismissModal', arguments: { type: 'cookie' } },
      confirmationText: 'Accepting cookies and dismissing banner.'
    })
    remaining = remaining.replace(acceptCookiesMatch[0], ' ')
  } else {
    const dismissModalRegex = /\b(?:close(?:\s+(?:the|this))?\s+(?:pop[- ]?up|modal|dialog|overlay|banner|newsletter)|dismiss(?:\s+(?:the|this))?\s+(?:pop[- ]?up|modal|dialog|overlay|banner))\b/i
    const dismissModalMatch = remaining.match(dismissModalRegex)
    if (dismissModalMatch) {
      tasks.push({
        toolCall: { function: 'dismissModal', arguments: { type: 'popup' } },
        confirmationText: 'Dismissing popup.'
      })
      remaining = remaining.replace(dismissModalMatch[0], ' ')
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

  // 11. Page Title / Current Page Inquiry (supports "is this page", "what page is this", "which page is this", "what page am I on", "what is this page", "what site is this", "where am I", "check this page", "get page title")
  const titleRegex = /\b(?:is\s+this\s+(?:the\s+)?page\b|what\s+page\s+(?:is\s+this|am\s+i\s+on)|which\s+page\s+(?:is\s+this|am\s+i\s+on)|what(?:'s|\s+is)\s+this\s+page|what(?:'s|\s+is)\s+(?:the\s+)?(?:page\s+)?title|get\s+(?:the\s+)?page\s+title|tell\s+me\s+(?:what|which)\s+page\s+this\s+is|what\s+site\s+is\s+this|where\s+am\s+i\b|check\s+(?:this\s+page|current\s+page))\b/i
  const titleMatch = remaining.match(titleRegex)
  if (titleMatch) {
    tasks.push({
      toolCall: { function: 'getPageTitle', arguments: {} },
      confirmationText: 'Checking the current page.'
    })
    remaining = remaining.replace(titleMatch[0], ' ')
  }

  // 11B. Copy to Clipboard (copy page url, copy link, copy selection)
  const copyUrlRegex = /\b(?:copy(?:\s+(?:the\s+)?(?:page\s+)?(?:url|link|address|href))(?:\s+of\s+(?:this\s+page|the\s+page|this))?|copy\s+link\s+to\s+clipboard|copy\s+current\s+url)\b/i
  const copyUrlMatch = remaining.match(copyUrlRegex)
  if (copyUrlMatch) {
    tasks.push({
      toolCall: { function: 'copyToClipboard', arguments: { type: 'url' } },
      confirmationText: 'Copying page link to clipboard.'
    })
    remaining = remaining.replace(copyUrlMatch[0], ' ')
  } else {
    const copySelRegex = /\b(?:copy(?:\s+(?:the\s+)?)?(?:selected\s+text|selection|highlighted\s+text))\b/i
    const copySelMatch = remaining.match(copySelRegex)
    if (copySelMatch) {
      tasks.push({
        toolCall: { function: 'copyToClipboard', arguments: { type: 'selection' } },
        confirmationText: 'Copying selected text to clipboard.'
      })
      remaining = remaining.replace(copySelMatch[0], ' ')
    }
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

  // 13. Voice Intent Matcher (Fuzzy Acoustic & Double-Metaphone fallback)
  // Handles Indian accents, speech homophones (e.g. "summer eyes", "close all types"), and Hinglish commands
  if (tasks.length === 0) {
    const voiceIntent = matchVoiceIntent(userInput)
    if (voiceIntent) {
      tasks.push(voiceIntent)
    }
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

  // 7. Hindi & Hinglish creator queries ("tumhe kisne banaya", "tumhara creator kaun hai", "kisne banaya tumko")
  const hinglishRegex = /\b(?:tumhe|tumko|tera|tumhara|aapko|aapka)\s+(?:kisne\s+banaya|creator\s+kaun|kisne\s+create\s+kiya|kisne\s+design\s+kiya)\b|\bkisne\s+banaya\s+(?:tumhe|tumko|ye|pentone)\b/i

  return actionRegex.test(clean) || passiveRegex.test(clean) || possessiveRegex.test(clean) || creatorOfRegex.test(clean) || embeddedRegex.test(clean) || otherRegex.test(clean) || hinglishRegex.test(clean)
}

