import { useState, useEffect, useRef } from 'react'
import { getPageContext } from './use-page-context'
import { checkPromptAPIAvailability, createResilientSession } from './ai-config'

export const useTextExplainer = () => {
  const [isProcessing, setIsProcessing] = useState(false)
  const [explanation, setExplanation] = useState('')
  const [displayedExplanation, setDisplayedExplanation] = useState('')
  const textSessionRef = useRef<any>(null)
  const imageSessionRef = useRef<any>(null)

  // Helper to ensure text session exists with valid language configuration
  const ensureTextSession = async () => {
    if (!textSessionRef.current) {
      const availability = await checkPromptAPIAvailability({ multimodal: false })
      if (availability === 'unavailable') {
        throw new Error('AI model unavailable')
      }

      // Get page context
      const pageContext = await getPageContext()

      textSessionRef.current = await createResilientSession({
        initialPrompt: `${pageContext}You are a helpful assistant that provides clear and concise explanations. For text, explain the meaning, context, or significance in 2-3 sentences.`,
        multimodal: false
      })
    }
    return textSessionRef.current
  }

  // Helper to ensure multimodal session for image analysis
  const ensureImageSession = async () => {
    if (!imageSessionRef.current) {
      const availability = await checkPromptAPIAvailability({ multimodal: true })
      if (availability !== 'available') {
        return null
      }

      const pageContext = await getPageContext()
      try {
        imageSessionRef.current = await createResilientSession({
          initialPrompt: `${pageContext}You are a helpful assistant that analyzes images and screenshots. Describe what you see and provide useful context or analysis in 2-3 sentences.`,
          multimodal: true
        })
      } catch (err: any) {
        console.warn('[Explainer] Failed to create multimodal image session:', err)
        return null
      }
    }
    return imageSessionRef.current
  }

  // LLM text action generation supporting Explain, Summarize, Rewrite, Translate, Ask
  const generateAction = async (action: 'explain' | 'summarize' | 'rewrite' | 'translate' | 'ask', selectedText: string, customPrompt?: string) => {
    setIsProcessing(true)
    setExplanation('')
    setDisplayedExplanation('')

    try {
      const session = await ensureTextSession()

      let promptInstruction = `Explain the following text clearly and concisely in 2-3 sentences:\n\n"${selectedText}"`
      if (action === 'summarize') {
        promptInstruction = `Provide a clear, high-level summary of the following text with key takeaways:\n\n"${selectedText}"`
      } else if (action === 'rewrite') {
        promptInstruction = `Rewrite the following text to improve clarity, elegance, and readability while preserving meaning:\n\n"${selectedText}"`
      } else if (action === 'translate') {
        promptInstruction = `Translate the following text into natural, fluent English (or Hindi if already in English):\n\n"${selectedText}"`
      } else if (action === 'ask') {
        promptInstruction = `${customPrompt || 'Analyze and answer insights regarding the following text'}:\n\n"${selectedText}"`
      }

      const stream = session.promptStreaming(promptInstruction)

      let fullExplanation = ''
      for await (const chunk of stream) {
        fullExplanation += chunk
        setExplanation(fullExplanation)
        setDisplayedExplanation(fullExplanation)
      }
    } catch (error: any) {
      console.error(`[Explainer] ${action} error:`, error)
      const errorMsg = `Error generating ${action}: ${error.message}`
      setExplanation(errorMsg)
      setDisplayedExplanation(errorMsg)
    } finally {
      setIsProcessing(false)
    }
  }

  // Real LLM explanation generation using Prompt API
  const generateExplanation = async (selectedText: string) => {
    setIsProcessing(true)
    setExplanation('')
    setDisplayedExplanation('')

    try {
      const session = await ensureTextSession()

      const stream = session.promptStreaming(
        `Explain the following text:\n\n"${selectedText}"`
      )

      let fullExplanation = ''
      for await (const chunk of stream) {
        fullExplanation += chunk
        setExplanation(fullExplanation)
        setDisplayedExplanation(fullExplanation)
      }
    } catch (error: any) {
      console.error('[Explainer] Text explanation error:', error)
      const errorMsg = `Error generating explanation: ${error.message}`
      setExplanation(errorMsg)
      setDisplayedExplanation(errorMsg)
    } finally {
      setIsProcessing(false)
    }
  }

  // Real explanation with image using Prompt API (multimodal)
  const generateExplanationWithImage = async (imageDataUrl: string, selectedText?: string) => {
    setIsProcessing(true)
    setExplanation('')
    setDisplayedExplanation('')

    try {
      const availability = await checkPromptAPIAvailability({ multimodal: true })
      if (availability !== 'available') {
        const msg = availability === 'downloadable' || availability === 'downloading'
          ? `On-device image multimodal model is currently ${availability}. Please wait for download or check Settings.`
          : 'On-device image multimodal analysis is not supported by your device or current Chrome configuration. You can explain or summarize the surrounding text instead.'
        setExplanation(msg)
        setDisplayedExplanation(msg)
        return
      }

      const session = await ensureImageSession()
      if (!session) {
        const msg = 'Unable to initialize on-device image multimodal session on this device. You can explain or summarize the surrounding text instead.'
        setExplanation(msg)
        setDisplayedExplanation(msg)
        return
      }

      // Convert data URL to blob for multimodal input
      const response = await fetch(imageDataUrl)
      const blob = await response.blob()

      const promptText = selectedText 
        ? `Explain this image in the context of: "${selectedText}"`
        : 'Describe and explain what you see in this screenshot:'

      const stream = session.promptStreaming([{
        role: 'user',
        content: [
          { type: 'text', value: promptText },
          { type: 'image', value: blob }
        ]
      }])

      let fullExplanation = ''
      for await (const chunk of stream) {
        fullExplanation += chunk
        setExplanation(fullExplanation)
        setDisplayedExplanation(fullExplanation)
      }
    } catch (error: any) {
      console.error('[Explainer] Image explanation error:', error)
      const errorMsg = `Error analyzing image: ${error.message}`
      setExplanation(errorMsg)
      setDisplayedExplanation(errorMsg)
    } finally {
      setIsProcessing(false)
    }
  }

  // Audio explanation handler
  const generateExplanationWithAudio = async (_audioDataUrl: string) => {
    setIsProcessing(true)
    setExplanation('')
    setDisplayedExplanation('')

    try {
      // Local Chrome Prompt API currently supports text and image modalities on-device.
      const notice = 'On-device audio modal inference is not supported by the local Gemini Nano model. Use text or image capture for explanation.'
      setExplanation(notice)
      setDisplayedExplanation(notice)
    } catch (error: any) {
      console.error('[Explainer] Audio explanation error:', error)
      const errorMsg = `Error analyzing audio: ${error.message}`
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
        try {
          textSessionRef.current.destroy?.()
        } catch (e) {
          console.warn('[Explainer] Error destroying text session on unmount:', e)
        }
        textSessionRef.current = null
      }
      if (imageSessionRef.current) {
        try {
          imageSessionRef.current.destroy?.()
        } catch (e) {
          console.warn('[Explainer] Error destroying image session on unmount:', e)
        }
        imageSessionRef.current = null
      }
    }
  }, [])

  return {
    isProcessing,
    explanation,
    displayedExplanation,
    generateExplanation,
    generateAction,
    generateExplanationWithImage,
    generateExplanationWithAudio,
    reset
  }
}
