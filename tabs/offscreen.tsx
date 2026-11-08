import React, { useEffect } from "react"
import {
  getLanguageModelAPI,
  getRewriterAPI,
  getWriterAPI,
  checkLanguageModelAvailability,
  checkRewriterAvailability,
  checkWriterAvailability,
  createLMSession,
  createRewriterSession,
  createWriterSession
} from "../lib/chrome-ai-helpers"
import { ensureSession } from "../lib/ai"
import { improveTextHeuristically } from "../lib/heuristics/text-improver"
import "../lib/suppress-warnings"

export default function OffscreenPage() {
  useEffect(() => {
    console.log("[Pentone Offscreen] Worker mounted and ready for on-device AI tasks")

    const handleMessage = (message: any, sender: any, sendResponse: (res?: any) => void) => {
      if (message.type === "ping_offscreen") {
        sendResponse({ alive: true })
        return true
      }

      if (message.type === "pentone_offscreen_rewrite") {
        (async () => {
          try {
            const { selectedText, instruction, tone = "as-is", length = "as-is", pageContext = "" } = message.payload || {}
            
            // 1. Try dedicated Rewriter API first
            const Rewriter = getRewriterAPI()
            if (Rewriter && typeof Rewriter.create === "function") {
              try {
                const avail = await checkRewriterAvailability(Rewriter, {
                  outputLanguage: "en",
                  tone,
                  format: "plain-text",
                  length
                })
                if (avail === "available" || avail === "after-download") {
                  const rw = await createRewriterSession(Rewriter, {
                    outputLanguage: "en",
                    tone,
                    format: "plain-text",
                    length,
                    sharedContext: `${pageContext}${instruction}`
                  })
                  const res = await rw.rewrite(selectedText)
                  rw.destroy?.()
                  const cleaned = (res || "").trim().replace(/^["'`]|["'`]$/g, "").trim()
                  if (cleaned) {
                    sendResponse({ success: true, result: cleaned })
                    return
                  }
                }
              } catch (rwErr) {
                console.warn("[Offscreen] Dedicated Rewriter failed, trying LanguageModel:", rwErr)
              }
            }

            // 2. Try LanguageModel Prompt API (Gemini Nano)
            const LM = getLanguageModelAPI()
            if (LM) {
              const lmAvail = await checkLanguageModelAvailability(LM)
              if (lmAvail === "available" || lmAvail === "after-download") {
                const toneInstruction = tone === "more-formal" ? "Make the tone formal and professional." : tone === "more-casual" ? "Make the tone casual and friendly." : "Keep the tone natural."
                const lengthInstruction = length === "shorter" ? "Make it concise and shorter than the original." : length === "longer" ? "Expand and provide rich detail." : "Maintain similar length."
                const systemPrompt = `You are an expert real-time text rewriting assistant.
User Instruction: ${instruction || "Improve and rewrite"}
Style: ${toneInstruction} ${lengthInstruction}
${pageContext}

CRITICAL RULES:
1. Output ONLY the rewritten replacement text.
2. NEVER include conversational filler, preamble, intros, greetings, or explanations.
3. NEVER wrap the output in quotes.
4. Output only the pure rewritten text ready to be pasted directly into the document.`

                const session = await createLMSession(LM, { systemPrompt, outputLanguage: "en" })
                const promptText = `Rewrite the following text according to instructions:
"${selectedText}"`
                const res = await session.prompt(promptText)
                session.destroy?.()
                const cleaned = (res || "").trim().replace(/^["'`]|["'`]$/g, "").trim()
                if (cleaned) {
                  sendResponse({ success: true, result: cleaned })
                  return
                }
              }
            }

            // 3. Fallback to ensureSession from lib/ai
            try {
              const session = await ensureSession()
              const prompt = `Rewrite the following text according to instructions:
${instruction || "Improve and rewrite"}

Text:
"${selectedText}"

Output only the pure rewritten replacement text without preamble or quotes.`
              const result = await session.prompt(prompt)
              const cleaned = (result || "").trim().replace(/^["'`]|["'`]$/g, "").trim()
              if (cleaned) {
                sendResponse({ success: true, result: cleaned })
                return
              }
            } catch (aiErr) {
              console.warn("[Offscreen] ensureSession fallback failed:", aiErr)
            }

            // 4. Intelligent offline heuristic fallback (guarantees user is never blocked)
            const heuristicResult = improveTextHeuristically(selectedText, instruction, tone, length)
            if (heuristicResult && heuristicResult !== selectedText) {
              sendResponse({ success: true, result: heuristicResult })
              return
            }

            sendResponse({ success: false, error: "Model returned empty output" })
          } catch (err: any) {
            console.error("[Offscreen] Rewrite error:", err)
            // Even if an unexpected exception occurs, try heuristic fallback before failing
            try {
              const { selectedText, instruction, tone, length } = message.payload || {}
              const fallback = improveTextHeuristically(selectedText, instruction, tone, length)
              if (fallback) {
                sendResponse({ success: true, result: fallback })
                return
              }
            } catch {}
            sendResponse({ success: false, error: err?.message || "Offscreen rewrite failed" })
          }
        })()
        return true
      }

      if (message.type === "pentone_offscreen_write") {
        (async () => {
          try {
            const { prompt, pageContext = "" } = message.payload || {}
            
            // 1. Try dedicated Writer API
            const Writer = getWriterAPI()
            if (Writer && typeof Writer.create === "function") {
              try {
                const avail = await checkWriterAvailability(Writer, { outputLanguage: "en" })
                if (avail === "available" || avail === "after-download") {
                  const writer = await createWriterSession(Writer, {
                    outputLanguage: "en",
                    format: "plain-text",
                    sharedContext: pageContext
                  })
                  const res = await writer.write(prompt)
                  writer.destroy?.()
                  const cleaned = (res || "").trim().replace(/^["'`]|["'`]$/g, "").trim()
                  if (cleaned) {
                    sendResponse({ success: true, result: cleaned })
                    return
                  }
                }
              } catch (wErr) {
                console.warn("[Offscreen] Dedicated Writer failed, trying LanguageModel:", wErr)
              }
            }

            // 2. Try LanguageModel Prompt API
            const LM = getLanguageModelAPI()
            if (LM) {
              const lmAvail = await checkLanguageModelAvailability(LM)
              if (lmAvail === "available" || lmAvail === "after-download") {
                const systemPrompt = `You are an expert writing assistant.
Task: Write high-quality, clear, polished content based on the user's prompt.
${pageContext}

CRITICAL RULES:
1. Output ONLY the written content to insert into the document or input box.
2. NEVER include conversational filler, preamble, intros, greetings, or explanations.
3. NEVER wrap the output in quotes.
4. Output only the pure written text.`

                const session = await createLMSession(LM, { systemPrompt, outputLanguage: "en" })
                const res = await session.prompt(prompt)
                session.destroy?.()
                const cleaned = (res || "").trim().replace(/^["'`]|["'`]$/g, "").trim()
                if (cleaned) {
                  sendResponse({ success: true, result: cleaned })
                  return
                }
              }
            }

            // 3. Fallback to ensureSession
            try {
              const session = await ensureSession()
              const res = await session.prompt(prompt)
              const cleaned = (res || "").trim().replace(/^["'`]|["'`]$/g, "").trim()
              if (cleaned) {
                sendResponse({ success: true, result: cleaned })
                return
              }
            } catch (aiErr) {
              console.warn("[Offscreen] ensureSession write fallback failed:", aiErr)
            }

            sendResponse({ success: false, error: "Write operation returned empty output" })
          } catch (err: any) {
            console.error("[Offscreen] Write error:", err)
            sendResponse({ success: false, error: err?.message || "Offscreen write failed" })
          }
        })()
        return true
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage)
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage)
    }
  }, [])

  return (
    <div style={{ display: "none" }}>
      <h1>Pentone AI Background Engine Active</h1>
    </div>
  )
}
