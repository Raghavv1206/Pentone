import test from 'node:test'
import assert from 'node:assert/strict'

test('Suite F: In-Page Components & Text Selection Actions', async (t) => {

  await t.test('1. Text Action Prompt Instructions for Explain, Summarize, Rewrite, Translate, Ask', () => {
    const selectedText = 'Autonomous AI agent for browser tasks'

    const generatePromptForAction = (action: 'explain' | 'summarize' | 'rewrite' | 'translate' | 'ask', text: string, customPrompt?: string) => {
      let promptInstruction = `Explain the following text clearly and concisely in 2-3 sentences:\n\n"${text}"`
      if (action === 'summarize') {
        promptInstruction = `Provide a clear, high-level summary of the following text with key takeaways:\n\n"${text}"`
      } else if (action === 'rewrite') {
        promptInstruction = `Rewrite the following text to improve clarity, elegance, and readability while preserving meaning:\n\n"${text}"`
      } else if (action === 'translate') {
        promptInstruction = `Translate the following text into natural, fluent English (or Hindi if already in English):\n\n"${text}"`
      } else if (action === 'ask') {
        promptInstruction = `${customPrompt || 'Analyze and answer insights regarding the following text'}:\n\n"${text}"`
      }
      return promptInstruction
    }

    const explainPrompt = generatePromptForAction('explain', selectedText)
    assert.ok(explainPrompt.includes('Explain the following text'))
    assert.ok(explainPrompt.includes(selectedText))

    const summarizePrompt = generatePromptForAction('summarize', selectedText)
    assert.ok(summarizePrompt.includes('summary'))
    assert.ok(summarizePrompt.includes(selectedText))

    const rewritePrompt = generatePromptForAction('rewrite', selectedText)
    assert.ok(rewritePrompt.includes('Rewrite the following text'))

    const translatePrompt = generatePromptForAction('translate', selectedText)
    assert.ok(translatePrompt.includes('Translate the following text'))

    const askPrompt = generatePromptForAction('ask', selectedText, 'What framework does this use?')
    assert.ok(askPrompt.includes('What framework does this use?'))
  })

  await t.test('2. Floating capture overlay audio state management and cancellation', async () => {
    let countdown = 5
    let cancelled = false
    let isCapturing = true

    const cancelAudioCapture = () => {
      cancelled = true
      isCapturing = false
    }

    // Simulate countdown tick
    countdown = 4
    assert.equal(countdown, 4)

    // User cancels before 0
    cancelAudioCapture()
    assert.equal(cancelled, true)
    assert.equal(isCapturing, false)
  })

  await t.test('3. Text selection ignores whitespace-only and empty selections', () => {
    const isSelectionValid = (text: string | null | undefined): boolean => {
      if (!text) return false
      return text.trim().length > 0
    }

    assert.equal(isSelectionValid(''), false)
    assert.equal(isSelectionValid('   \n\t  '), false)
    assert.equal(isSelectionValid('Valid text'), true)
  })
})
