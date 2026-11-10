export type SetupStatus = 'checking' | 'ready' | 'downloadable' | 'downloading' | 'unsupported' | 'action' | 'error'
export interface SetupItem {
  id: string
  title: string
  description: string
  group: 'Models & language packs' | 'Voice & permissions' | 'Optional features'
  essential: boolean
  status: SetupStatus
  detail?: string
  progress?: number
  installLocale?: string
}

export const browserPermissions = {
  tabGroups: 'Tab groups', bookmarks: 'Bookmarks', downloads: 'Download management',
  history: 'Browsing history', sessions: 'Recently closed tabs'
} as const

export const translationLanguages = {
  ar: 'Arabic', bn: 'Bengali', bg: 'Bulgarian', zh: 'Chinese', hr: 'Croatian', cs: 'Czech',
  da: 'Danish', nl: 'Dutch', et: 'Estonian', fi: 'Finnish', fr: 'French', de: 'German',
  el: 'Greek', gu: 'Gujarati', he: 'Hebrew', hi: 'Hindi', hu: 'Hungarian', id: 'Indonesian',
  it: 'Italian', ja: 'Japanese', kn: 'Kannada', ko: 'Korean', lv: 'Latvian', lt: 'Lithuanian',
  ms: 'Malay', ml: 'Malayalam', mr: 'Marathi', no: 'Norwegian', fa: 'Persian', pl: 'Polish',
  pt: 'Portuguese', ro: 'Romanian', ru: 'Russian', sk: 'Slovak', sl: 'Slovenian', es: 'Spanish',
  sv: 'Swedish', ta: 'Tamil', te: 'Telugu', th: 'Thai', tr: 'Turkish', uk: 'Ukrainian',
  ur: 'Urdu', vi: 'Vietnamese'
} as const

export function browserTranslationLanguages(languages: readonly string[]): string[] {
  return [...new Set(['hi', ...languages.map(language => language.toLowerCase().split('-')[0])])]
    .filter(language => language !== 'en' && Object.hasOwn(translationLanguages, language)).slice(0, 5)
}

export function setupCatalog(targets: string[]): SetupItem[] {
  targets = [...new Set(['hi', ...targets])]
  const model = (id: string, title: string, description: string, essential = true): SetupItem =>
    ({ id, title, description, essential, group: 'Models & language packs', status: 'checking' })
  return [
    model('prompt', 'Gemini Nano · Assistant', 'Local reasoning, chat and browser tool use. Download size is managed by Chrome and may be several GB.'),
    model('embedding', 'Semantic memory · MiniLM', 'Local search, saved pages and file embeddings. Approximately 23 MB plus tokenizer files.'),
    model('summarizer', 'Page summaries', 'Chrome Summarizer API for local webpage summaries.'),
    model('writer', 'Writing', 'Chrome Writer API for drafting text locally.'),
    model('rewriter', 'Rewriting', 'Chrome Rewriter API for editing and improving text locally.'),
    model('detector', 'Language detection', 'Chrome Language Detector API for identifying text languages.'),
    ...targets.flatMap(language => [
      model(`translate-en-${language}`, `English → ${translationLanguages[language] || language}`, 'Local translation pack for this direction.'),
      model(`translate-${language}-en`, `${translationLanguages[language] || language} → English`, 'Local translation pack for this direction.')
    ]),
    { ...model('speech', 'Microphone language pack', 'On-device speech recognition for voice commands.'), group: 'Voice & permissions' },
    { ...model('speech-hi', 'Hindi microphone pack', 'Local Hindi speech recognition, also used for mixed Hindi/English speech in Hinglish mode.'), group: 'Voice & permissions' },
    { ...model('microphone', 'Microphone permission', 'Allow Pentone to hear your voice commands. Setup never starts listening.'), group: 'Voice & permissions' },
    { ...model('voice', 'Spoken replies · Local system voice', 'Uses an installed voice on your computer. Online voices are excluded.'), group: 'Voice & permissions' },
    { ...model('voice-hi', 'Hindi spoken replies · Local system voice', 'Install a local Hindi system voice for Hindi replies. Voice quality depends on the installed voice.', false), group: 'Voice & permissions' },
    { ...model('image', 'Image understanding', 'Local image input through Chrome’s Prompt API, when supported.', false), group: 'Optional features' },
    { ...model('audio', 'Audio-file understanding', 'Local audio-file input through Chrome’s Prompt API. Separate from microphone speech.', false), group: 'Optional features' },
    { ...model('wakeword', '“Hey Pentone” wake word', 'Porcupine model files are included. An optional Picovoice AccessKey is needed for activation.', false), group: 'Optional features' },
    ...Object.entries(browserPermissions).map(([permission, title]) => ({
      ...model(`permission-${permission}`, title, 'Optional Chrome permission. Enable only if you want these tools.', false),
      group: 'Optional features' as const
    }))
  ]
}

export const bundledLibraries = [
  ['Local model runtime', 'Transformers.js, ONNX Runtime and WASM files'],
  ['Wake-word runtime', 'Porcupine, Web Voice Processor, Hey Pentone keyword and language model'],
  ['PDF and page reading', 'PDF.js and its worker, Readability, Turndown'],
  ['Browser tools and validation', 'Zod, dom-accessibility-api, Papa Parse, Plasmo messaging'],
  ['Text matching', 'Compromise, Compromise Numbers, Fuse.js, Double Metaphone'],
  ['Interface and audio', 'React, Radix UI, Zustand, Framer Motion, GSAP, Anime.js, Howler, Lucide and React Icons'],
  ['Formatting and languages', 'React Markdown, Remark GFM, i18next, language detection, React i18next, clsx, class-variance-authority, Tailwind Merge']
] as const
