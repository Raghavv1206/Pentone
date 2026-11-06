import { useState } from 'react'
import { getPageContext } from './use-page-context'
import {
  getLanguageModelAPI,
  getRewriterAPI,
  checkLanguageModelAvailability,
  checkRewriterAvailability,
  createLMSession,
  createRewriterSession
} from './chrome-ai-helpers'

interface SelectionData {
  text: string
  element: string
  range: Range
  targetElement?: HTMLInputElement | HTMLTextAreaElement
  selectionStart?: number
  selectionEnd?: number
}

export const useTextRewriter = () => {
  const [isProcessing, setIsProcessing] = useState(false)
  const [suggestion, setSuggestion] = useState('')
  const [displayedSuggestion, setDisplayedSuggestion] = useState('')

  // Resilient text rewriting supporting Chrome's dedicated Rewriter API,
  // Gemini Nano Prompt API, and Extension Context fallback
  const generateSuggestion = async (selectedText: string, instruction: string) => {
    setIsProcessing(true)
    setSuggestion('')
    setDisplayedSuggestion('')

    try {
      // 1. Parse instruction to determine tone and length
      const lowerInstruction = instruction.toLowerCase()
      let tone: 'more-formal' | 'as-is' | 'more-casual' = 'as-is'
      let length: 'shorter' | 'as-is' | 'longer' = 'as-is'

      if (lowerInstruction.includes('formal') || lowerInstruction.includes('professional')) {
        tone = 'more-formal'
      } else if (lowerInstruction.includes('casual') || lowerInstruction.includes('friendly')) {
        tone = 'more-casual'
      }

      if (lowerInstruction.includes('short') || lowerInstruction.includes('brief') || lowerInstruction.includes('concise')) {
        length = 'shorter'
      } else if (lowerInstruction.includes('longer') || lowerInstruction.includes('expand') || lowerInstruction.includes('detailed')) {
        length = 'longer'
      }

      const pageContext = await getPageContext().catch(() => '')
      let rewriteSucceeded = false
      let fullSuggestion = ''

      // 2. PATH 1: Try Chrome's dedicated Rewriter API
      const Rewriter = getRewriterAPI()
      if (Rewriter && typeof Rewriter.create === 'function') {
        try {
          const rewriterAvail = await checkRewriterAvailability(Rewriter, {
            tone,
            format: 'plain-text',
            length,
            sharedContext: `${pageContext}${instruction}`
          })

          if (rewriterAvail === 'available' || rewriterAvail === 'after-download') {
            const sharedContext = `${pageContext}${instruction}`
            const rewriter = await createRewriterSession(Rewriter, {
              tone,
              format: 'plain-text',
              length,
              sharedContext
            })

            const stream = rewriter.rewriteStreaming(selectedText)
            for await (const chunk of stream) {
              fullSuggestion += chunk
              setSuggestion(fullSuggestion)
              setDisplayedSuggestion(fullSuggestion)
            }
            rewriter.destroy?.()
            if (fullSuggestion.trim()) {
              rewriteSucceeded = true
            }
          }
        } catch (rewriterErr) {
          console.warn('[useTextRewriter] Dedicated Rewriter session failed, seamlessly falling back to Gemini Nano:', rewriterErr)
          fullSuggestion = ''
        }
      }

      // 3. PATH 2: Universal Fallback using Gemini Nano Prompt API (LanguageModel) in local window
      if (!rewriteSucceeded) {
        const LM = getLanguageModelAPI()
        const lmAvail = await checkLanguageModelAvailability(LM)

        if (LM && (lmAvail === 'available' || lmAvail === 'after-download')) {
          try {
            const toneInstruction = tone === 'more-formal' ? 'Make the tone formal and professional.' : tone === 'more-casual' ? 'Make the tone casual and friendly.' : 'Keep the tone natural.'
            const lengthInstruction = length === 'shorter' ? 'Make it concise and shorter than the original.' : length === 'longer' ? 'Expand and provide rich detail.' : 'Maintain similar length.'

            const systemPrompt = `You are an expert real-time text rewriting assistant.
User Instruction: ${instruction}
Style: ${toneInstruction} ${lengthInstruction}
${pageContext}

CRITICAL RULES:
1. Output ONLY the rewritten replacement text.
2. NEVER include conversational filler, preamble, intros, greetings, or explanations (e.g. NEVER say "Here is the rewritten text:" or "Sure!").
3. NEVER wrap the output in quotes.
4. Output only the pure rewritten text ready to be pasted directly into the document.`

            const session = await createLMSession(LM, { systemPrompt })
            const promptText = `Rewrite the following text:
"${selectedText}"`

            const stream = session.promptStreaming(promptText)
            for await (const chunk of stream) {
              fullSuggestion += chunk
              setSuggestion(fullSuggestion)
              setDisplayedSuggestion(fullSuggestion)
            }
            session.destroy?.()
            if (fullSuggestion.trim()) {
              rewriteSucceeded = true
            }
          } catch (lmErr) {
            console.warn('[useTextRewriter] Local LanguageModel session failed, trying extension background fallback:', lmErr)
            fullSuggestion = ''
          }
        }
      }

      // 4. PATH 3: Extension context proxy fallback (handles isolated content script restrictions)
      if (!rewriteSucceeded && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        try {
          const response = await new Promise<{ success: boolean; result?: string; error?: string }>((resolve) => {
            chrome.runtime.sendMessage({
              type: 'pentone_ai_rewrite',
              payload: {
                selectedText,
                instruction,
                tone,
                length,
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
            fullSuggestion = response.result
            setSuggestion(fullSuggestion)
            setDisplayedSuggestion(fullSuggestion)
            rewriteSucceeded = true
          }
        } catch (msgErr) {
          console.warn('[useTextRewriter] Extension background proxy failed:', msgErr)
        }
      }

      if (!rewriteSucceeded) {
        throw new Error('Gemini Nano is not ready. Please enable Gemini Nano in chrome://flags and check chrome://components.')
      }

      // 5. Polish final output (strip accidental surrounding quotes)
      const cleaned = fullSuggestion.trim().replace(/^["'`]|["'`]$/g, '').trim()
      setSuggestion(cleaned)
      setDisplayedSuggestion(cleaned)
    } catch (error: any) {
      console.error('Rewriter error:', error)
      const userFriendlyMsg = error?.message?.includes('chrome://flags')
        ? error.message
        : `Unable to rewrite text: ${error?.message || 'Model initialization failed'}. Please check chrome://flags.`
      setSuggestion(userFriendlyMsg)
      setDisplayedSuggestion(userFriendlyMsg)
    } finally {
      setIsProcessing(false)
    }
  }

  const replaceSelection = (selectionData: SelectionData | null) => {
    // Guard against empty suggestion or error text injection
    if (
      !selectionData ||
      !suggestion ||
      suggestion.startsWith('Error generating suggestion:') ||
      suggestion.startsWith('Error:') ||
      suggestion.toLowerCase().startsWith('error') ||
      suggestion.toLowerCase().startsWith('unable to rewrite') ||
      suggestion.toLowerCase().startsWith('gemini nano is not ready') ||
      suggestion.toLowerCase().includes('availability()') ||
      suggestion.includes('chrome://flags')
    ) {
      return
    }

    const range = selectionData.range

    try {
      // For input/textarea elements - use stored reference
      if (selectionData.targetElement) {
        const element = selectionData.targetElement
        const start = selectionData.selectionStart || 0
        const end = selectionData.selectionEnd || 0
        const newValue = element.value.substring(0, start) + suggestion + element.value.substring(end)
        element.value = newValue
        element.setSelectionRange(start, start + suggestion.length)
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
        element.focus()
      } else {
        // For contenteditable and regular text
        const selection = window.getSelection()
        if (!selection) return

        selection.removeAllRanges()
        selection.addRange(range)

        let success = false
        try {
          success = document.execCommand('delete', false)
          if (success) {
            success = document.execCommand('insertText', false, suggestion)
          }
        } catch (e) {
          console.warn('execCommand failed, trying fallback:', e)
          success = false
        }

        // Fallback method if execCommand doesn't work
        if (!success) {
          try {
            range.deleteContents()
            const textNode = document.createTextNode(suggestion)
            range.insertNode(textNode)

            range.setStartAfter(textNode)
            range.setEndAfter(textNode)
            selection.removeAllRanges()
            selection.addRange(range)

            const container = range.commonAncestorContainer
            if (container && container.nodeType === Node.ELEMENT_NODE) {
              const el = container as HTMLElement
              el.dispatchEvent(new Event('input', { bubbles: true }))
              el.dispatchEvent(new Event('change', { bubbles: true }))
            } else if (container && container.parentElement) {
              container.parentElement.dispatchEvent(new Event('input', { bubbles: true }))
              container.parentElement.dispatchEvent(new Event('change', { bubbles: true }))
            }
          } catch (e2) {
            console.error('All text replacement methods failed:', e2)
          }
        }
      }
    } catch (error) {
      console.error('Error replacing selection:', error)
    }
  }

  const reset = () => {
    setSuggestion('')
    setDisplayedSuggestion('')
    setIsProcessing(false)
  }

  return {
    isProcessing,
    suggestion,
    displayedSuggestion,
    generateSuggestion,
    replaceSelection,
    reset
  }
}
