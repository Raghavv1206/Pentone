import { useState } from 'react'
import { getPageContext } from './use-page-context'
import { writeTextHeuristically } from './heuristics/text-improver'
import {
  getLanguageModelAPI,
  getWriterAPI,
  checkLanguageModelAvailability,
  checkWriterAvailability,
  createLMSession,
  createWriterSession
} from './chrome-ai-helpers'

interface WriterTargetData {
  element: HTMLInputElement | HTMLTextAreaElement
  cursorPosition: number
}

export const useTextWriter = () => {
  const [isProcessing, setIsProcessing] = useState(false)
  const [output, setOutput] = useState('')
  const [displayedOutput, setDisplayedOutput] = useState('')

  // Resilient text generation using Writer API with Gemini Nano Prompt API fallback
  const generateText = async (prompt: string) => {
    setIsProcessing(true)
    setOutput('')
    setDisplayedOutput('')

    try {
      const pageContext = await getPageContext().catch(() => '')
      let writeSucceeded = false
      let fullOutput = ''

      // 1. PATH 1: Try Chrome's dedicated Writer API IF readily available
      const Writer = getWriterAPI()
      if (Writer && typeof Writer.create === 'function') {
        try {
          const writerAvail = await checkWriterAvailability(Writer, {
            outputLanguage: 'en',
            sharedContext: `${pageContext}You are a helpful writing assistant. Generate clear, concise, and well-written content.`
          })

          if (writerAvail === 'available' || writerAvail === 'after-download') {
            const sharedContext = `${pageContext}You are a helpful writing assistant. Generate clear, concise, and well-written content.`
            const writer = await createWriterSession(Writer, {
              outputLanguage: 'en',
              format: 'plain-text',
              sharedContext
            })

            const stream = writer.writeStreaming(prompt)
            for await (const chunk of stream) {
              fullOutput += chunk
              setOutput(fullOutput)
              setDisplayedOutput(fullOutput)
            }
            writer.destroy?.()
            if (fullOutput.trim()) {
              writeSucceeded = true
            }
          }
        } catch (writerErr) {
          console.warn('[useTextWriter] Dedicated Writer session failed, seamlessly falling back to Gemini Nano:', writerErr)
          fullOutput = ''
        }
      }

      // 2. PATH 2: Universal Fallback using Gemini Nano Prompt API (LanguageModel)
      if (!writeSucceeded) {
        const LM = getLanguageModelAPI()
        const lmAvail = await checkLanguageModelAvailability(LM)

        if (LM && (lmAvail === 'available' || lmAvail === 'after-download')) {
          try {
            const systemPrompt = `You are an expert writing assistant.
Task: Write high-quality, clear, polished content based on the user's prompt.
${pageContext}

CRITICAL RULES:
1. Output ONLY the written content to insert into the document or input box.
2. NEVER include conversational filler, preamble, intros, greetings, or explanations (e.g. NEVER say "Here is what you requested:" or "Sure!").
3. NEVER wrap the output in quotes.
4. Output only the pure written text.`

            const session = await createLMSession(LM, { systemPrompt })
            const stream = session.promptStreaming(prompt)
            for await (const chunk of stream) {
              fullOutput += chunk
              setOutput(fullOutput)
              setDisplayedOutput(fullOutput)
            }
            session.destroy?.()
            if (fullOutput.trim()) {
              writeSucceeded = true
            }
          } catch (lmErr) {
            console.warn('[useTextWriter] LanguageModel generation failed, trying extension background fallback:', lmErr)
            fullOutput = ''
          }
        }
      }

      // 3. PATH 3: Extension context proxy fallback
      if (!writeSucceeded && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        try {
          const response = await new Promise<{ success: boolean; result?: string; error?: string }>((resolve) => {
            chrome.runtime.sendMessage({
              type: 'pentone_ai_write',
              payload: {
                prompt,
                pageContext
              }
            }, (res) => {
              if (chrome.runtime.lastError) {
                resolve({ success: false, error: chrome.runtime.lastError.message })
              } else {
                resolve(res || { success: false, error: 'No response from extension' })
              }
            })
          })

          if (response.success && response.result) {
            fullOutput = response.result
            setOutput(fullOutput)
            setDisplayedOutput(fullOutput)
            writeSucceeded = true
          }
        } catch (msgErr) {
          console.warn('[useTextWriter] Extension background proxy failed:', msgErr)
        }
      }

      if (!writeSucceeded) {
        const heuristicOutput = writeTextHeuristically(prompt, pageContext)
        if (heuristicOutput && heuristicOutput.trim().length > 0) {
          fullOutput = heuristicOutput
          writeSucceeded = true
        } else {
          throw new Error('Gemini Nano is not ready. Please enable Gemini Nano in chrome://flags.')
        }
      }

      // 4. Polish final output (strip accidental surrounding quotes)
      const cleaned = fullOutput.trim().replace(/^["'`]|["'`]$/g, '').trim()
      setOutput(cleaned)
      setDisplayedOutput(cleaned)
    } catch (error: any) {
      console.error('Writer error:', error)
      const userFriendlyMsg = error?.message?.includes('chrome://flags')
        ? error.message
        : `Unable to write content: ${error?.message || 'Model initialization failed'}. Please check chrome://flags.`
      setOutput(userFriendlyMsg)
      setDisplayedOutput(userFriendlyMsg)
    } finally {
      setIsProcessing(false)
    }
  }

  const insertText = (targetData: WriterTargetData | null) => {
    if (
      !targetData ||
      !output ||
      output.startsWith('Error generating text:') ||
      output.startsWith('Error:') ||
      output.toLowerCase().startsWith('error') ||
      output.toLowerCase().startsWith('unable to write') ||
      output.toLowerCase().startsWith('gemini nano is not ready') ||
      output.toLowerCase().includes('availability()') ||
      output.includes('chrome://flags')
    ) {
      return
    }

    const { element, cursorPosition } = targetData

    try {
      const start = cursorPosition
      const end = cursorPosition
      const currentValue = element.value || ''
      const newValue = currentValue.substring(0, start) + output + currentValue.substring(end)
      
      element.value = newValue
      const newCursorPos = start + output.length
      element.setSelectionRange(newCursorPos, newCursorPos)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
      element.focus()
    } catch (error) {
      console.error('Error inserting text:', error)
    }
  }

  const insertContent = (element: HTMLInputElement | HTMLTextAreaElement, cursorPosition: number) => {
    insertText({ element, cursorPosition })
  }

  const reset = () => {
    setOutput('')
    setDisplayedOutput('')
    setIsProcessing(false)
  }

  return {
    isProcessing,
    output,
    displayedOutput,
    generateText,
    insertText,
    insertContent,
    reset
  }
}
