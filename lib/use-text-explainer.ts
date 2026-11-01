import { useState, useEffect, useRef } from 'react'
import { getPageContext } from './use-page-context'
import { checkPromptAPIAvailability, createResilientSession } from './ai-config'

export const useTextExplainer = () => {
  const [isProcessing, setIsProcessing] = useState(false)
  const [explanation, setExplanation] = useState('')
  const [displayedExplanation, setDisplayedExplanation] = useState('')
  const explainerSessionRef = useRef<any>(null)

  // Helper to ensure session exists with valid language configuration
  const ensureExplainerSession = async () => {
    if (!explainerSessionRef.current) {
      const availability = await checkPromptAPIAvailability({ multimodal: true })
      if (availability === 'unavailable') {
        throw new Error('AI model unavailable')
      }

      // Get page context
      const pageContext = await getPageContext()

      explainerSessionRef.current = await createResilientSession({
        initialPrompt: `${pageContext}You are a helpful assistant that provides clear and concise explanations. For text, explain the meaning, context, or significance in 2-3 sentences. For images, describe what you see and provide useful context or analysis in 2-3 sentences.`,
        multimodal: true
      })
    }
  }

  // LLM text action generation supporting Explain, Summarize, Rewrite, Translate, Ask
  const generateAction = async (action: 'explain' | 'summarize' | 'rewrite' | 'translate' | 'ask', selectedText: string, customPrompt?: string) => {
    setIsProcessing(true)
    setExplanation('')
    setDisplayedExplanation('')

    try {
      await ensureExplainerSession()

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

      const stream = explainerSessionRef.current.promptStreaming(promptInstruction)

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
      await ensureExplainerSession()

      const stream = explainerSessionRef.current.promptStreaming(
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
      await ensureExplainerSession()

      // Convert data URL to blob for multimodal input
      const response = await fetch(imageDataUrl)
      const blob = await response.blob()

      const promptText = selectedText 
        ? `Explain this image in the context of: "${selectedText}"`
        : 'Describe and explain what you see in this screenshot:'

      const stream = explainerSessionRef.current.promptStreaming([{
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

  // Cleanup session on unmount
  useEffect(() => {
    return () => {
      if (explainerSessionRef.current) {
        try {
          explainerSessionRef.current.destroy?.()
        } catch (e) {
          console.warn('[Explainer] Error destroying session on unmount:', e)
        }
        explainerSessionRef.current = null
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
