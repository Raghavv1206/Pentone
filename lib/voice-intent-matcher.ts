import Fuse from 'fuse.js'
import { scopedTabCommand, hasTabCloseIntent, isExactCloseAll } from './browser/command-scope'
import { doubleMetaphone } from 'double-metaphone'
import type { ToolCall } from './tools'
import type { DetectedIntent } from './intent-detector'

export interface VoiceCommandEntry {
  id: string
  canonicalIntent: string
  toolCall: ToolCall
  confirmationText: string
  aliases: string[]
  hinglishAliases: string[]
  phoneticKeys: string[]
  extractParams?: (input: string) => Record<string, any> | null
}

// Pre-computed Double-Metaphone phonetic keys for rapid comparison
function getPhoneticCodes(text: string): string[] {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  const codes: string[] = []
  for (const w of words) {
    const [p1, p2] = doubleMetaphone(w)
    if (p1) codes.push(p1)
    if (p2 && p2 !== p1) codes.push(p2)
  }
  return codes
}

export const VOICE_COMMAND_REGISTRY: VoiceCommandEntry[] = [
  // 1. Page Summarization
  {
    id: 'summarize_page',
    canonicalIntent: 'summarize page',
    toolCall: {
      function: 'summarizePage',
      arguments: { type: 'key-points' }
    },
    confirmationText: 'Summarizing this page.',
    aliases: [
      'summarize this page',
      'summarise this page',
      'summarize page',
      'summarise page',
      'summarize',
      'summarise',
      'give me a summary',
      'summarize it',
      'summarise it',
      'page summary',
      'summer eyes this page',
      'summer eyes',
      'summer ice this page',
      'summer ice',
      'sum rise this page',
      'is this page summary',
      'key points of this page',
      'tldr this page'
    ],
    hinglishAliases: [
      'ye page summarize karo',
      'is page ka summary banao',
      'is page ko summarize karo',
      'summary batao',
      'short me samjhao',
      'page ke bare me batao',
      'is page me kya hai samjhao'
    ],
    phoneticKeys: ['SMRS', 'SMRZ']
  },

  // 2. Tab Management: Close All Tabs
  {
    id: 'close_all_tabs',
    canonicalIntent: 'close all tabs',
    toolCall: {
      function: 'closeTab',
      arguments: { all: true }
    },
    confirmationText: 'Closing all tabs.',
    aliases: [
      'close all tabs',
      'close all types',
      'close all taps',
      'close all tab',
      'shut all tabs',
      'shut down all tabs',
      'close every tab',
      'kill all tabs',
      'dismiss all tabs'
    ],
    hinglishAliases: [
      'sare tabs band karo',
      'sab tab close kar do',
      'tabs band kardo',
      'sari tabs band kardo',
      'sab tabs band kar do'
    ],
    phoneticKeys: ['KLS', 'TBS']
  },

  // 3. Tab Management: Close Other Tabs
  {
    id: 'close_other_tabs',
    canonicalIntent: 'close other tabs',
    toolCall: {
      function: 'closeTab',
      arguments: { other: true }
    },
    confirmationText: 'Closing other tabs.',
    aliases: [
      'close other tabs',
      'close rest of the tabs',
      'close all other tabs',
      'close others'
    ],
    hinglishAliases: [
      'baki tabs band karo',
      'dusre tabs band karo',
      'baki sab tab close kar do'
    ],
    phoneticKeys: ['KLS', '0R']
  },

  // 4. Tab Management: Close Current Tab
  {
    id: 'close_current_tab',
    canonicalIntent: 'close this tab',
    toolCall: {
      function: 'closeTab',
      arguments: { current: true }
    },
    confirmationText: 'Closing this tab.',
    aliases: [
      'close this tab',
      'close current tab',
      'close tab',
      'close type',
      'shut this tab',
      'kill this tab'
    ],
    hinglishAliases: [
      'ye tab band karo',
      'is tab ko band karo',
      'ye tab close karo'
    ],
    phoneticKeys: ['KLS', 'TB']
  },

  // 5. Screenshot
  {
    id: 'capture_screenshot',
    canonicalIntent: 'capture screenshot',
    toolCall: {
      function: 'captureScreenshot',
      arguments: {}
    },
    confirmationText: 'Taking a screenshot.',
    aliases: [
      'take screenshot',
      'take a screenshot',
      'capture screenshot',
      'capture screen',
      'screen short',
      'screenshot this page',
      'screen snapshot',
      'take a snap'
    ],
    hinglishAliases: [
      'screenshot le lo',
      'screen capture karo',
      'photo lo',
      'screen ki photo lo',
      'page ka screenshot lo'
    ],
    phoneticKeys: ['SKRN', 'XT']
  },

  // 6. Chrome Internal Pages: Extensions
  {
    id: 'open_extensions',
    canonicalIntent: 'open extensions',
    toolCall: {
      function: 'openTab',
      arguments: { url: 'chrome://extensions' }
    },
    confirmationText: 'Opening extensions management.',
    aliases: [
      'open extensions',
      'open extension',
      'open chrome extensions',
      'open extension management page',
      'open extensions page',
      'show extensions',
      'manage extensions'
    ],
    hinglishAliases: [
      'extensions kholo',
      'chrome extension open karo',
      'extension page kholo',
      'extensions dikhao'
    ],
    phoneticKeys: ['AKST', 'NXNS']
  },

  // 7. Chrome Internal Pages: Settings
  {
    id: 'open_settings',
    canonicalIntent: 'open settings',
    toolCall: {
      function: 'openTab',
      arguments: { url: 'chrome://settings' }
    },
    confirmationText: 'Opening Chrome settings.',
    aliases: [
      'open settings',
      'open chrome settings',
      'open settings page',
      'show settings'
    ],
    hinglishAliases: [
      'settings kholo',
      'chrome settings open karo',
      'settings dikhao'
    ],
    phoneticKeys: ['STNKS']
  },

  // 8. Chrome Internal Pages: Flags
  {
    id: 'open_flags',
    canonicalIntent: 'open flags',
    toolCall: {
      function: 'openTab',
      arguments: { url: 'chrome://flags' }
    },
    confirmationText: 'Opening Chrome flags.',
    aliases: [
      'open flags',
      'open chrome flags',
      'show flags'
    ],
    hinglishAliases: [
      'flags kholo',
      'chrome flags open karo'
    ],
    phoneticKeys: ['FLKS']
  },

  // 9. Common Navigation: YouTube
  {
    id: 'open_youtube',
    canonicalIntent: 'open youtube',
    toolCall: {
      function: 'openTab',
      arguments: { url: 'https://www.youtube.com' }
    },
    confirmationText: 'Opening YouTube.',
    aliases: [
      'open youtube',
      'go to youtube',
      'launch youtube',
      'open you tube'
    ],
    hinglishAliases: [
      'youtube kholo',
      'youtube chalao',
      'youtube open karo'
    ],
    phoneticKeys: ['ATB']
  },

  // 10. Common Navigation: Google
  {
    id: 'open_google',
    canonicalIntent: 'open google',
    toolCall: {
      function: 'openTab',
      arguments: { url: 'https://www.google.com' }
    },
    confirmationText: 'Opening Google.',
    aliases: [
      'open google',
      'go to google',
      'launch google'
    ],
    hinglishAliases: [
      'google kholo',
      'google open karo'
    ],
    phoneticKeys: ['KKL']
  },

  // 11. Common Navigation: GitHub
  {
    id: 'open_github',
    canonicalIntent: 'open github',
    toolCall: {
      function: 'openTab',
      arguments: { url: 'https://github.com' }
    },
    confirmationText: 'Opening GitHub.',
    aliases: [
      'open github',
      'go to github',
      'open git hub'
    ],
    hinglishAliases: [
      'github kholo',
      'github open karo'
    ],
    phoneticKeys: ['K0P']
  },

  // 12. Video Interaction: Open / Play First Video
  {
    id: 'open_first_video',
    canonicalIntent: 'open first video',
    toolCall: {
      function: 'clickElement',
      arguments: { query: 'first video', ordinal: 0 }
    },
    confirmationText: 'Opening the first video.',
    aliases: [
      'open first video',
      'open the first video',
      'play first video',
      'play the first video',
      'watch first video',
      'watch the first video',
      'start first video',
      'first video'
    ],
    hinglishAliases: [
      'pehli video chalao',
      'pehla video kholo',
      'first video kholo',
      'first video chalao',
      'pehli video play karo',
      'first video play karo'
    ],
    phoneticKeys: ['PRST', 'FT']
  },

  // 13. Browser Navigation: Back
  {
    id: 'navigate_back',
    canonicalIntent: 'go back',
    toolCall: {
      function: 'navigatePage',
      arguments: { action: 'back' }
    },
    confirmationText: 'Going back to the previous page.',
    aliases: [
      'go back',
      'go back to previous page',
      'previous page',
      'navigate back',
      'page back'
    ],
    hinglishAliases: [
      'piche jao',
      'wapas jao',
      'peeche jao',
      'purane page par jao',
      'back jao',
      'back karo'
    ],
    phoneticKeys: ['PK', 'PRFS']
  },

  // 14. Browser Navigation: Forward
  {
    id: 'navigate_forward',
    canonicalIntent: 'go forward',
    toolCall: {
      function: 'navigatePage',
      arguments: { action: 'forward' }
    },
    confirmationText: 'Going forward to the next page.',
    aliases: [
      'go forward',
      'go to next page',
      'next page',
      'navigate forward'
    ],
    hinglishAliases: [
      'aage jao',
      'agla page kholo',
      'next page par jao',
      'forward jao'
    ],
    phoneticKeys: ['FRT', 'NKST']
  },

  // 15. Browser Navigation: Reload / Refresh
  {
    id: 'reload_page',
    canonicalIntent: 'reload page',
    toolCall: {
      function: 'navigatePage',
      arguments: { action: 'reload' }
    },
    confirmationText: 'Reloading the page.',
    aliases: [
      'reload page',
      'refresh page',
      'reload the page',
      'refresh the page',
      'reload tab',
      'refresh tab'
    ],
    hinglishAliases: [
      'page refresh karo',
      'page reload karo',
      'reload karo',
      'refresh karo',
      'dobara load karo'
    ],
    phoneticKeys: ['RLT', 'RFRX']
  },

  // 16. Skip Video Ad
  {
    id: 'skip_ad',
    canonicalIntent: 'skip ad',
    toolCall: {
      function: 'clickElement',
      arguments: { query: 'skip ad' }
    },
    confirmationText: 'Skipping the ad.',
    aliases: [
      'skip the ad',
      'skip ad',
      'skip this ad',
      'skip video ad',
      'skip ads',
      'skip the ads',
      'skip',
      'close ad',
      'close the ad',
      'bypass ad'
    ],
    hinglishAliases: [
      'ad skip karo',
      'ad hatao',
      'ad band karo',
      'ad skip kar do',
      'skip karo',
      'skip kar do ad',
      'is ad ko skip karo',
      'video ad hatao'
    ],
    phoneticKeys: ['SKP', 'AT', 'AD']
  },

  // 17. Pause Media Playback
  {
    id: 'pause_media',
    canonicalIntent: 'pause video',
    toolCall: {
      function: 'controlMedia',
      arguments: { action: 'pause' }
    },
    confirmationText: 'Pausing media playback.',
    aliases: [
      'pause video',
      'pause the video',
      'pause playback',
      'stop video',
      'pause it',
      'video pause',
      'stop playing',
      'pause'
    ],
    hinglishAliases: [
      'video pause karo',
      'video rok do',
      'ruk jao',
      'rok do',
      'pause kar do',
      'video pause kar',
      'gana rok do',
      'song rok do'
    ],
    phoneticKeys: ['PS', 'PT']
  },

  // 18. Play / Resume Media Playback
  {
    id: 'play_media',
    canonicalIntent: 'play video',
    toolCall: {
      function: 'controlMedia',
      arguments: { action: 'play' }
    },
    confirmationText: 'Playing media.',
    aliases: [
      'play video',
      'play the video',
      'resume video',
      'resume playback',
      'unpause video',
      'continue video',
      'resume'
    ],
    hinglishAliases: [
      'video chalu karo',
      'video play karo',
      'chalu karo',
      'video chala do',
      'resume kar do',
      'play kar do',
      'gana chalu karo'
    ],
    phoneticKeys: ['PL', 'RSM']
  },

  // 19. Mute Audio
  {
    id: 'mute_media',
    canonicalIntent: 'mute video',
    toolCall: {
      function: 'controlMedia',
      arguments: { action: 'mute' }
    },
    confirmationText: 'Muting audio.',
    aliases: [
      'mute video',
      'mute audio',
      'mute the video',
      'mute the tab',
      'mute page',
      'turn off sound',
      'sound off',
      'mute'
    ],
    hinglishAliases: [
      'awaaz band karo',
      'sound band karo',
      'mute kar do',
      'awaaz mute karo',
      'silent karo'
    ],
    phoneticKeys: ['MT']
  },

  // 20. Unmute Audio
  {
    id: 'unmute_media',
    canonicalIntent: 'unmute video',
    toolCall: {
      function: 'controlMedia',
      arguments: { action: 'unmute' }
    },
    confirmationText: 'Unmuting audio.',
    aliases: [
      'unmute video',
      'unmute audio',
      'unmute the video',
      'turn on sound',
      'sound on',
      'unmute'
    ],
    hinglishAliases: [
      'awaaz kholo',
      'awaaz chalu karo',
      'sound on karo',
      'unmute kar do',
      'awaaz un-mute karo'
    ],
    phoneticKeys: ['ANMT']
  },

  // 21. Zoom In
  {
    id: 'zoom_in',
    canonicalIntent: 'zoom in',
    toolCall: {
      function: 'zoomPage',
      arguments: { action: 'in' }
    },
    confirmationText: 'Zooming in.',
    aliases: [
      'zoom in',
      'zoom in page',
      'zoom in the page',
      'increase zoom',
      'enlarge page'
    ],
    hinglishAliases: [
      'zoom in karo',
      'page bada karo',
      'bada karo',
      'zoom badhao'
    ],
    phoneticKeys: ['SMN']
  },

  // 22. Zoom Out
  {
    id: 'zoom_out',
    canonicalIntent: 'zoom out',
    toolCall: {
      function: 'zoomPage',
      arguments: { action: 'out' }
    },
    confirmationText: 'Zooming out.',
    aliases: [
      'zoom out',
      'zoom out page',
      'zoom out the page',
      'decrease zoom',
      'shrink page'
    ],
    hinglishAliases: [
      'zoom out karo',
      'page chhota karo',
      'chhota karo',
      'zoom kam karo'
    ],
    phoneticKeys: ['SMT']
  },

  // 23. Reset Zoom
  {
    id: 'reset_zoom',
    canonicalIntent: 'reset zoom',
    toolCall: {
      function: 'zoomPage',
      arguments: { action: 'reset' }
    },
    confirmationText: 'Resetting zoom to 100%.',
    aliases: [
      'reset zoom',
      'normal zoom',
      'default zoom',
      '100% zoom',
      'zoom 100 percent'
    ],
    hinglishAliases: [
      'zoom reset karo',
      'normal zoom karo',
      'zoom normal karo'
    ],
    phoneticKeys: ['RSST']
  },

  // 24. Dismiss Modal / Popup
  {
    id: 'dismiss_modal',
    canonicalIntent: 'dismiss popup',
    toolCall: {
      function: 'dismissModal',
      arguments: { type: 'popup' }
    },
    confirmationText: 'Dismissing popup.',
    aliases: [
      'close popup',
      'dismiss popup',
      'close the popup',
      'close modal',
      'dismiss modal',
      'close dialog',
      'dismiss banner'
    ],
    hinglishAliases: [
      'popup band karo',
      'popup hatao',
      'modal close karo',
      'ye popup hata do',
      'popup dismiss karo'
    ],
    phoneticKeys: ['KLS', 'PPOP']
  },

  // 25. Accept Cookies
  {
    id: 'accept_cookies',
    canonicalIntent: 'accept cookies',
    toolCall: {
      function: 'dismissModal',
      arguments: { type: 'cookie' }
    },
    confirmationText: 'Accepting cookies and dismissing banner.',
    aliases: [
      'accept cookies',
      'allow cookies',
      'agree to cookies',
      'accept all cookies',
      'dismiss cookie banner'
    ],
    hinglishAliases: [
      'cookies accept karo',
      'cookie accept kar do',
      'cookies allow karo',
      'cookie banner hatao'
    ],
    phoneticKeys: ['AKSP', 'KKS']
  },

  // 26. Scroll to Top
  {
    id: 'scroll_to_top',
    canonicalIntent: 'scroll to top',
    toolCall: {
      function: 'scrollUp',
      arguments: { to: 'top' }
    },
    confirmationText: 'Scrolling to the top.',
    aliases: [
      'scroll to top',
      'go to top',
      'scroll to the top',
      'jump to top',
      'top of page',
      'back to top'
    ],
    hinglishAliases: [
      'page ke upar jao',
      'upar scroll karo',
      'sabse upar jao',
      'page ke shuruat me jao'
    ],
    phoneticKeys: ['SKRL', 'TP']
  },

  // 27. Scroll to Bottom
  {
    id: 'scroll_to_bottom',
    canonicalIntent: 'scroll to bottom',
    toolCall: {
      function: 'scrollDown',
      arguments: { to: 'bottom' }
    },
    confirmationText: 'Scrolling to the bottom.',
    aliases: [
      'scroll to bottom',
      'go to bottom',
      'scroll to the bottom',
      'jump to bottom',
      'scroll to end',
      'scroll all the way down'
    ],
    hinglishAliases: [
      'page ke niche jao',
      'niche scroll karo',
      'sabse niche jao',
      'page ke end me jao'
    ],
    phoneticKeys: ['SKRL', 'PTM']
  },

  // 28. Copy Page URL
  {
    id: 'copy_page_url',
    canonicalIntent: 'copy page url',
    toolCall: {
      function: 'copyToClipboard',
      arguments: { type: 'url' }
    },
    confirmationText: 'Copying page link to clipboard.',
    aliases: [
      'copy page url',
      'copy url',
      'copy link',
      'copy link of this page',
      'copy page address',
      'copy current url'
    ],
    hinglishAliases: [
      'link copy karo',
      'url copy karo',
      'page ka link copy karo',
      'link copy kar do'
    ],
    phoneticKeys: ['KP', 'RL']
  },

  // 29. Form Autofill & Application Copilot
  {
    id: 'autofill_form',
    canonicalIntent: 'autofill form',
    toolCall: {
      function: 'autofillForm',
      arguments: {}
    },
    confirmationText: 'Autofilling form fields with your profile.',
    aliases: [
      'fill this form',
      'fill form',
      'autofill form',
      'autofill this form',
      'fill the application',
      'fill application',
      'autofill application',
      'autofill my details',
      'autofill my resume',
      'fill in my information',
      'fill my details',
      'fill out this form',
      'fill out form',
      'autofill this application',
      'fill job application'
    ],
    hinglishAliases: [
      'ye form fill karo',
      'form bhar do',
      'form fill kar do',
      'application fill karo',
      'form bharo',
      'details fill karo',
      'application bhar do'
    ],
    phoneticKeys: ['FL', 'FRM', 'ATFL']
  }
]

// Build flattened Fuse.js search documents
interface SearchDoc {
  phrase: string
  entry: VoiceCommandEntry
}

const SEARCH_DOCS: SearchDoc[] = []
for (const entry of VOICE_COMMAND_REGISTRY) {
  for (const a of entry.aliases) {
    SEARCH_DOCS.push({ phrase: a.toLowerCase(), entry })
  }
  for (const h of entry.hinglishAliases) {
    SEARCH_DOCS.push({ phrase: h.toLowerCase(), entry })
  }
}

const fuseInstance = new Fuse(SEARCH_DOCS, {
  keys: ['phrase'],
  threshold: 0.35, // High precision fuzzy matching
  includeScore: true,
  ignoreLocation: true
})

/**
 * Matches spoken input (including Indian accents, phonetic near-misses, and Hinglish)
 * to a canonical Pentone command using Fuse.js and Double-Metaphone.
 */
export function matchVoiceIntent(rawTranscript: string): DetectedIntent | null {
  if (!rawTranscript || !rawTranscript.trim()) return null

  const cleaned = rawTranscript
    .toLowerCase()
    .replace(/[?.!,;:]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return null
  if (/\b(?:not|don't|don’t|never|without|unless)\b/i.test(rawTranscript)) return null
  if (/\b(?:cookies?|popups?|dialogs?|modals?|banners?|notifications?)\b/i.test(rawTranscript) && /\b(?:close|dismiss|reject|accept|allow|block)\b/i.test(rawTranscript)) return { toolCall: { function: 'inspectDialog', arguments: {} }, confirmationText: 'Inspecting the available dialog actions.' }
  const scoped = scopedTabCommand(rawTranscript)
  if (scoped) return { toolCall: scoped, confirmationText: 'Closing only the requested tabs.' }
  if (hasTabCloseIntent(rawTranscript) && /\b(?:all|every|left|right|except|apart|keep|before|after)\b/i.test(rawTranscript) && !isExactCloseAll(rawTranscript)) return null

  // 1. Direct Substring / Exact match against Hinglish and English aliases
  for (const doc of SEARCH_DOCS) {
    if (doc.entry.toolCall.function === 'closeTab' && cleaned !== doc.phrase) continue
    if (cleaned === doc.phrase || cleaned.includes(doc.phrase)) {
      return {
        toolCall: doc.entry.toolCall,
        confirmationText: doc.entry.confirmationText
      }
    }
  }

  // 2. Phonetic Double-Metaphone Match
  // E.g. "summer eyes" -> ['SMRS'], "summarize" -> ['SMRS']
  const inputCodes = getPhoneticCodes(cleaned)
  if (inputCodes.length > 0) {
    for (const entry of VOICE_COMMAND_REGISTRY) {
      if (entry.phoneticKeys.some(pk => inputCodes.includes(pk))) {
        // Double-check semantic intent for ambiguous single syllables
        if (entry.id === 'summarize_page' && (cleaned.includes('summer') || cleaned.includes('sum') || cleaned.includes('eyes') || cleaned.includes('page') || cleaned.includes('this'))) {
          return {
            toolCall: entry.toolCall,
            confirmationText: entry.confirmationText
          }
        }
        if (entry.id === 'close_all_tabs' && isExactCloseAll(rawTranscript)) {
          return {
            toolCall: entry.toolCall,
            confirmationText: entry.confirmationText
          }
        }
        if (entry.id === 'capture_screenshot' && (cleaned.includes('screen') || cleaned.includes('short') || cleaned.includes('shot') || cleaned.includes('snap'))) {
          return {
            toolCall: entry.toolCall,
            confirmationText: entry.confirmationText
          }
        }
      }
    }
  }

  // 3. Fuse.js Fuzzy Acoustic Distance Match
  const fuseResults = fuseInstance.search(cleaned)
  if (fuseResults && fuseResults.length > 0) {
    const bestMatch = fuseResults[0]
    if (bestMatch.item.entry.toolCall.function !== 'closeTab' && bestMatch.score !== undefined && bestMatch.score <= 0.38) {
      return {
        toolCall: bestMatch.item.entry.toolCall,
        confirmationText: bestMatch.item.entry.confirmationText
      }
    }
  }

  return null
}
