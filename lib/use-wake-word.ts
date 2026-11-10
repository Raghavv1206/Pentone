import { useState, useEffect, useRef, useCallback } from 'react'
import { PorcupineWorker } from '@picovoice/porcupine-web'
import type { PorcupineWorker as PorcupineWorkerType } from '@picovoice/porcupine-web'
import { WebVoiceProcessor } from '@picovoice/web-voice-processor'
import { loadSettings } from './settings'

interface UseWakeWordReturn {
  isListening: boolean
  lastDetection: string | null
  error: string | null
  start: (customKey?: string) => Promise<void>
  stop: () => Promise<void>
}

function parsePicovoiceError(err: any): string {
  const msg = err?.message || String(err || '')
  if (msg.includes('00000136') || /activation.*refused/i.test(msg)) {
    return 'Picovoice AccessKey invalid or expired (code 00000136). Enter your free key from console.picovoice.ai.'
  }
  if (msg.includes('00000137') || /quota|limit/i.test(msg)) {
    return 'Picovoice usage quota exceeded. Check your plan at console.picovoice.ai.'
  }
  if (/network|fetch|connection/i.test(msg)) {
    return 'Network error verifying Picovoice AccessKey. Check your internet connection.'
  }
  return msg || 'Failed to start wake word detection.'
}

export const useWakeWord = (onWakeWordDetected?: () => void): UseWakeWordReturn => {
  const [isListening, setIsListening] = useState(false)
  const [lastDetection, setLastDetection] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  
  const porcupineRef = useRef<PorcupineWorkerType | null>(null)
  const isInitializingRef = useRef(false)
  const generationRef = useRef(0)

  const start = useCallback(async (customKey?: string) => {
    // Prevent duplicate initializations
    if (isInitializingRef.current || porcupineRef.current) {
      console.log('[WakeWord] Already initializing or running')
      return
    }

    const generation = ++generationRef.current
    try {
      isInitializingRef.current = true
      setError(null)

      let activeKey = (customKey || '').trim()
      if (!activeKey) {
        const settings = await loadSettings()
        activeKey = (settings.picovoiceAccessKey || '').trim()
      }

      if (generation !== generationRef.current) return
      if (!activeKey) {
        setError('Picovoice AccessKey required. Get a free key at console.picovoice.ai.')
        isInitializingRef.current = false
        return
      }

      console.log('[WakeWord] Starting wake word detection...')

      // Get URLs for wake word files from extension
      const keywordUrl = chrome.runtime.getURL('assets/Hey-Pentone_en_wasm_v3_0_0.ppn')
      const modelUrl = chrome.runtime.getURL('assets/porcupine_params.pv')

      console.log('[WakeWord] Loading keyword from:', keywordUrl)
      console.log('[WakeWord] Loading model from:', modelUrl)

      // Fetch the files
      const [keywordResponse, modelResponse] = await Promise.all([
        fetch(keywordUrl),
        fetch(modelUrl)
      ])

      const keywordArrayBuffer = await keywordResponse.arrayBuffer()
      const modelArrayBuffer = await modelResponse.arrayBuffer()

      console.log('[WakeWord] Files loaded successfully')
      console.log('[WakeWord] Keyword size:', keywordArrayBuffer.byteLength, 'bytes')
      console.log('[WakeWord] Model size:', modelArrayBuffer.byteLength, 'bytes')

      // Create Porcupine worker
      const keywordBase64 = arrayBufferToBase64(keywordArrayBuffer)
      const modelBase64 = arrayBufferToBase64(modelArrayBuffer)

      if (generation !== generationRef.current) return
      const worker = await PorcupineWorker.create(
        activeKey,
        {
          label: 'Hey Pentone',
          base64: keywordBase64,
          sensitivity: 0.7
        },
        (detection) => {
          if (generation !== generationRef.current) return
          console.log('[WakeWord] Wake word detected!', detection)
          setLastDetection(detection.label)
          onWakeWordDetected?.()
        },
        { base64: modelBase64 }
      )

      if (generation !== generationRef.current) { worker.terminate(); return }
      porcupineRef.current = worker
      console.log('[WakeWord] Porcupine worker created successfully')

      // Start WebVoiceProcessor
      await WebVoiceProcessor.subscribe(worker)
      if (generation !== generationRef.current) {
        await WebVoiceProcessor.unsubscribe(worker).catch(() => {})
        worker.terminate()
        return
      }
      
      setIsListening(true)
      isInitializingRef.current = false
      console.log('[WakeWord] Wake word detection active')
    } catch (err: any) {
      if (generation !== generationRef.current) return
      const friendlyMsg = parsePicovoiceError(err)
      console.warn('[WakeWord] Activation notice:', friendlyMsg)
      setError(friendlyMsg)
      if (porcupineRef.current) {
        try {
          porcupineRef.current.terminate()
        } catch {}
        porcupineRef.current = null
      }
      setIsListening(false)
      isInitializingRef.current = false
    }
  }, [onWakeWordDetected])

  const stop = useCallback(async () => {
    generationRef.current++
    try {
      console.log('[WakeWord] Stopping wake word detection...')
      
      if (porcupineRef.current) {
        await WebVoiceProcessor.unsubscribe(porcupineRef.current)
        porcupineRef.current.terminate()
        porcupineRef.current = null
      }
      
      isInitializingRef.current = false
      setIsListening(false)
      console.log('[WakeWord] Wake word detection stopped')
    } catch (err: any) {
      console.error('[WakeWord] Error stopping wake word detection:', err)
      setError(err.message || 'Failed to stop wake word detection')
      isInitializingRef.current = false
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      generationRef.current++
      if (porcupineRef.current) {
        WebVoiceProcessor.unsubscribe(porcupineRef.current).catch(console.error)
        porcupineRef.current.terminate()
      }
    }
  }, [])

  return {
    isListening,
    lastDetection,
    error,
    start,
    stop
  }
}

// Helper function to convert ArrayBuffer to Base64
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}
