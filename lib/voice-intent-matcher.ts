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
  multilingualAliases?: string[]
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
    multilingualAliases: [
      'resumir esta página',
      'resumen de la página',
      'resumir página',
      'resumir',
      'resumen',
      'résumer cette page',
      'résumé de la page',
      'résumer',
      'résumé',
      'fasse diese seite zusammen',
      'seite zusammenfassen',
      'zusammenfassung der seite',
      'riassumi questa pagina',
      'riassunto della pagina',
      'resumir esta página',
      'resumo da página',
      'обобщи эту страницу',
      'краткое содержание страницы',
      'резюмируй страницу',
      'このページを要約して',
      'ページを要約して',
      '要約して',
      '总结这个页面',
      '总结本页',
      '页面摘要',
      'لخص هذه الصفحة',
      'تلخيص الصفحة',
      'इस पेज का सारांश बताओ',
      'सारांश बताओ'
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
    multilingualAliases: [
      'cerrar todas las pestañas',
      'cierra todas las pestañas',
      'fermer tous les onglets',
      'schließe alle tabs',
      'alle tabs schließen',
      'chiudi tutte le schede',
      'fechar todas as abas',
      'fecha todas as abas',
      'закрой все вкладки',
      'закрыть все вкладки',
      'すべてのタブを閉じて',
      '全タブを閉じる',
      '关闭所有标签页',
      'أغلق كل التبويبات',
      'اغلق جميع علامات التبويب',
      'सारे टैब बंद करो',
      'सभी टैब बंद करो'
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
    multilingualAliases: [
      'cerrar las demás pestañas',
      'cerrar otras pestañas',
      'fermer les autres onglets',
      'schließe andere tabs',
      'andere tabs schließen',
      'chiudi le altre schede',
      'fechar as outras abas',
      'закрой остальные вкладки',
      '他のタブを閉じて',
      '关闭其他标签页',
      'أغلق التبويبات الأخرى',
      'बाकी टैब बंद करो'
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
    multilingualAliases: [
      'cerrar esta pestaña',
      'cierra esta pestaña',
      'cerrar pestaña',
      'fermer cet onglet',
      'fermer l\'onglet',
      'schließe diesen tab',
      'diesen tab schließen',
      'tab schließen',
      'chiudi questa scheda',
      'chiudi scheda',
      'fechar esta aba',
      'fechar aba',
      'закрой эту вкладку',
      'закрыть вкладку',
      'このタブを閉じて',
      'タブを閉じる',
      '关闭此标签页',
      '关闭当前标签页',
      '关闭标签页',
      'أغلق هذا التبويب',
      'यह टैब बंद करो',
      'टैब बंद करो'
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
    multilingualAliases: [
      'captura de pantalla',
      'tomar captura',
      'hacer captura de pantalla',
      'capture d\'écran',
      'faire une capture d\'écran',
      'screenshot machen',
      'bildschirmfoto machen',
      'cattura schermo',
      'fai uno screenshot',
      'tirar print',
      'capturar tela',
      'сделай скриншот',
      'снимок экрана',
      'スクリーンショットを撮って',
      '画面キャプチャ',
      '截屏',
      '截图',
      'لقطة شاشة',
      'خذ لقطة شاشة',
      'स्क्रीनशॉट लो',
      'स्क्रीन कैप्चर करो'
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
    multilingualAliases: [
      'abrir extensiones',
      'mostrar extensiones',
      'ouvrir les extensions',
      'erweiterungen öffnen',
      'apri estensioni',
      'abrir extensões',
      'открой расширения',
      '拡張機能を開いて',
      '打开扩展程序',
      'افتح الإضافات',
      'एक्सटेंशन खोलो'
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
    multilingualAliases: [
      'abrir configuración',
      'mostrar ajustes',
      'ouvrir les paramètres',
      'einstellungen öffnen',
      'apri impostazioni',
      'abrir configurações',
      'открой настройки',
      '設定を開いて',
      '打开设置',
      'افتح الإعدادات',
      'सेटिंग्स खोलो'
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
    multilingualAliases: [
      'abrir flags',
      'chrome flags',
      'ouvrir flags',
      'flags öffnen',
      'apri flags',
      'открой flags',
      'フラグを開いて',
      '打开flags',
      'افتح flags',
      'फ्लैग्स खोलो'
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
      'go to main youtube page',
      'go to the main youtube page',
      'go to youtube main page',
      'go to youtube home page',
      'go to youtube homepage',
      'main youtube page',
      'youtube main page',
      'youtube home page',
      'youtube homepage',
      'youtube home',
      'launch youtube',
      'open you tube'
    ],
    hinglishAliases: [
      'youtube kholo',
      'youtube chalao',
      'youtube open karo'
    ],
    multilingualAliases: [
      'abrir youtube',
      'ir a youtube',
      'ouvrir youtube',
      'youtube öffnen',
      'apri youtube',
      'открой ютуб',
      'youtubeを開いて',
      '打开youtube',
      'افتح يوتيوب',
      'यूट्यूब खोलो'
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
    multilingualAliases: [
      'abrir google',
      'ir a google',
      'ouvrir google',
      'google öffnen',
      'apri google',
      'открой гугл',
      'googleを開いて',
      '打开google',
      'افتح جوجل',
      'गूगल खोलो'
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
    multilingualAliases: [
      'abrir github',
      'ir a github',
      'ouvrir github',
      'github öffnen',
      'apri github',
      'открой гитхаб',
      'githubを開いて',
      '打开github',
      'افتح جيت هاب',
      'गिटहब खोलो'
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

  // 12B. Media Playback: Play Song / Music / Video Click
  {
    id: 'play_first_song',
    canonicalIntent: 'play the song',
    toolCall: {
      function: 'clickElement',
      arguments: { query: 'first song', ordinal: 0 }
    },
    confirmationText: 'Playing the song.',
    aliases: [
      'play the song',
      'play the songs',
      'play song',
      'play songs',
      'play the music',
      'play music',
      'play the track',
      'play tracks',
      'play first song',
      'play the first song',
      'play this song',
      'play that song',
      'play the video',
      'play video',
      'play videos',
      'open the first song',
      'open first song'
    ],
    hinglishAliases: [
      'gaana chalao',
      'gana chalao',
      'gaana bajao',
      'gana bajao',
      'gana chala do',
      'gaana chala do',
      'pehla gaana chalao',
      'pehli song chalao',
      'song play karo',
      'gaane chalao'
    ],
    multilingualAliases: [
      'गाना चलाओ',
      'गाने चलाओ',
      'गीत चलाओ',
      'पहला गाना चलाओ',
      'reproducir la canción',
      'reproducir canciones',
      'pon la canción',
      'pon música',
      'jouer la chanson',
      'jouer la musique',
      'lance la chanson',
      'spiele das lied',
      'spiele die musik',
      'riproduci la canzone',
      'riproduci la musica',
      'tocar a música',
      'tocar a canção',
      'включи песню',
      'включи музыку',
      '曲を再生',
      '音楽を再生',
      '播放歌曲',
      '播放音乐',
      '播放这首歌',
      'شغل الأغنية',
      'شغل الموسيقى'
    ],
    phoneticKeys: ['PL', 'SNG']
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
    multilingualAliases: [
      'volver',
      'ir atrás',
      'página anterior',
      'retour',
      'page précédente',
      'zurück',
      'vorherige seite',
      'indietro',
      'pagina precedente',
      'voltar',
      'назад',
      'предыдущая страница',
      '戻る',
      '前のページ',
      '返回',
      '上一页',
      'رجوع',
      'الصفحة السابقة',
      'पीछे जाओ'
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
    multilingualAliases: [
      'avanzar',
      'ir adelante',
      'página siguiente',
      'avancer',
      'page suivante',
      'vorwärts',
      'nächste seite',
      'avanti',
      'pagina successiva',
      'avançar',
      'próxima página',
      'вперед',
      'следующая страница',
      '進む',
      '次のページ',
      '前进',
      '下一页',
      'تقدم',
      'الصفحة التالية',
      'आगे जाओ'
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
    multilingualAliases: [
      'recargar página',
      'actualizar página',
      'recargar',
      'recharger la page',
      'actualiser la page',
      'recharger',
      'seite neu laden',
      'aktualisieren',
      'neu laden',
      'ricarica pagina',
      'aggiorna pagina',
      'recarregar página',
      'перезагрузи страницу',
      'обнови страницу',
      'ページを再読み込み',
      'リロード',
      '刷新页面',
      '重新加载',
      'إعادة تحميل الصفحة',
      'تحديث الصفحة',
      'पेज रीलोड करो'
    ],
    phoneticKeys: ['RLT', 'RFRX']
  },

  // 15B. Browser Navigation: Home / Main Page
  {
    id: 'navigate_home',
    canonicalIntent: 'go to home page',
    toolCall: {
      function: 'navigatePage',
      arguments: { action: 'home' }
    },
    confirmationText: 'Going to the home page.',
    aliases: [
      'go to home page',
      'go to the home page',
      'go to main page',
      'go to the main page',
      'go to homepage',
      'go home',
      'home page',
      'main page',
      'homepage',
      'start page'
    ],
    hinglishAliases: [
      'home page pe jao',
      'main page pe jao',
      'homepage kholo',
      'home jao'
    ],
    multilingualAliases: [
      'página principal',
      'página de inicio',
      'ir a la página principal',
      'page d\'accueil',
      'aller à la page d\'accueil',
      'zur startseite',
      'startseite',
      'pagina iniziale',
      'vai alla home page',
      'página inicial',
      'ir para a página inicial',
      'на главную',
      'главная страница',
      'ホームページに行く',
      'ホームへ',
      'トップページ',
      '去主页',
      '首页',
      '回首页',
      'الصفحة الرئيسية',
      'الذهاب إلى الرئيسية',
      'होम पेज'
    ],
    phoneticKeys: ['HM', 'MN']
  },

  // 16. Skip Video Ad
  {
    id: 'skip_ad',
    canonicalIntent: 'skip ad',
    toolCall: {
      function: 'clickSkipButton',
      arguments: {}
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
    multilingualAliases: [
      'saltar anuncio',
      'omite el anuncio',
      'salta el anuncio',
      'ignorer l\'annonce',
      'passer l\'annonce',
      'werbung überspringen',
      'salta annuncio',
      'pular anúncio',
      'пропустить рекламу',
      '広告をスキップ',
      '跳过广告',
      'تخطي الإعلان',
      'विज्ञापन छोड़ें',
      'विज्ञापन हटाओ'
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
    multilingualAliases: [
      'pausar video',
      'pausar',
      'mettre en pause',
      'pause vidéo',
      'video anhalten',
      'metti in pausa',
      'pausa video',
      'pausar vídeo',
      'поставь на паузу',
      '動画を一時停止',
      '一時停止',
      '暂停视频',
      '暂停',
      'أوقف مؤقتا',
      'إيقاف مؤقت',
      'वीडियो रोको'
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
    multilingualAliases: [
      'reanudar video',
      'reproducir video',
      'reprendre la vidéo',
      'video fortsetzen',
      'riprendi video',
      'retomar vídeo',
      'продолжить видео',
      '動画を再開',
      '继续播放',
      'استئناف الفيديو',
      'वीडियो चलाओ'
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
    multilingualAliases: [
      'silenciar',
      'silenciar video',
      'couper le son',
      'stummschalten',
      'ton aus',
      'disattiva audio',
      'mutar',
      'выключи звук',
      'ミュート',
      '静音',
      'كتم الصوت',
      'आवाज़ बंद करो'
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
    multilingualAliases: [
      'activar sonido',
      'reactivar audio',
      'activer le son',
      'ton an',
      'attiva audio',
      'desmutar',
      'включи звук',
      'ミュート解除',
      '取消静音',
      'إلغاء كتم الصوت',
      'आवाज़ चालू करो'
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
    multilingualAliases: [
      'ir arriba',
      'desplazar hacia arriba',
      'aller en haut',
      'nach oben scrollen',
      'vai in alto',
      'rolar para cima',
      'прокрути наверх',
      '一番上にスクロール',
      '滚动到顶部',
      'انتقل إلى الأعلى',
      'पेज के ऊपर जाओ'
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
    multilingualAliases: [
      'ir abajo',
      'desplazar hacia abajo',
      'aller en bas',
      'nach unten scrollen',
      'vai in basso',
      'rolar para baixo',
      'прокрути вниз',
      '一番下にスクロール',
      '滚动到底部',
      'انتقل إلى الأسفل',
      'पेज के नीचे जाओ'
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
    multilingualAliases: [
      'rellenar formulario',
      'autocompletar formulario',
      'remplir le formulaire',
      'formular ausfüllen',
      'compila modulo',
      'preencher formulário',
      'заполни форму',
      'フォームを自動入力',
      '填写表单',
      '自动填表',
      'املأ النموذج',
      'फॉर्म भरो'
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
  if (entry.multilingualAliases) {
    for (const m of entry.multilingualAliases) {
      SEARCH_DOCS.push({ phrase: m.toLowerCase(), entry })
    }
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
