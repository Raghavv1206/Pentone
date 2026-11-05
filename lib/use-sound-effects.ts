import { useCallback, useEffect, useRef } from 'react'
import { Howl, Howler } from 'howler'

export type SoundEffect = 
  | 'warmup'
  | 'thinking'
  | 'tool'
  | 'success'
  | 'error'
  | 'listening'
  | 'speaking'
  | 'screenshot'
  | 'audioCapture'
  | 'summarizing'

interface SoundConfig {
  src: string
  volume: number
  loop?: boolean
}

function getAssetUrl(filename: string): string {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    try {
      return chrome.runtime.getURL(`assets/${filename}`)
    } catch {
      return `assets/${filename}`
    }
  }
  return `assets/${filename}`
}

export const SOUND_MAP: Record<SoundEffect, SoundConfig> = {
  warmup: { src: getAssetUrl('long-expected-548.ogg'), volume: 0.35 },
  thinking: { src: getAssetUrl('confident-543.ogg'), volume: 0.25 },
  tool: { src: getAssetUrl('slick-notification.ogg'), volume: 0.45 },
  success: { src: getAssetUrl('cheerful-527.ogg'), volume: 0.35 },
  error: { src: getAssetUrl('closure-542.ogg'), volume: 0.4 },
  listening: { src: getAssetUrl('when-604.ogg'), volume: 0.3 },
  speaking: { src: getAssetUrl('closure-542.ogg'), volume: 0.15 },
  screenshot: { src: getAssetUrl('camera-shutter-close.wav'), volume: 0.5 },
  audioCapture: { src: getAssetUrl('cd-sound.wav'), volume: 0.45 },
  summarizing: { src: getAssetUrl('cd-sound.wav'), volume: 0.25 }
}

// Global preloaded audio caches (singleton across all components and calls)
const howlCache = new Map<SoundEffect, Howl>()
const htmlAudioCache = new Map<SoundEffect, HTMLAudioElement>()
let isPreloaded = false

/**
 * Resume AudioContext if suspended by browser autoplay policy
 */
export function resumeAudioContext(): void {
  try {
    if (typeof Howler !== 'undefined' && Howler.ctx && Howler.ctx.state === 'suspended') {
      Howler.ctx.resume().catch(() => {})
    }
  } catch {}
}

/**
 * Preload all sound assets immediately on extension mount
 */
export function preloadAllSounds(): void {
  if (isPreloaded || typeof window === 'undefined') return
  isPreloaded = true

  resumeAudioContext()

  for (const [key, config] of Object.entries(SOUND_MAP) as [SoundEffect, SoundConfig][]) {
    try {
      // 1. Preload HTML5 Audio element for instant zero-latency playback
      const audio = new Audio(config.src)
      audio.preload = 'auto'
      audio.volume = config.volume
      htmlAudioCache.set(key, audio)

      // 2. Preload Howl instance
      const howl = new Howl({
        src: [config.src],
        volume: config.volume,
        preload: true,
        html5: false,
        onloaderror: (id, err) => {
          console.warn(`[SoundEffects] Howl preload warning for "${key}":`, err)
        }
      })
      howlCache.set(key, howl)
    } catch (e) {
      console.warn(`[SoundEffects] Failed to preload sound "${key}":`, e)
    }
  }
}

/**
 * Universal standalone sound player with zero-latency dual engine fallback
 */
export function playSound(effect: SoundEffect): void {
  resumeAudioContext()

  const config = SOUND_MAP[effect]
  if (!config) return

  // Try Howler first if loaded and AudioContext is active
  const howl = howlCache.get(effect)
  let playedViaHowl = false

  if (howl && howl.state() === 'loaded') {
    try {
      if (typeof Howler === 'undefined' || !Howler.ctx || Howler.ctx.state !== 'suspended') {
        howl.volume(config.volume)
        howl.play()
        playedViaHowl = true
      }
    } catch {}
  }

  // Fallback immediately to preloaded HTML5 Audio for reliable, on-time playback
  if (!playedViaHowl) {
    try {
      const cached = htmlAudioCache.get(effect)
      if (cached) {
        cached.currentTime = 0
        cached.volume = config.volume
        cached.play().catch(() => {
          // If instance is busy, clone it for concurrent playback
          const clone = cached.cloneNode(true) as HTMLAudioElement
          clone.volume = config.volume
          clone.play().catch(() => {})
        })
      } else {
        const fresh = new Audio(config.src)
        fresh.volume = config.volume
        fresh.play().catch(() => {})
      }
    } catch (e) {
      console.warn(`[SoundEffects] Native audio play failed for "${effect}":`, e)
    }
  }
}

// Automatically initiate preloading when module is evaluated
if (typeof window !== 'undefined') {
  preloadAllSounds()
  window.addEventListener('click', resumeAudioContext, { once: true, passive: true })
  window.addEventListener('keydown', resumeAudioContext, { once: true, passive: true })
}

export const useSoundEffects = () => {
  const audioEnabledRef = useRef(true)

  useEffect(() => {
    preloadAllSounds()

    // Listen to user audio preference
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get(['tts_audio_enabled'], (res) => {
        if (res?.tts_audio_enabled !== undefined) {
          audioEnabledRef.current = res.tts_audio_enabled
        }
      })

      const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
        if (areaName === 'local' && changes.tts_audio_enabled) {
          audioEnabledRef.current = changes.tts_audio_enabled.newValue
        }
      }

      chrome.storage.onChanged.addListener(handleStorageChange)
      return () => {
        chrome.storage.onChanged.removeListener(handleStorageChange)
      }
    }
  }, [])

  const play = useCallback((effect: SoundEffect) => {
    if (!audioEnabledRef.current) return
    playSound(effect)
  }, [])

  const stop = useCallback((effect: SoundEffect) => {
    const howl = howlCache.get(effect)
    if (howl) howl.stop()
    const cached = htmlAudioCache.get(effect)
    if (cached) {
      cached.pause()
      cached.currentTime = 0
    }
  }, [])

  const stopAll = useCallback(() => {
    howlCache.forEach(h => h.stop())
    htmlAudioCache.forEach(a => {
      a.pause()
      a.currentTime = 0
    })
  }, [])

  const playSpeechEnd = useCallback(() => {
    play('warmup')
  }, [play])

  const playSpeechInterrupted = useCallback(() => {
    play('error')
  }, [play])

  return {
    play,
    stop,
    stopAll,
    playSpeechEnd,
    playSpeechInterrupted
  }
}
