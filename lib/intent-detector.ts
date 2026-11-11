import type { ToolCall } from './tools'
import { matchVoiceIntent } from './voice-intent-matcher'
import { scopedTabCommand, hasTabCloseIntent, isExactCloseAll } from './browser/command-scope'
import { polishAcousticTranscript, polishSearchQuery } from './acoustic-normalizer'

export interface DetectedIntent {
  toolCall: ToolCall
  confirmationText: string
}

export interface IntentContext {
  activeTabUrl?: string
  activeTabTitle?: string
}

export interface SearchDestination {
  name: string
  buildUrl: (query: string) => string
  confirmationText: (query: string) => string
}

export function resolveSearchDestination(
  rawTarget: string | undefined,
  context?: IntentContext,
  isPlayAction?: boolean
): SearchDestination {
  const target = (rawTarget || '').toLowerCase().trim()
  const activeUrl = (context?.activeTabUrl || '').toLowerCase()

  // 1. Explicit target specified in the command
  if (target.includes('youtube') || target.includes('you tube') || isPlayAction) {
    return {
      name: 'YouTube',
      buildUrl: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
      confirmationText: (q) => isPlayAction ? `Playing "${q}" on YouTube.` : `Searching YouTube for "${q}".`
    }
  }
  if (target.includes('amazon')) {
    let host = 'www.amazon.com'
    if (activeUrl.includes('amazon.in')) host = 'www.amazon.in'
    else if (activeUrl.includes('amazon.co.uk')) host = 'www.amazon.co.uk'
    return {
      name: 'Amazon',
      buildUrl: (q) => `https://${host}/s?k=${encodeURIComponent(q)}`,
      confirmationText: (q) => `Searching Amazon for "${q}".`
    }
  }
  if (target.includes('github') || target.includes('git hub')) {
    return {
      name: 'GitHub',
      buildUrl: (q) => `https://github.com/search?q=${encodeURIComponent(q)}`,
      confirmationText: (q) => `Searching GitHub for "${q}".`
    }
  }
  if (target.includes('reddit')) {
    return {
      name: 'Reddit',
      buildUrl: (q) => `https://www.reddit.com/search/?q=${encodeURIComponent(q)}`,
      confirmationText: (q) => `Searching Reddit for "${q}".`
    }
  }
  if (target.includes('twitter') || target === 'x' || target.includes(' x ')) {
    return {
      name: 'X',
      buildUrl: (q) => `https://x.com/search?q=${encodeURIComponent(q)}`,
      confirmationText: (q) => `Searching X for "${q}".`
    }
  }
  if (target.includes('wikipedia')) {
    return {
      name: 'Wikipedia',
      buildUrl: (q) => `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`,
      confirmationText: (q) => `Searching Wikipedia for "${q}".`
    }
  }
  if (target.includes('spotify')) {
    return {
      name: 'Spotify',
      buildUrl: (q) => `https://open.spotify.com/search/${encodeURIComponent(q)}`,
      confirmationText: (q) => `Searching Spotify for "${q}".`
    }
  }
  if (target.includes('netflix')) {
    return {
      name: 'Netflix',
      buildUrl: (q) => `https://www.netflix.com/search?q=${encodeURIComponent(q)}`,
      confirmationText: (q) => `Searching Netflix for "${q}".`
    }
  }
  if (target.includes('maps')) {
    return {
      name: 'Google Maps',
      buildUrl: (q) => `https://www.google.com/maps/search/${encodeURIComponent(q)}`,
      confirmationText: (q) => `Searching Google Maps for "${q}".`
    }
  }
  if (target.includes('google')) {
    return {
      name: 'Google',
      buildUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
      confirmationText: (q) => `Searching Google for "${q}".`
    }
  }

  // 2. Context-aware destination: infer from active tab website
  if (activeUrl.includes('youtube.com') || activeUrl.includes('youtu.be')) {
    return {
      name: 'YouTube',
      buildUrl: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
      confirmationText: (q) => `Searching YouTube for "${q}".`
    }
  }
  if (activeUrl.includes('amazon.')) {
    let host = 'www.amazon.com'
    try { host = new URL(context!.activeTabUrl!).hostname } catch {}
    return {
      name: 'Amazon',
      buildUrl: (q) => `https://${host}/s?k=${encodeURIComponent(q)}`,
      confirmationText: (q) => `Searching Amazon for "${q}".`
    }
  }
  if (activeUrl.includes('github.com')) {
    return {
      name: 'GitHub',
      buildUrl: (q) => `https://github.com/search?q=${encodeURIComponent(q)}`,
      confirmationText: (q) => `Searching GitHub for "${q}".`
    }
  }
  if (activeUrl.includes('reddit.com')) {
    return {
      name: 'Reddit',
      buildUrl: (q) => `https://www.reddit.com/search/?q=${encodeURIComponent(q)}`,
      confirmationText: (q) => `Searching Reddit for "${q}".`
    }
  }
  if (activeUrl.includes('x.com') || activeUrl.includes('twitter.com')) {
    return {
      name: 'X',
      buildUrl: (q) => `https://x.com/search?q=${encodeURIComponent(q)}`,
      confirmationText: (q) => `Searching X for "${q}".`
    }
  }
  if (activeUrl.includes('wikipedia.org')) {
    return {
      name: 'Wikipedia',
      buildUrl: (q) => `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`,
      confirmationText: (q) => `Searching Wikipedia for "${q}".`
    }
  }
  if (activeUrl.includes('spotify.com')) {
    return {
      name: 'Spotify',
      buildUrl: (q) => `https://open.spotify.com/search/${encodeURIComponent(q)}`,
      confirmationText: (q) => `Searching Spotify for "${q}".`
    }
  }
  if (activeUrl.includes('netflix.com')) {
    return {
      name: 'Netflix',
      buildUrl: (q) => `https://www.netflix.com/search?q=${encodeURIComponent(q)}`,
      confirmationText: (q) => `Searching Netflix for "${q}".`
    }
  }
  if (activeUrl.includes('google.com/maps') || activeUrl.includes('maps.google.com')) {
    return {
      name: 'Google Maps',
      buildUrl: (q) => `https://www.google.com/maps/search/${encodeURIComponent(q)}`,
      confirmationText: (q) => `Searching Google Maps for "${q}".`
    }
  }

  // 3. Fallback: Default to Web / Google Search
  return {
    name: 'Google',
    buildUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
    confirmationText: (q) => `Searching Google for "${q}".`
  }
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
export function detectIntents(userInput: string, context?: IntentContext): DetectedIntent[] {
  if (!userInput || typeof userInput !== 'string') return []
  if (/\b(?:not|don't|don’t|never|without|unless)\b/i.test(userInput)) return []
  if (/\b(?:cookies?|popups?|dialogs?|modals?|banners?|notifications?)\b/i.test(userInput) && /\b(?:close|dismiss|reject|accept|allow|block)\b/i.test(userInput)) {
    if (/^\s*(?:please )?reject (?:all )?(?:optional )?cookies?[.!?]?\s*$/i.test(userInput)) return [{ toolCall: { function: 'rejectOptionalCookies', arguments: {} }, confirmationText: 'Rejecting optional cookies.' }]
    return [{ toolCall: { function: 'inspectDialog', arguments: {} }, confirmationText: 'Inspecting the available dialog actions.' }]
  }
  const scoped = scopedTabCommand(userInput)
  if (scoped) return [{ toolCall: scoped, confirmationText: 'Closing only the requested tabs.' }]
  if (hasTabCloseIntent(userInput) && !isExactCloseAll(userInput) && /\b(?:all|every|left|right|except|apart|keep|before|after)\b/i.test(userInput)) return []
  const tasks: DetectedIntent[] = []
  let remaining = polishAcousticTranscript(userInput.trim())

  // 1. Skip Video Ad (supports English, Hindi, Spanish, French, German, Italian, Portuguese, Russian, Japanese, Chinese, Arabic)
  const skipAdRegex = /(?:^|\s)(?:skip(?:\s+the|\s+this)?\s+ads?|skip\s+(?:the\s+)?video\s+ads?|close(?:\s+the|\s+this)?\s+ad|ad\s+skip|^skip$|saltar\s+anuncio|ignorer\s+l'annonce|passer\s+l'annonce|werbung\s+überspringen|salta\s+annuncio|pular\s+anúncio|пропустить\s+рекламу|広告をスキップ|跳过广告|تخطي\s+الإعلان|تخطي\s+الاعلان|विज्ञापन\s+छोड़ें|विज्ञापन\s+हटाओ|ad\s+hatao)(?:\s|[?.!,;:]|$)/i
  const skipAdMatch = remaining.match(skipAdRegex)
  if (skipAdMatch) {
    tasks.push({
      toolCall: {
        function: 'clickSkipButton',
        arguments: {}
      },
      confirmationText: 'Skipping the ad.'
    })
    remaining = remaining.replace(skipAdMatch[0], ' ')
  }

  // 1. Video & Song / Music Item Clicking & Playing (e.g. "open the first video", "play the second video", "play the songs", "play the song", "play music", "gaana chalao", "primer video", "premiere chanson")
  const mediaItemRegex = /\b(?:open|play|watch|click|start|listen\s+to|reproducir|poner|escuchar|jouer|écouter|ecouter|lancer|ouvrir|regarder|abspielen|anhören|riproduci|ascolta|tocar|ouvir|включи|воспроизведи|поставь|再生|播放|شغل|اسمع)\s+(?:the\s+|this\s+|that\s+|la\s+|el\s+|les\s+|le\s+|das\s+|der\s+|die\s+|il\s+|lo\s+|a\s+|o\s+)?(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|#?\d+|top|primer[ao]?|première?|erste[rs]?|primo|primeir[ao]|перв(?:ое|ый|ую)|最初|第[一二三四五1-5]|الأول|pehla|pehli|पहला|segundo|deuxième|zweite|secondo|втор(?:ое|ой|ую)|第二|الثاني|doosra|doosri|दूसरा)?\s*(videos?|v[ií]deos?|видео|動画|视频|فيديو|songs?|canci[oó]n(?:es)?|chansons?|lied(?:er)?|canzon[ei]|can[cç][aã]o|can[cç][oõ]es|песн(?:я|и|ю)|曲|歌|गाने?|गाना|गीत|الأغاني|أغنية|اغنية|music|m[uú]sica|musique|musik|музык[уа]|音楽|موسيقى|tracks?|pistas?|morceaux?|stücke?|brani|faixas?|треки?)(?:\s+(#?\d+|first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th))?\b/i
  const hindiMediaSuffixRegex = /\b(?:(pehla|pehli|doosra|doosri|teesra|पहला|दूसरा|तीसरा)?\s*(?:gaana|gana|geet|video|गाना|गाने|गीत|वीडियो)\s+(?:chalao|bajao|chala\s+do|baja\s+do|chala|play\s+karo|चलाओ|बजाओ|सुनाओ))\b/i
  const jaMediaRegex = /(?:(最初|第[一二1-2])(?:の)?)?\s*(動画|曲|音楽)を(?:再生|かけて|流して|開いて)/i

  let vMatch = remaining.match(mediaItemRegex)
  if (!vMatch) {
    vMatch = remaining.match(hindiMediaSuffixRegex)
  }
  if (!vMatch) {
    vMatch = remaining.match(jaMediaRegex)
  }

  if (vMatch) {
    const rawOrd = (vMatch[1] || vMatch[3] || 'first').toLowerCase().replace('#', '')
    const ordMap: Record<string, number> = {
      first: 0, '1st': 0, '1': 0, primer: 0, primera: 0, premier: 0, 'première': 0, erste: 0, erster: 0, primo: 0, primeiro: 0, primeira: 0, 'первое': 0, 'первый': 0, 'первую': 0, '最初': 0, '第一': 0, '第一首': 0, '第一个': 0, 'الأول': 0, pehla: 0, pehli: 0, 'पहला': 0, top: 0, this: 0, that: 0,
      second: 1, '2nd': 1, '2': 1, segundo: 1, segunda: 1, 'deuxième': 1, zweite: 1, zweiter: 1, secondo: 1, 'второе': 1, 'второй': 1, 'вторую': 1, '第二': 1, '第二首': 1, '第二个': 1, 'الثاني': 1, doosra: 1, doosri: 1, 'दूसरा': 1,
      third: 2, '3rd': 2, '3': 2, tercero: 2, trasera: 2, 'troisième': 2, dritte: 2, dritter: 2, terzo: 2, terceir: 2, 'третье': 2, 'третий': 2, 'третью': 2, '第三': 2, 'الثالث': 2, teesra: 2, teesri: 2, 'तीसरा': 2,
      fourth: 3, '4th': 3, '4': 3,
      fifth: 4, '5th': 4, '5': 4
    }
    const idx = ordMap[rawOrd] ?? (parseInt(rawOrd, 10) > 0 ? parseInt(rawOrd, 10) - 1 : 0)
    const ordName = Object.keys(ordMap).find(k => ordMap[k] === idx && isNaN(Number(k))) || 'first'

    const matchedStr = vMatch[0].toLowerCase()
    const isSong = /(?:songs?|gaana|gana|geet|canci[oó]n(?:es)?|chansons?|lied(?:er)?|canzon[ei]|can[cç][aã]o|can[cç][oõ]es|песн(?:я|и|ю)|曲|歌|गाने?|गाना|गीत|الأغاني|أغنية|اغنية)/i.test(matchedStr)
    const isMusic = /(?:music|m[uú]sica|musique|musik|musica|музык[уа]|音楽|موسيقى)/i.test(matchedStr)
    const itemCategory = isSong ? 'song' : (isMusic ? 'music' : 'video')

    const conf = isSong 
      ? `Playing the ${ordName} song.`
      : isMusic 
        ? 'Playing the music.'
        : `Opening the ${ordName} video.`

    tasks.push({
      toolCall: {
        function: 'clickElement',
        arguments: { query: `${ordName} ${itemCategory}`, ordinal: idx }
      },
      confirmationText: conf
    })
    remaining = remaining.replace(vMatch[0], ' ')
  }

  // 1B. Media Playback Controls (pause, play/resume, mute, unmute, speed, seek, restart, fullscreen)
  const mediaPauseRegex = /\b(?:pause(?:\s+(?:the\s+)?video|\s+(?:the\s+)?playback|\s+(?:the\s+)?media)?|stop\s+(?:the\s+)?video|pause\s+it|pausar(?:\s+v[ií]deo)?|mettre\s+en\s+pause|anhalten|metti\s+in\s+pausa|поставь\s+на\s+паузу|一時停止|暂停(?:视频)?|إيقاف\s+مؤقت|रोक\s+दो|rok\s+do)\b/i
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

  const mediaPlayRegex = /\b(?:resume(?:\s+(?:the\s+)?video|\s+(?:the\s+)?playback|\s+(?:the\s+)?media)?|unpause(?:\s+(?:the\s+)?video)?|play\s+(?:the\s+)?video|continue\s+playing|reanudar|reprendre\s+la\s+vidéo|fortsetzen|riprendi|retomar|продолжить(?:\s+видео)?|再開|继续播放|استئناف|जारी\s+रखो)\b/i
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

  const mediaMuteRegex = /\b(?:mute(?:\s+(?:the\s+)?(?:video|audio|tab|page|sound))?|sound\s+off|turn\s+off\s+(?:the\s+)?sound|silenciar|couper\s+le\s+son|stummschalten|disattiva\s+audio|выключи\s+звук|ミュート|静音|كتم\s+الصوت|आवाज़\s+बंद)\b/i
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

  const mediaUnmuteRegex = /\b(?:unmute(?:\s+(?:the\s+)?(?:video|audio|tab|page|sound))?|sound\s+on|turn\s+on\s+(?:the\s+)?sound|activar\s+sonido|activer\s+le\s+son|ton\s+an|attiva\s+audio|desmutar|включи\s+звук|ミュート解除|取消静音|إلغاء\s+كتم\s+الصوت|आवाज़\s+चालू)\b/i
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

  const mediaFullscreenRegex = /\b(?:full\s*screen(?:\s+mode)?|make(?:\s+(?:it|the\s+video))?\s+full\s*screen|exit\s+full\s*screen|pantalla\s+completa|plein\s+écran|vollbild|schermo\s+intero|tela\s+cheia|на\s+весь\s+экран|全画面表示|全屏|شاشة\s+كاملة|फुल\s+स्क्रीन)\b/i
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

  // 4C. Form Autofill & Application Copilot (e.g. "fill this form", "autofill form", "fill the application", "fill my details", "form bhar do")
  const autofillRegex = /\b(?:autofill(?:\s+(?:this|the|my)?\s*(?:form|application|details|profile|info(?:rmation)?|page|resume))?|fill(?:\s+(?:in|out))?\s+(?:this|the|my)?\s*(?:form|application|details|profile|info(?:rmation)?|data|resume)|form\s+(?:fill|bhar)\s*(?:karo|kar\s*do|do))\b/i
  const autofillMatch = remaining.match(autofillRegex)
  if (autofillMatch) {
    tasks.push({
      toolCall: {
        function: 'autofillForm',
        arguments: {}
      },
      confirmationText: 'Autofilling form fields with your profile.'
    })
    remaining = remaining.replace(autofillMatch[0], ' ')
  }

  // 5. Browser History & Page Navigation (go back, go forward, reload/refresh)
  const backRegex = /\b(?:go\s+back(?:\s+to\s+(?:the\s+)?previous\s+page|\s+page)?|back(?:\s+to\s+(?:the\s+)?previous\s+page)?|previous\s+page|volver|página\s+anterior|retour|page\s+précédente|zurück|vorherige\s+seite|indietro|pagina\s+precedente|voltar|назад|предыдущая\s+страница|戻る|前のページ|返回|上一页|رجوع|الصفحة\s+السابقة|पीछे\s+जाओ|पिछला\s+पेज)\b/i
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
    const fwdRegex = /\b(?:go\s+forward(?:\s+to\s+(?:the\s+)?next\s+page|\s+page)?|forward(?:\s+to\s+(?:the\s+)?next\s+page)?|next\s+page|avanzar|página\s+siguiente|page\s+suivante|vorwärts|nächste\s+seite|avanti|pagina\s+successiva|avançar|próxima\s+página|вперед|следующая\s+страница|進む|次のページ|前进|下一页|تقدم|الصفحة\s+التالية|आगे\s+जाओ|अगला\s+पेज)\b/i
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
      const reloadRegex = /\b(?:reload(?:\s+the)?(?:\s+page|\s+tab)?|refresh(?:\s+the)?(?:\s+page|\s+tab)?|recargar(?:\s+página)?|actualizar(?:\s+página)?|recharger(?:\s+la\s+page)?|actualiser|neu\s+laden|ricarica(?:\s+pagina)?|recarregar(?:\s+página)?|перезагрузи(?:\s+страницу)?|обновить\s+страницу|再読み込み|リロード|刷新页面|重新加载|إعادة\s+تحميل(?:\s+الصفحة)?|تحديث\s+الصفحة|रीलोड|रिफ्रेश)\b/i
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
      } else {
        // 5B. Specific Site Home / Main Page (e.g. "go to main youtube page", "go to youtube home page", "go to youtube homepage", "youtube main page", "youtube home")
        const siteHomeRegex = /\b(?:go\s+to\s+(?:the\s+)?(?:main|home)\s+(?!page\b)([a-z0-9.-]+)(?:\s+(?:main\s+|home\s+)?page)?|go\s+to\s+(?:the\s+)?(?!main\b|home\b|the\b)([a-z0-9.-]+)\s+(?:main|home|homepage)(?:\s+page)?|(?:the\s+)?(?!the\b|main\b|home\b)([a-z0-9.-]+)\s+(?:main|home)\s+page|open\s+(?:the\s+)?(?:main\s+|home\s+)?(?!page\b)([a-z0-9.-]+)\s+(?:main|home|homepage)(?:\s+page)?|(?!the\b|main\b|home\b)([a-z0-9.-]+)\s+(?:ke\s+)?(?:main|home)\s+page(?:\s+pe\s+jao)?)\b/i
        const siteHomeMatch = remaining.match(siteHomeRegex)
        const rawSite = siteHomeMatch ? (siteHomeMatch[1] || siteHomeMatch[2] || siteHomeMatch[3] || siteHomeMatch[4] || siteHomeMatch[5] || '').toLowerCase() : ''
        if (siteHomeMatch && (COMMON_SITES[rawSite] || (rawSite.includes('.') && rawSite.length > 3))) {
          const destinationUrl = COMMON_SITES[rawSite] || `https://www.${rawSite}.com`
          const siteName = rawSite.charAt(0).toUpperCase() + rawSite.slice(1)
          const isAlreadyOnSite = (context?.activeTabUrl && context.activeTabUrl.toLowerCase().includes(rawSite)) ||
                                  (context?.activeTabTitle && context.activeTabTitle.toLowerCase().includes(rawSite))
          
          if (isAlreadyOnSite) {
            tasks.push({
              toolCall: {
                function: 'navigatePage',
                arguments: { action: 'url', url: destinationUrl }
              },
              confirmationText: `Navigating to the main ${siteName} page.`
            })
          } else {
            tasks.push({
              toolCall: {
                function: 'openTab',
                arguments: { url: destinationUrl }
              },
              confirmationText: `Opening ${siteName}.`
            })
          }
          remaining = remaining.replace(siteHomeMatch[0], ' ')
        } else {
          // 5C. Generic Home / Main Page (e.g. "go to home page", "go to main page", "go to the home page", "go to homepage", "home page pe jao", "main page pe jao", "go home")
          const homeRegex = /\b(?:go\s+to\s+(?:the\s+)?(?:main|home)(?:\s+page)?|go\s+home|home\s+page|main\s+page|homepage|start\s+page|página\s+principal|página\s+de\s+inicio|page\s+d'accueil|startseite|pagina\s+iniziale|página\s+inicial|главная\s+страница|на\s+главную|ホームページ(?:に行く)?|トップページ|去主页|回首页|首页|الصفحة\s+الرئيسية|होम\s+पेज|मेन\s+पेज|home\s+page\s+pe\s+jao|main\s+page\s+pe\s+jao)\b/i
          const homeMatch = remaining.match(homeRegex)
          if (homeMatch) {
            tasks.push({
              toolCall: {
                function: 'navigatePage',
                arguments: { action: 'home' }
              },
              confirmationText: 'Going to the home page.'
            })
            remaining = remaining.replace(homeMatch[0], ' ')
          } else {
            // 5D. Explicit Same-Tab Navigation (e.g. "navigate to youtube", "go to youtube in this tab", "open google in same tab", "change page to github.com")
            const sameTabRegex = /\b(?:navigate\s+to|change\s+page\s+to|go\s+to\s+url)\s+(https?:\/\/[^\s]+|[a-z0-9.-]+(?:\.[a-z]{2,})?)\b|\b(?:open|go\s+to)\s+(https?:\/\/[^\s]+|[a-z0-9.-]+(?:\.[a-z]{2,})?)\s+(?:in\s+(?:this|the\s+same|same)\s+tab|isi\s+tab\s+me(?:i?n)?)\b/i
            const sameTabMatch = remaining.match(sameTabRegex)
            if (sameTabMatch) {
              const target = (sameTabMatch[1] || sameTabMatch[2] || '').toLowerCase()
              const destUrl = COMMON_SITES[target] || (target.startsWith('http') ? target : `https://${target}`)
              const cleanName = target.charAt(0).toUpperCase() + target.slice(1)
              tasks.push({
                toolCall: {
                  function: 'navigatePage',
                  arguments: { action: 'url', url: destUrl }
                },
                confirmationText: `Navigating to ${cleanName} in this tab.`
              })
              remaining = remaining.replace(sameTabMatch[0], ' ')
            }
          }
        }
      }
    }
  }

  // 6. Media Play Request ("open YouTube and play sweater weather song", "play bure din by seedhe maut", "play song X", "reproducir X", "spiele X", "écouter X")
  // 6A. Open Media Site and Play ("open YouTube and play sweater weather song", "YouTube and play bure din", "abrir youtube y reproducir X")
  const openAndPlayRegex = /\b(?:(?:open\s+|go\s+to\s+|on\s+|abrir\s+|ouvrir\s+|gehe\s+zu\s+|vai\s+su\s+|открой\s+|افتح\s+)?(youtube|spotify|netflix)\s+(?:and\s+|to\s+|y\s+|et\s+|und\s+|e\s+|и\s+|و\s+)?(?:play|listen\s+to|reproducir|escuchar|jouer|écouter|spiele|abspielen|riproduci|ascolta|tocar|ouvir|включи|поставь|воспроизведи|شغل|اسمع)\s+(?:(?:the\s+)?(?:song|music|track|video|canción|música|la\s+chanson|lied|canzone|canção|песню)\s+)?)(?!video\b|the\s+video\b|song\b|songs\b|the\s+song\b|the\s+songs\b)(.+?)(?=(?:\s+(?:and\s+then|then|and\s+also)\s+|\s+and\s+(?:remember|store|save|check|take|open|go\s+to|navigate|summarize|list|find|show|close|shut|kill)\b|,\s*|\s+remember\s+|\s+store\s+in\s+memory|\s+check\s+|\s+take\s+a\s+screenshot|\s+summarize\s+|\s+close\s+|$))/i

  // 6B. Play on Media Site ("play sweater weather song on YouTube", "reproduce X en youtube")
  const playOnSiteRegex = /(?:^|\s)(?:play|listen\s+to|reproducir|escuchar|jouer|écouter|spiele|abspielen|riproduci|ascolta|tocar|ouvir|включи|поставь|воспроизведи|شغل|اسمع)\s+(?:(?:the\s+)?(?:song|music|track|video|canción|música|la\s+chanson|lied|canzone|canção|песню)\s+)?(?!video\b|videos\b|the\s+video\b|the\s+videos\b|song\b|songs\b|the\s+song\b|the\s+songs\b|music\b|the\s+music\b)(.+?)\s+(?:on|in|en|sur|auf|su|no|на|في|में|पर)\s+(youtube|spotify|netflix)\b/i

  // 6C. Direct Play Request ("play bure din by seedhe maut", "play sweater weather song")
  const playMediaRegex = /(?:^|\s)(?:play|listen\s+to|reproducir|pon|escuchar|jouer|écouter|ecouter|spiele|abspielen|riproduci|ascolta|tocar|ouvir|включи|воспроизведи|поставь|شغل|اسمع)\s+(?:(?:the\s+)?(?:song|music|track|video|canción|música|la\s+chanson|lied|canzone|canção|песню|музыку)\s+)?(?!video\b|videos\b|the\s+video\b|the\s+videos\b|song\b|songs\b|the\s+song\b|the\s+songs\b|this\s+song\b|that\s+song\b|music\b|the\s+music\b|track\b|tracks\b|the\s+track\b|the\s+tracks\b|media\b|playback\b|audio\b|it\b|first\b|second\b|third\b|fourth\b|fifth\b|1st\b|2nd\b|3rd\b|4th\b|5th\b|#?\d+\b|canción\b|canciones\b|chanson\b|chansons\b|lied\b|lieder\b|canzone\b|canzoni\b|canção\b|canções\b|песн[яию]\b|музык[уа]\b|曲\b|歌\b|गाना\b|गाने\b|गीत\b)(.+?)(?=(?:\s+(?:and\s+then|then|and\s+also)\s+|\s+and\s+(?:remember|store|save|check|take|open|go\s+to|navigate|summarize|list|find|show|close|shut|kill)\b|,\s*|\s+remember\s+|\s+store\s+in\s+memory|\s+check\s+|\s+take\s+a\s+screenshot|\s+summarize\s+|\s+close\s+|$))/i

  let searchHandled = false
  const openAndPlayMatch = remaining.match(openAndPlayRegex)
  if (openAndPlayMatch) {
    const rawSite = openAndPlayMatch[1] || 'youtube'
    const rawQuery = (openAndPlayMatch[2] || '').trim()
    const q = polishSearchQuery(rawQuery)
    if (q) {
      const destination = resolveSearchDestination(rawSite, context, true)
      tasks.push({
        toolCall: {
          function: 'openTab',
          arguments: { url: destination.buildUrl(q), autoPlay: true }
        },
        confirmationText: destination.confirmationText(q)
      })
      remaining = remaining.replace(openAndPlayMatch[0], ' ')
      searchHandled = true
    }
  }

  if (!searchHandled) {
    const playOnSiteMatch = remaining.match(playOnSiteRegex)
    if (playOnSiteMatch) {
      const rawQuery = (playOnSiteMatch[1] || '').trim()
      const rawSite = playOnSiteMatch[2] || 'youtube'
      const q = polishSearchQuery(rawQuery)
      if (q) {
        const destination = resolveSearchDestination(rawSite, context, true)
        tasks.push({
          toolCall: {
            function: 'openTab',
            arguments: { url: destination.buildUrl(q), autoPlay: true }
          },
          confirmationText: destination.confirmationText(q)
        })
        remaining = remaining.replace(playOnSiteMatch[0], ' ')
        searchHandled = true
      }
    }
  }

  if (!searchHandled) {
    let playMatch = remaining.match(playMediaRegex)
    if (!playMatch) {
      const suffixPlayMatch = remaining.match(/^(.+?)\s+(?:chalao|chala\s+do|play\s+karo|baja\s+do|चलाओ|प्ले\s+करो|बजाओ)$/i)
        || remaining.match(/^(.+?)を(?:再生|かけて|流して)(?:して)?$/i)
        || remaining.match(/^(?:播放|放一首)(.+)$/i)
      if (suffixPlayMatch) {
        playMatch = suffixPlayMatch
      }
    }
    if (playMatch) {
      const rawQuery = (playMatch[1] || '').trim()
      const q = polishSearchQuery(rawQuery)
      if (q) {
        const destination = resolveSearchDestination('youtube', context, true)
        tasks.push({
          toolCall: {
            function: 'openTab',
            arguments: { url: destination.buildUrl(q), autoPlay: true }
          },
          confirmationText: destination.confirmationText(q)
        })
        remaining = remaining.replace(playMatch[0], ' ')
        searchHandled = true
      }
    }
  }

  // 7. Site-Specific Search:
  // Pattern A: "search for X on <site>", "buscar X en <site>", "suche nach X auf <site>"
  const searchOnSiteRegex = /(?:^|\s)(?:search\s+(?:for\s+|about\s+)?|buscar\s+(?:por\s+|sobre\s+)?|chercher\s+(?:sur\s+)?|rechercher\s+(?:sur\s+)?|suche\s+(?:nach\s+)?|cerca\s+(?:su\s+)?|pesquisar\s+(?:sobre\s+)?|найди\s+(?:на\s+)?|ابحث\s+عن\s+)(.+?)\s+(?:on|in|en|sur|auf|su|no|на|في|में|पर)\s+(youtube|google|amazon|github|reddit|twitter|x|wikipedia|spotify|netflix|maps)\b/i
  // Pattern B: "open <site> and search for X", "<site> search for X", "search <site> for X"
  const openAndSearchRegex = /\b(?:(?:open\s+|go\s+to\s+|on\s+|abrir\s+|ouvrir\s+|gehe\s+zu\s+|vai\s+su\s+|открой\s+|افتح\s+)?(youtube|google|amazon|github|reddit|twitter|x|wikipedia|spotify|netflix|maps)\s+(?:and\s+|to\s+|y\s+|et\s+|und\s+|e\s+|и\s+|و\s+)?(?:search|buscar|chercher|suche|cerca|pesquisar|найди|ابحث)\s+(?:for\s+|about\s+|por\s+|sur\s+|nach\s+|su\s+|sobre\s+|на\s+|عن\s+)?|(?:search|buscar|chercher|suche|cerca|pesquisar|найди|ابحث)\s+(youtube|google|amazon|github|reddit|twitter|x|wikipedia|spotify|netflix|maps)\s+(?:for\s+|about\s+|por\s+|sur\s+|nach\s+|su\s+|sobre\s+|на\s+|عن\s+)?)(.+?)(?=(?:\s+(?:and\s+then|then|and\s+also)\s+|\s+and\s+(?:remember|store|save|check|take|open|go\s+to|navigate|summarize|list|find|show|close|shut|kill)\b|,\s*|\s+remember\s+|\s+store\s+in\s+memory|\s+check\s+|\s+take\s+a\s+screenshot|\s+summarize\s+|\s+close\s+|$))/i
  // Pattern C: Japanese site search (e.g. "youtubeでPythonを検索")
  const jaSiteSearchRegex = /(?:^|\s)(youtube|google|amazon|github|reddit|twitter|x|wikipedia|spotify|netflix|maps)(?:で)?\s*(?:を)?(.+?)\s*(?:を)?検索(?:して)?(?:\s|$)/i
  // Pattern D: Chinese site search (e.g. "在youtube上搜索机器学习")
  const zhSiteSearchRegex = /(?:^|\s)(?:在)?\s*(youtube|google|amazon|github|reddit|twitter|x|wikipedia|spotify|netflix|maps)(?:上)?\s*(?:搜索|找一下)\s*(.+?)(?:\s|$)/i

  if (!searchHandled) {
    const onSiteMatch = remaining.match(searchOnSiteRegex)
    if (onSiteMatch) {
      const rawQuery = onSiteMatch[1] || ''
      const rawSite = onSiteMatch[2] || ''
      const q = polishSearchQuery(rawQuery)
      if (q) {
        const destination = resolveSearchDestination(rawSite, context)
        const isYT = destination.name === 'YouTube'
        tasks.push({
          toolCall: {
            function: 'openTab',
            arguments: { url: destination.buildUrl(q) }
          },
          confirmationText: isYT ? `Opening YouTube and searching for "${q}".` : destination.confirmationText(q)
        })
        remaining = remaining.replace(onSiteMatch[0], ' ')
        searchHandled = true
      }
    } else {
      const openSearchMatch = remaining.match(openAndSearchRegex)
      if (openSearchMatch) {
        const rawSite = openSearchMatch[1] || openSearchMatch[2] || ''
        const rawQuery = openSearchMatch[3] || ''
        const q = polishSearchQuery(rawQuery)
        if (q) {
          const destination = resolveSearchDestination(rawSite, context)
          const isYT = destination.name === 'YouTube'
          tasks.push({
            toolCall: {
              function: 'openTab',
              arguments: { url: destination.buildUrl(q) }
            },
            confirmationText: isYT ? `Opening YouTube and searching for "${q}".` : destination.confirmationText(q)
          })
          remaining = remaining.replace(openSearchMatch[0], ' ')
          searchHandled = true
        }
      } else {
        const jaMatch = remaining.match(jaSiteSearchRegex)
        const zhMatch = !jaMatch ? remaining.match(zhSiteSearchRegex) : null
        const cjkMatch = jaMatch || zhMatch
        if (cjkMatch) {
          const rawSite = cjkMatch[1] || ''
          const rawQuery = cjkMatch[2] || ''
          const q = polishSearchQuery(rawQuery)
          if (q) {
            const destination = resolveSearchDestination(rawSite, context)
            const isYT = destination.name === 'YouTube'
            tasks.push({
              toolCall: {
                function: 'openTab',
                arguments: { url: destination.buildUrl(q) }
              },
              confirmationText: isYT ? `Opening YouTube and searching for "${q}".` : destination.confirmationText(q)
            })
            remaining = remaining.replace(cjkMatch[0], ' ')
            searchHandled = true
          }
        }
      }
    }
  }

  // 8. General & Context-Aware Search (e.g. "search for...", "buscar...", "suche...", "chercher...")
  // Intelligently checks active tab: if user is on YouTube, searches YouTube; if on Amazon, searches Amazon; etc.
  if (!searchHandled) {
    const searchRegex = /\b(?:(?:search|look\s+up|find|buscar|busca|chercher|cherche|rechercher|suche|suchen|cerca|cercare|pesquisar|procure|найди|поищи|ابحث\s+عن|ابحث)\s+(?:for\s+|about\s+|por\s+|nach\s+)?)+(?!this\s+page\b|the\s+page\b|vault\b|memories\b|memory\b|tabs\b|types\b|button\b|box\b|bar\b|field\b|input\b)(.+?)(?=(?:\s+(?:and\s+then|then|and\s+also)\s+|\s+and\s+(?:remember|store|save|check|take|open|go\s+to|navigate|summarize|list|find|show|close|shut|kill|scroll|switch|listen)\b|,\s*|\s+remember\s+|\s+store\s+in\s+memory|\s+check\s+|\s+take\s+a\s+screenshot|\s+summarize\s+|\s+close\s+|$))/i
    let sMatch = remaining.match(searchRegex)
    if (!sMatch) {
      const suffixSearchMatch = remaining.match(/^(.+?)\s*(?:を検索(?:して)?|ढूंढो|खोजो|सर्च\s+करो)$/i)
      if (suffixSearchMatch) {
        sMatch = suffixSearchMatch
      }
    }
    if (sMatch) {
      const rawQuery = (sMatch[1] || '').trim()
      const q = polishSearchQuery(rawQuery)
      if (q) {
        const destination = resolveSearchDestination(undefined, context)
        tasks.push({
          toolCall: {
            function: 'openTab',
            arguments: { url: destination.buildUrl(q) }
          },
          confirmationText: destination.confirmationText(q)
        })
        remaining = remaining.replace(sMatch[0], ' ')
        searchHandled = true
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
  const navRegex = /\b(?:open|go\s+to|navigate\s+to|launch)\s+(?:the\s+)?(?:website\s+|site\s+|page\s+)?(?!what\b|which\b|my\b|and\b|this\b)([a-z0-9.-]+)(?:\s+(?:website|site|page))?(?:\s+(?:in\s+(?:this|the\s+same|same)\s+tab|isi\s+tab\s+me(?:i?n)?))?\b/gi
  let navMatch: RegExpExecArray | null
  while ((navMatch = navRegex.exec(remaining)) !== null) {
    const site = navMatch[1].toLowerCase()
    const url = COMMON_SITES[site] || (site.includes('.') && site.length > 3 ? `https://${site}` : null)
    if (url) {
      const isSameTab = navMatch[0].toLowerCase().includes('this tab') || navMatch[0].toLowerCase().includes('same tab') || navMatch[0].toLowerCase().startsWith('navigate to')
      if (isSameTab) {
        tasks.push({
          toolCall: { function: 'navigatePage', arguments: { action: 'url', url } },
          confirmationText: `Navigating to ${site.charAt(0).toUpperCase() + site.slice(1)} in this tab.`
        })
      } else {
        tasks.push({
          toolCall: { function: 'openTab', arguments: { url } },
          confirmationText: `Opening ${site.charAt(0).toUpperCase() + site.slice(1)}.`
        })
      }
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
  const otherTabsMatch = remaining.match(/\b(?:close|shut|kill|cerrar|cierra|fermer|schließe|chiudi|fechar|fecha|закрой)\s+(?:(?:all\s+(?:the\s+)?|every\s+|the\s+)?other\s+tabs?|tabs?\s+except\s+(?:this|current|active)(?:\s+one)?|las\s+demás\s+pestañas|otras\s+pestañas|les\s+autres\s+onglets|andere\s+tabs|le\s+altre\s+schede|as\s+outras\s+abas|остальные\s+вкладки)\b|^(?:他のタブを閉じて|关闭其他标签页|أغلق التبويبات الأخرى|बाकी टैब बंद करो)$/i)
  if (otherTabsMatch) {
    tasks.push({
      toolCall: { function: 'closeTab', arguments: { other: true } },
      confirmationText: 'Closing other tabs.'
    })
    remaining = remaining.replace(otherTabsMatch[0], ' ')
  } else {
    // 2. Close all tabs
    const allTabsMatch = remaining.match(/\b(?:close|shut|kill|cerrar|cierra|fermer|schließe|chiudi|fechar|fecha|закрой)\s+(?:all\s+(?:the\s+|my\s+|open\s+|of\s+my\s+)?tabs?|every\s+tab|todas\s+las\s+pestañas|tous\s+les\s+onglets|alle\s+tabs|tutte\s+le\s+schede|todas\s+as\s+abas|все\s+вкладки)\b|^(?:すべてのタブを閉じて|关闭所有标签页|أغلق كل التبويبات|सारे टैब बंद करो|सभी टैब बंद करो)$/i)
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
              const currentTabMatch = remaining.match(/\b(?:close|shut|kill|cerrar|cierra|fermer|schließe|chiudi|fechar|fecha|закрой)\s+(?:(?:this|the|my|current|active|esta|cet|diesen|questa|esta|эту)\s+)*(?:tabs?|pestañas?|onglets?|schede|abas?|вкладки?)\b|^(?:このタブを閉じて|关闭此标签页|关闭当前标签页|关闭标签页|أغلق هذا التبويب|यह टैब बंद करो|ये टैब बंद करो|टैब बंद करो)$/i)
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
  const screenshotRegex = /\b(?:take\s+a\s+screenshot(?:\s+of\s+(?:this\s+)?(?:page|speech|screen|tab|sheet))?|capture\s+(?:a\s+)?screenshot|capture\s+(?:this\s+)?(?:screen|speech|page)|screenshot\s+this\s+(?:page|speech|tab|screen)|captura\s+de\s+pantalla|tomar\s+captura|capture\s+d'écran|screenshot\s+machen|bildschirmfoto|cattura\s+schermo|tirar\s+print|capturar\s+tela|сделай\s+скриншот|снимок\s+экрана|スクリーンショットを撮って|画面キャプチャ|截屏|截图|لقطة\s+شاشة|स्क्रीनशॉट\s+लो)\b/i
  const ssMatch = remaining.match(screenshotRegex)
  if (ssMatch) {
    tasks.push({
      toolCall: { function: 'captureScreenshot', arguments: {} },
      confirmationText: 'Capturing a screenshot of the page.'
    })
    remaining = remaining.replace(ssMatch[0], ' ')
  }

  // 8. Page summary (supports "summarize this page", "summarise this page", "summarize", "summarise", "give me a summary", "summary of this page")
  const summaryRegex = /\b(?:summari[sz][e|es|ing]?(?:\s+(?:this\s+page|the\s+page|this|the\s+article|key\s+points|article))?|give\s+me\s+(?:a\s+)?(?:summary|the\s+key\s+points|key\s+points)(?:\s+of\s+(?:this\s+page|the\s+page|this))?|summar[y|ies]\s+(?:of\s+)?(?:this\s+page|the\s+page|this)|resumir(?:\s+esta\s+página)?|resumen\s+de\s+(?:la\s+)?página|résumer(?:\s+cette\s+page)?|résumé\s+de\s+(?:la\s+)?page|fasse\s+diese\s+seite\s+zusammen|seite\s+zusammenfassen|riassumi(?:\s+questa\s+pagina)?|resumir\s+esta\s+página|обобщи\s+эту\s+страницу|краткое\s+содержание\s+страницы|このページを要約(?:して)?|要約して|总结这个页面|总结本页|页面摘要|لخص\s+هذه\s+الصفحة|تلخيص\s+الصفحة|सारांश\s+बताओ|समरी\s+बताओ)\b/i
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
export function detectIntent(userInput: string, context?: IntentContext): DetectedIntent | null {
  const all = detectIntents(userInput, context)
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

  // 8. Multilingual creator queries (Spanish, French, German, Italian, Portuguese, Russian, Japanese, Chinese, Arabic, Hindi Devanagari)
  const multilingualRegex = /(?:^|\s)(?:quién\s+te\s+(?:creó|hizo)|quién\s+es\s+tu\s+creador|qui\s+t'a\s+(?:créé|fait)|qui\s+est\s+ton\s+créateur|wer\s+hat\s+dich\s+(?:erschaffen|gemacht)|wer\s+ist\s+dein\s+schöpfer|chi\s+ti\s+ha\s+creato|chi\s+è\s+il\s+tuo\s+creatore|quem\s+te\s+criou|quem\s+é\s+o\s+seu\s+criador|кто\s+тебя\s+создал|кто\s+твой\s+создатель|誰があなたを作った(?:の|か)?|あなたの開発者|谁创造了你|你的开发者是谁|谁做了你|من\s+(?:صنعك|خلقك|طورك)|तुम्हें\s+किसने\s+बनाया|तुम्हारा\s+निर्माता\s+कौन)(?:\s|[?.!,;:の]|$)/i

  return actionRegex.test(clean) || passiveRegex.test(clean) || possessiveRegex.test(clean) || creatorOfRegex.test(clean) || embeddedRegex.test(clean) || otherRegex.test(clean) || hinglishRegex.test(clean) || multilingualRegex.test(clean)
}

