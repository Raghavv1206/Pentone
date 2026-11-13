import { describe, it, expect, beforeEach, vi } from 'vitest'
import { detectLanguageFromText } from '../lib/local-language'
import { speechLocaleFor, parseConversationLanguage } from '../lib/language-preferences'
import { selectBestVoiceForLanguage } from '../lib/voice-selector'
import { detectIntents, isCreatorQuestion } from '../lib/intent-detector'
import { matchVoiceIntent } from '../lib/voice-intent-matcher'
import { normalizeForSpeech } from '../lib/tts-normalizer'

// Mock Chrome Storage
const mockStorage: Record<string, any> = {}
global.chrome = {
  storage: {
    local: {
      get: vi.fn((key: string | string[]) => {
        if (typeof key === 'string') return Promise.resolve({ [key]: mockStorage[key] })
        const res: Record<string, any> = {}
        for (const k of key) res[k] = mockStorage[k]
        return Promise.resolve(res)
      }),
      set: vi.fn((items: Record<string, any>) => {
        Object.assign(mockStorage, items)
        return Promise.resolve()
      })
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn()
    }
  }
} as any

describe('Multilingual Language Intelligence', () => {
  describe('detectLanguageFromText', () => {
    it('detects European Latin-script languages', () => {
      expect(detectLanguageFromText('hola cómo estás, puedes buscar recetas en youtube')).toBe('es')
      expect(detectLanguageFromText('bonjour pouvez-vous chercher du pain sur google')).toBe('fr')
      expect(detectLanguageFromText('hallo kannst du diese seite zusammenfassen bitte')).toBe('de')
      expect(detectLanguageFromText('ciao puoi riassumere questa pagina per favore')).toBe('it')
      expect(detectLanguageFromText('olá pode fechar todas as abas por favor')).toBe('pt')
    })

    it('detects Non-Latin script languages', () => {
      expect(detectLanguageFromText('привет как дела найди видео')).toBe('ru')
      expect(detectLanguageFromText('このページを要約してください')).toBe('ja')
      expect(detectLanguageFromText('总结这个页面的核心要点')).toBe('zh')
      expect(detectLanguageFromText('لخص هذه الصفحة بالكامل')).toBe('ar')
      expect(detectLanguageFromText('안녕하세요 오늘 날씨 어때요')).toBe('ko')
      expect(detectLanguageFromText('इस पेज का सारांश बताओ')).toBe('hi')
      expect(detectLanguageFromText('এই পৃষ্ঠাটি সারসংক্ষেপ করুন')).toBe('bn')
      expect(detectLanguageFromText('இந்த பக்கத்தை சுருக்கவும்')).toBe('ta')
    })

    it('detects Hinglish and English', () => {
      expect(detectLanguageFromText('sare tabs band karo aur summary batao')).toBe('hinglish')
      expect(detectLanguageFromText('summarize this page and close all tabs')).toBe('en')
    })
  })

  describe('speechLocaleFor & parseConversationLanguage', () => {
    it('maps language codes to appropriate speech locales', () => {
      expect(speechLocaleFor('es')).toBe('es-ES')
      expect(speechLocaleFor('fr')).toBe('fr-FR')
      expect(speechLocaleFor('de')).toBe('de-DE')
      expect(speechLocaleFor('it')).toBe('it-IT')
      expect(speechLocaleFor('pt')).toBe('pt-BR')
      expect(speechLocaleFor('ru')).toBe('ru-RU')
      expect(speechLocaleFor('ja')).toBe('ja-JP')
      expect(speechLocaleFor('zh')).toBe('zh-CN')
      expect(speechLocaleFor('ar')).toBe('ar-SA')
      expect(speechLocaleFor('ko')).toBe('ko-KR')
      expect(speechLocaleFor('hi')).toBe('hi-IN')
      expect(speechLocaleFor('hinglish')).toBe('hi-IN')
      expect(speechLocaleFor('es-MX')).toBe('es-MX')
      expect(speechLocaleFor('fr-CA')).toBe('fr-CA')
    })

    it('parses valid conversation languages', () => {
      expect(parseConversationLanguage('es')).toBe('es')
      expect(parseConversationLanguage('fr')).toBe('fr')
      expect(parseConversationLanguage('de')).toBe('de')
      expect(parseConversationLanguage('ja')).toBe('ja')
      expect(parseConversationLanguage('zh')).toBe('zh')
      expect(parseConversationLanguage('invalid123')).toBe('auto')
      expect(parseConversationLanguage(null)).toBe('auto')
    })
  })

  describe('selectBestVoiceForLanguage', () => {
    const mockVoices = [
      { name: 'Microsoft David Desktop - English (United States)', lang: 'en-US', voiceURI: 'david', localService: true, default: false },
      { name: 'Google español', lang: 'es-ES', voiceURI: 'google-es', localService: true, default: false },
      { name: 'Microsoft Helena - Spanish (Spain)', lang: 'es-ES', voiceURI: 'helena', localService: true, default: false },
      { name: 'Google français', lang: 'fr-FR', voiceURI: 'google-fr', localService: true, default: false },
      { name: 'Google Deutsch', lang: 'de-DE', voiceURI: 'google-de', localService: true, default: false },
      { name: 'Google 日本語', lang: 'ja-JP', voiceURI: 'google-ja', localService: true, default: false },
      { name: 'Google 普通话', lang: 'zh-CN', voiceURI: 'google-zh', localService: true, default: false },
      { name: 'Microsoft Kalpana - Hindi (India)', lang: 'hi-IN', voiceURI: 'kalpana', localService: true, default: false },
      { name: 'Google Indian English', lang: 'en-IN', voiceURI: 'google-en-in', localService: true, default: false }
    ] as unknown as SpeechSynthesisVoice[]

    it('selects priority Spanish voice and never David for Spanish', () => {
      const voice = selectBestVoiceForLanguage(mockVoices, 'es')
      expect(voice?.name).toBe('Google español')
    })

    it('selects priority French voice for French', () => {
      const voice = selectBestVoiceForLanguage(mockVoices, 'fr')
      expect(voice?.name).toBe('Google français')
    })

    it('selects priority German voice for German', () => {
      const voice = selectBestVoiceForLanguage(mockVoices, 'de')
      expect(voice?.name).toBe('Google Deutsch')
    })

    it('selects priority Japanese voice for Japanese', () => {
      const voice = selectBestVoiceForLanguage(mockVoices, 'ja')
      expect(voice?.name).toBe('Google 日本語')
    })

    it('selects priority Chinese voice for Chinese', () => {
      const voice = selectBestVoiceForLanguage(mockVoices, 'zh')
      expect(voice?.name).toBe('Google 普通话')
    })
  })

  describe('Multilingual Intent Recognition', () => {
    it('detects search across Spanish, French, German, Japanese, Chinese, and Arabic', () => {
      // Spanish site search
      const esIntents = detectIntents('buscar recetas de paella en youtube')
      expect(esIntents[0]?.toolCall.function).toBe('openTab')
      expect(esIntents[0]?.toolCall.arguments.url).toContain('youtube.com/results?search_query=recetas%20de%20paella')

      // French site search
      const frIntents = detectIntents('chercher du pain sur google')
      expect(frIntents[0]?.toolCall.function).toBe('openTab')
      expect(frIntents[0]?.toolCall.arguments.url).toContain('google.com/search?q=du%20pain')

      // German search
      const deIntents = detectIntents('suche nach rust tutorials auf youtube')
      expect(deIntents[0]?.toolCall.function).toBe('openTab')
      expect(deIntents[0]?.toolCall.arguments.url).toContain('youtube.com/results?search_query=rust%20tutorials')

      // Japanese search
      const jaIntents = detectIntents('youtubeでPython入門を検索')
      expect(jaIntents[0]?.toolCall.function).toBe('openTab')
      expect(jaIntents[0]?.toolCall.arguments.url).toContain('youtube.com/results?search_query=Python%E5%85%A5%E9%96%80')

      // Chinese search
      const zhIntents = detectIntents('在youtube上搜索机器学习')
      expect(zhIntents[0]?.toolCall.function).toBe('openTab')
      expect(zhIntents[0]?.toolCall.arguments.url).toContain('youtube.com/results?search_query=%E6%9C%BA%E5%99%A8%E5%AD%A6%E4%B9%A0')

      // Arabic search
      const arIntents = detectIntents('ابحث عن الذكاء الاصطناعي في google')
      expect(arIntents[0]?.toolCall.function).toBe('openTab')
      expect(arIntents[0]?.toolCall.arguments.url).toContain('google.com/search?q=')
    })

    it('detects media play across languages', () => {
      // Spanish
      const esPlay = detectIntents('reproducir despacito')
      expect(esPlay[0]?.toolCall.function).toBe('openTab')
      expect(esPlay[0]?.toolCall.arguments.url).toContain('despacito')

      // French
      const frPlay = detectIntents('écouter la vie en rose')
      expect(frPlay[0]?.toolCall.function).toBe('openTab')
      expect(frPlay[0]?.toolCall.arguments.url).toContain('la%20vie%20en%20rose')

      // German
      const dePlay = detectIntents('spiele ode an die freude')
      expect(dePlay[0]?.toolCall.function).toBe('openTab')
      expect(dePlay[0]?.toolCall.arguments.url).toContain('ode%20an%20die%20freude')

      // Italian
      const itPlay = detectIntents('riproduci bella ciao')
      expect(itPlay[0]?.toolCall.function).toBe('openTab')
      expect(itPlay[0]?.toolCall.arguments.url).toContain('bella%20ciao')

      // Hindi
      const hiPlay = detectIntents('bure din by seedhe maut chalao')
      expect(hiPlay[0]?.toolCall.function).toBe('openTab')
      expect(hiPlay[0]?.toolCall.arguments.url).toContain('bure%20din%20by%20seedhe%20maut')
    })

    it('detects page summarization across languages', () => {
      expect(detectIntents('resumir esta página')[0]?.toolCall.function).toBe('summarizePage')
      expect(detectIntents('résumer cette page')[0]?.toolCall.function).toBe('summarizePage')
      expect(detectIntents('fasse diese seite zusammen')[0]?.toolCall.function).toBe('summarizePage')
      expect(detectIntents('riassumi questa pagina')[0]?.toolCall.function).toBe('summarizePage')
      expect(detectIntents('обобщи эту страницу')[0]?.toolCall.function).toBe('summarizePage')
      expect(detectIntents('このページを要約して')[0]?.toolCall.function).toBe('summarizePage')
      expect(detectIntents('总结这个页面')[0]?.toolCall.function).toBe('summarizePage')
      expect(detectIntents('لخص هذه الصفحة')[0]?.toolCall.function).toBe('summarizePage')
      expect(detectIntents('इस पेज का सारांश बताओ')[0]?.toolCall.function).toBe('summarizePage')
    })

    it('detects tab closing across languages', () => {
      // Spanish
      const esCloseAll = detectIntents('cerrar todas las pestañas')
      expect(esCloseAll[0]?.toolCall.function).toBe('closeTab')
      expect(esCloseAll[0]?.toolCall.arguments.all).toBe(true)

      const esCloseThis = detectIntents('cerrar esta pestaña')
      expect(esCloseThis[0]?.toolCall.function).toBe('closeTab')
      expect(esCloseThis[0]?.toolCall.arguments.current).toBe(true)

      // French
      const frCloseAll = detectIntents('fermer tous les onglets')
      expect(frCloseAll[0]?.toolCall.function).toBe('closeTab')
      expect(frCloseAll[0]?.toolCall.arguments.all).toBe(true)

      // German
      const deCloseAll = detectIntents('schließe alle tabs')
      expect(deCloseAll[0]?.toolCall.function).toBe('closeTab')
      expect(deCloseAll[0]?.toolCall.arguments.all).toBe(true)

      // Japanese
      const jaCloseAll = detectIntents('すべてのタブを閉じて')
      expect(jaCloseAll[0]?.toolCall.function).toBe('closeTab')
      expect(jaCloseAll[0]?.toolCall.arguments.all).toBe(true)

      // Chinese
      const zhCloseAll = detectIntents('关闭所有标签页')
      expect(zhCloseAll[0]?.toolCall.function).toBe('closeTab')
      expect(zhCloseAll[0]?.toolCall.arguments.all).toBe(true)
    })

    it('detects media controls and page actions across languages', () => {
      // Skip ad
      expect(detectIntents('saltar anuncio')[0]?.toolCall.function).toBe('clickSkipButton')
      expect(detectIntents('werbung überspringen')[0]?.toolCall.function).toBe('clickSkipButton')
      expect(detectIntents('広告をスキップ')[0]?.toolCall.function).toBe('clickSkipButton')
      expect(detectIntents('跳过广告')[0]?.toolCall.function).toBe('clickSkipButton')

      // Pause & Resume
      expect(detectIntents('pausar video')[0]?.toolCall.function).toBe('controlMedia')
      expect(detectIntents('reanudar video')[0]?.toolCall.function).toBe('controlMedia')
      expect(detectIntents('video fortsetzen')[0]?.toolCall.function).toBe('controlMedia')

      // Mute & Unmute
      expect(detectIntents('silenciar')[0]?.toolCall.function).toBe('controlMedia')
      expect(detectIntents('activar sonido')[0]?.toolCall.function).toBe('controlMedia')

      // Navigation
      expect(detectIntents('volver')[0]?.toolCall.function).toBe('navigatePage')
      expect(detectIntents('avanzar')[0]?.toolCall.function).toBe('navigatePage')
      expect(detectIntents('recargar página')[0]?.toolCall.function).toBe('navigatePage')
      expect(detectIntents('go to main youtube page', { activeTabUrl: 'https://www.youtube.com/watch?v=123' })[0]?.toolCall.function).toBe('navigatePage')
      expect(detectIntents('go to main youtube page', { activeTabUrl: 'https://www.youtube.com/watch?v=123' })[0]?.toolCall.arguments.url).toBe('https://www.youtube.com')
      expect(detectIntents('go to home page')[0]?.toolCall.function).toBe('navigatePage')
      expect(detectIntents('go to home page')[0]?.toolCall.arguments.action).toBe('home')
      expect(detectIntents('navigate to youtube')[0]?.toolCall.function).toBe('navigatePage')
      expect(detectIntents('go to youtube in this tab')[0]?.toolCall.function).toBe('navigatePage')

      // Screenshot
      expect(detectIntents('captura de pantalla')[0]?.toolCall.function).toBe('captureScreenshot')
      expect(detectIntents('screenshot machen')[0]?.toolCall.function).toBe('captureScreenshot')
      expect(detectIntents('スクリーンショットを撮って')[0]?.toolCall.function).toBe('captureScreenshot')
    })

    it('fuzzy matches voice intents in multilingual voice registry', () => {
      expect(matchVoiceIntent('résumer cette page')?.toolCall.function).toBe('summarizePage')
      expect(matchVoiceIntent('resumen de la página')?.toolCall.function).toBe('summarizePage')
      expect(matchVoiceIntent('werbung überspringen')?.toolCall.function).toBe('clickSkipButton')
      expect(matchVoiceIntent('silenciar video')?.toolCall.function).toBe('controlMedia')
      expect(matchVoiceIntent('formular ausfüllen')?.toolCall.function).toBe('autofillForm')
      expect(matchVoiceIntent('go to home page')?.toolCall.function).toBe('navigatePage')
    })
  })

  describe('isCreatorQuestion in multiple languages', () => {
    it('identifies questions asking who created Pentone in all languages', () => {
      expect(isCreatorQuestion('who made you')).toBe(true)
      expect(isCreatorQuestion('quién te creó')).toBe(true)
      expect(isCreatorQuestion('qui t\'a créé')).toBe(true)
      expect(isCreatorQuestion('wer hat dich erschaffen')).toBe(true)
      expect(isCreatorQuestion('chi ti ha creato')).toBe(true)
      expect(isCreatorQuestion('quem te criou')).toBe(true)
      expect(isCreatorQuestion('кто тебя создал')).toBe(true)
      expect(isCreatorQuestion('誰があなたを作ったの')).toBe(true)
      expect(isCreatorQuestion('谁创造了你')).toBe(true)
      expect(isCreatorQuestion('من صنعك')).toBe(true)
      expect(isCreatorQuestion('तुम्हें किसने बनाया')).toBe(true)
      expect(isCreatorQuestion('tumhe kisne banaya')).toBe(true)
    })
  })

  describe('normalizeForSpeech multilingual & currencies', () => {
    it('normalizes full-width CJK punctuation and currencies', () => {
      const normalized = normalizeForSpeech('こんにちは。世界！価格は ¥500 です。')
      expect(normalized).toContain('. ')
      expect(normalized).toContain('! ')
      expect(normalized).toContain('500 yen')
    })

    it('normalizes Arabic punctuation', () => {
      const normalized = normalizeForSpeech('مرحبا؟ كيف حالك، شكرا')
      expect(normalized).toContain('?')
      expect(normalized).toContain(',')
    })

    it('expands global currencies', () => {
      expect(normalizeForSpeech('The cost is €50')).toContain('fifty euros')
      expect(normalizeForSpeech('Price is £25')).toContain('twenty five pounds')
      expect(normalizeForSpeech('Price is ₽1000')).toContain('one thousand rubles')
      expect(normalizeForSpeech('Cost is ₩5000')).toContain('five thousand won')
      expect(normalizeForSpeech('Price is ₹200')).toContain('two hundred rupees')
    })

    it('preserves native digits in Spanish, French, German for accurate native pronunciation', () => {
      expect(normalizeForSpeech('Cerrando 3 pestañas')).toBe('Cerrando 3 pestañas')
      expect(normalizeForSpeech('Fermer 2 onglets')).toBe('Fermer 2 onglets')
      expect(normalizeForSpeech('3 Tabs schließen')).toBe('3 Tabs schließen')
    })
  })

  describe('Multilingual Tab Navigation & Same-Site Awareness', () => {
    it('detects previous tab intent in all major languages', () => {
      const phrases = [
        'go to previous tab',
        'switch to previous tab',
        'previous tab',
        'pichla tab',
        'pichle tab par jao',
        'pestaña anterior',
        'onglet précédent',
        'vorheriger tab',
        'scheda precedente',
        'aba anterior',
        'предыдущая вкладка',
        '前のタブ',
        '上一个标签页',
        'التبويب السابق'
      ]
      for (const phrase of phrases) {
        const intents = detectIntents(phrase)
        expect(intents.length).toBeGreaterThan(0)
        expect(intents[0].toolCall.function).toBe('switchTab')
        expect(intents[0].toolCall.arguments.action).toBe('previous')
        expect(intents[0].confirmationText).toBe('Switching to the previous tab.')
      }
    })

    it('navigates in same tab when user is already on the target site', () => {
      const ytContext = { activeTabUrl: 'https://www.youtube.com/watch?v=sweaterweather', activeTabTitle: 'The Neighbourhood - Sweater Weather' }
      const intents = detectIntents('Border main YouTube page', ytContext)
      expect(intents).toHaveLength(1)
      expect(intents[0].toolCall.function).toBe('navigatePage')
      expect(intents[0].toolCall.arguments.url).toBe('https://www.youtube.com')
      expect(intents[0].confirmationText).toBe('Navigating to the main YouTube page.')
    })
  })
})
