import { useState, useEffect, useRef } from 'react'
import { getPageContext } from './use-page-context'
import { dataUrlToBlob } from './blob-utils'

const getLanguageModelAPI = () =>
  (window as any).LanguageModel || 
  (window as any).ai?.languageModel || 
  (window as any).ai?.assistant

import { isMultimodalUnsupportedError as isDOMOrMultimodalError } from './ai'

export const useTextExplainer = () => {
  const [isProcessing, setIsProcessing] = useState(false)
  const [explanation, setExplanation] = useState('')
  const [displayedExplanation, setDisplayedExplanation] = useState('')
  const textSessionRef = useRef<any>(null)
  const imageSessionRef = useRef<any>(null)
  const audioSessionRef = useRef<any>(null)

  // Ensure text explainer session
  const ensureTextSession = async (contextString?: string): Promise<any> => {
    if (textSessionRef.current) {
      return textSessionRef.current
    }

    const LM = getLanguageModelAPI()
    if (!LM) {
      throw new Error('Prompt API not available')
    }

    let availability: string | undefined
    try {
      if (typeof LM.availability === 'function') {
        availability = await LM.availability({
          expectedOutputs: [{ type: 'text', languages: ['en'] }],
          outputLanguage: 'en'
        })
      }
    } catch {
      try {
        availability = await LM.availability?.({ outputLanguage: 'en' })
      } catch {
        availability = 'unavailable'
      }
    }

    if (availability === 'unavailable' || availability === 'no') {
      throw new Error('AI model unavailable')
    }

    const pageContext = contextString !== undefined ? contextString : await getPageContext()
    const systemPrompt = `${pageContext}You are a helpful assistant that provides clear and concise explanations. For text, explain the meaning, context, or significance in 2-3 sentences. For images, describe what you see and provide useful context or analysis in 2-3 sentences. For audio, describe what you hear and provide relevant context or analysis in 2-3 sentences.`

    try {
      textSessionRef.current = await LM.create({
        systemPrompt,
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
        outputLanguage: 'en'
      })
    } catch {
      try {
        textSessionRef.current = await LM.create({
          initialPrompts: [{ role: 'system', content: systemPrompt }],
          expectedOutputs: [{ type: 'text', languages: ['en'] }],
          outputLanguage: 'en'
        })
      } catch {
        try {
          textSessionRef.current = await LM.create({
            systemPrompt,
            outputLanguage: 'en'
          })
        } catch {
          textSessionRef.current = await LM.create({
            systemPrompt,
            outputLanguage: 'en'
          })
        }
      }
    }

    return textSessionRef.current
  }

  // Probe and create dedicated multimodal image session if supported
  const ensureImageSession = async (contextString?: string): Promise<any> => {
    if (imageSessionRef.current) {
      return imageSessionRef.current
    }

    const LM = getLanguageModelAPI()
    if (!LM) return null

    try {
      if (typeof LM.availability === 'function') {
        const avail = await LM.availability({
          expectedInputs: [{ type: 'image' }],
          expectedOutputs: [{ type: 'text', languages: ['en'] }],
          outputLanguage: 'en'
        })
        if (avail === 'unavailable' || avail === 'no') {
          return null
        }
      }
    } catch {
      // If availability probe with expectedInputs fails, continue to creation probe
    }

    const pageContext = contextString !== undefined ? contextString : await getPageContext()
    const systemPrompt = `${pageContext}Describe what you see in the provided screenshot and explain the context and options available to the user in 2-3 clear, helpful sentences.`

    try {
      imageSessionRef.current = await LM.create({
        systemPrompt,
        expectedInputs: [{ type: 'text' }, { type: 'image' }],
        expectedOutputs: [{ type: 'text' }],
        outputLanguage: 'en'
      })
      return imageSessionRef.current
    } catch {
      try {
        imageSessionRef.current = await LM.create({
          systemPrompt,
          expectedInputs: [{ type: 'image' }],
          outputLanguage: 'en'
        })
        return imageSessionRef.current
      } catch {
        try {
          imageSessionRef.current = await LM.create({
            systemPrompt,
            expectedInputs: [{ type: 'image' }],
            outputLanguage: 'en'
          })
          return imageSessionRef.current
        } catch {
          imageSessionRef.current = null
          return null
        }
      }
    }
  }

  // Probe and create dedicated audio session if supported
  const ensureAudioSession = async (contextString?: string): Promise<any> => {
    if (audioSessionRef.current) {
      return audioSessionRef.current
    }

    const LM = getLanguageModelAPI()
    if (!LM) return null

    const pageContext = contextString !== undefined ? contextString : await getPageContext()
    const systemPrompt = `${pageContext}Describe what you hear in the provided audio recording in 2-3 clear, helpful sentences.`

    try {
      audioSessionRef.current = await LM.create({
        systemPrompt,
        expectedInputs: [{ type: 'text' }, { type: 'audio' }],
        expectedOutputs: [{ type: 'text' }],
        outputLanguage: 'en'
      })
      return audioSessionRef.current
    } catch {
      try {
        audioSessionRef.current = await LM.create({
          systemPrompt,
          expectedInputs: [{ type: 'audio' }],
          outputLanguage: 'en'
        })
        return audioSessionRef.current
      } catch {
        audioSessionRef.current = null
        return null
      }
    }
  }

  // Real LLM explanation generation for text selection
  const generateExplanation = async (selectedText: string) => {
    setIsProcessing(true)
    setExplanation('')
    setDisplayedExplanation('')

    try {
      const session = await ensureTextSession()

      const stream = session.promptStreaming(
        `Explain the following text:\n\n"${selectedText}"`,
        { outputLanguage: 'en' }
      )

      let fullExplanation = ''
      for await (const chunk of stream) {
        fullExplanation += chunk
        setExplanation(fullExplanation)
        setDisplayedExplanation(fullExplanation)
      }
    } catch (error: any) {
      console.error('Explanation error:', error)
      const errDetail = error?.message || (error instanceof DOMException ? error.name : String(error))
      const errorMsg = `Error generating explanation: ${errDetail}`
      setExplanation(errorMsg)
      setDisplayedExplanation(errorMsg)
    } finally {
      setIsProcessing(false)
    }
  }

  // Real explanation with image using multimodal Prompt API or graceful contextual fallback
  const generateExplanationWithImage = async (imageDataUrl: string) => {
    setIsProcessing(true)
    setExplanation('')
    setDisplayedExplanation('')

    try {
      const pageContext = await getPageContext()
      const blob = dataUrlToBlob(imageDataUrl)

      let stream: any = null
      let usedFallback = false

      // 1. Attempt multimodal image analysis if the session supports image inputs
      try {
        const imageSession = await ensureImageSession(pageContext)
        if (imageSession) {
          stream = imageSession.promptStreaming(
            [{
              role: 'user',
              content: [
                { type: 'text', value: 'Explain what you see in this screenshot:' },
                { type: 'image', value: blob }
              ]
            }],
            { outputLanguage: 'en' }
          )
        }
      } catch (e) {
        if (isDOMOrMultimodalError(e)) {
          console.warn('[Explainer] Multimodal image processing not supported by current session, using contextual fallback:', e)
          usedFallback = true
        } else {
          throw e
        }
      }

      // 2. If multimodal session was unavailable or stream threw DOMException, fallback to page context explanation
      if (!stream || usedFallback) {
        const textSession = await ensureTextSession(pageContext)
        const fallbackPrompt = `The user captured a screenshot of this page (${pageContext || 'active window'}). State clearly that you cannot view the screenshot. Describe only the provided page title and URL; do not infer visual details:`
        stream = textSession.promptStreaming(fallbackPrompt)
      }

      let fullExplanation = ''
      try {
        for await (const chunk of stream) {
          fullExplanation += chunk
          setExplanation(fullExplanation)
          setDisplayedExplanation(fullExplanation)
        }
      } catch (streamErr: any) {
        // If stream throws during iteration (e.g. image rejected by backend)
        if (isDOMOrMultimodalError(streamErr) && !usedFallback) {
          console.warn('[Explainer] Multimodal stream rejected image during iteration, falling back to text context:', streamErr)
          const textSession = await ensureTextSession(pageContext)
          const fallbackPrompt = `The user captured a screenshot of this page (${pageContext || 'active window'}). State clearly that you cannot view the screenshot. Describe only the provided page title and URL; do not infer visual details:`
          const fallbackStream = textSession.promptStreaming(fallbackPrompt)
          fullExplanation = ''
          for await (const chunk of fallbackStream) {
            fullExplanation += chunk
            setExplanation(fullExplanation)
            setDisplayedExplanation(fullExplanation)
          }
        } else {
          throw streamErr
        }
      }
    } catch (error: any) {
      console.error('Image explanation error:', error)
      const errDetail = error?.message || (error instanceof DOMException ? error.name : String(error))
      const errorMsg = `Error analyzing image: ${errDetail}`
      setExplanation(errorMsg)
      setDisplayedExplanation(errorMsg)
    } finally {
      setIsProcessing(false)
    }
  }

  // Real explanation with audio using multimodal Prompt API or graceful contextual fallback
  const generateExplanationWithAudio = async (audioDataUrl: string) => {
    setIsProcessing(true)
    setExplanation('')
    setDisplayedExplanation('')

    try {
      const pageContext = await getPageContext()
      const blob = dataUrlToBlob(audioDataUrl)

      let stream: any = null
      let usedFallback = false

      // 1. Attempt multimodal audio analysis if supported
      try {
        const audioSession = await ensureAudioSession(pageContext)
        if (audioSession) {
          stream = audioSession.promptStreaming(
            [{
              role: 'user',
              content: [
                { type: 'text', value: 'Explain what you hear in this audio:' },
                { type: 'audio', value: blob }
              ]
            }],
            { outputLanguage: 'en' }
          )
        }
      } catch (e) {
        if (isDOMOrMultimodalError(e)) {
          console.warn('[Explainer] Multimodal audio processing not supported by current session, using contextual fallback:', e)
          usedFallback = true
        } else {
          throw e
        }
      }

      // 2. Fallback to contextual explanation
      if (!stream || usedFallback) {
        const textSession = await ensureTextSession(pageContext)
        const fallbackPrompt = `The user recorded an audio snippet while viewing this page (${pageContext || 'active window'}). State clearly that you cannot hear or transcribe the recording. Describe only the provided page title and URL:`
        stream = textSession.promptStreaming(fallbackPrompt)
      }

      let fullExplanation = ''
      try {
        for await (const chunk of stream) {
          fullExplanation += chunk
          setExplanation(fullExplanation)
          setDisplayedExplanation(fullExplanation)
        }
      } catch (streamErr: any) {
        if (isDOMOrMultimodalError(streamErr) && !usedFallback) {
          console.warn('[Explainer] Multimodal stream rejected audio during iteration, falling back to text context:', streamErr)
          const textSession = await ensureTextSession(pageContext)
          const fallbackPrompt = `The user recorded an audio snippet while viewing this page (${pageContext || 'active window'}). State clearly that you cannot hear or transcribe the recording. Describe only the provided page title and URL:`
          const fallbackStream = textSession.promptStreaming(fallbackPrompt)
          fullExplanation = ''
          for await (const chunk of fallbackStream) {
            fullExplanation += chunk
            setExplanation(fullExplanation)
            setDisplayedExplanation(fullExplanation)
          }
        } else {
          throw streamErr
        }
      }
    } catch (error: any) {
      console.error('Audio explanation error:', error)
      const errDetail = error?.message || (error instanceof DOMException ? error.name : String(error))
      const errorMsg = `Error analyzing audio: ${errDetail}`
      setExplanation(errorMsg)
      setDisplayedExplanation(errorMsg)
    } finally {
      setIsProcessing(false)
    }
  }

  const reset = () => {
    setExplanation('')
    setDisplayedExplanation('')
    setIsProcessing(false)
  }

  // Cleanup sessions on unmount
  useEffect(() => {
    return () => {
      if (textSessionRef.current) {
        textSessionRef.current.destroy?.()
        textSessionRef.current = null
      }
      if (imageSessionRef.current) {
        imageSessionRef.current.destroy?.()
        imageSessionRef.current = null
      }
      if (audioSessionRef.current) {
        audioSessionRef.current.destroy?.()
        audioSessionRef.current = null
      }
    }
  }, [])

  return {
    isProcessing,
    explanation,
    displayedExplanation,
    generateExplanation,
    generateExplanationWithImage,
    generateExplanationWithAudio,
    reset
  }
}
