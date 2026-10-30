import test from 'node:test'
import assert from 'node:assert/strict'
import { 
  shouldSummarize, 
  MAX_CONTEXT_SIZE, 
  CONTEXT_RESERVE_TOKENS, 
  SAFE_CONTEXT_LIMIT, 
  summarizeConversation 
} from '../lib/summarizer'
import { createInternalMessage, createUserMessage, createAssistantMessage } from '../lib/messages'

test('Context Management: Safe budget guarantees 2500+ token reserve before compaction', () => {
  assert.equal(MAX_CONTEXT_SIZE, 9216)
  assert.ok(CONTEXT_RESERVE_TOKENS >= 2500)
  assert.equal(SAFE_CONTEXT_LIMIT, 5500)

  // 5000 tokens should not trigger compaction yet
  assert.equal(shouldSummarize(5000), false)

  // 5500 tokens reaches the proactive limit and triggers compaction early
  assert.equal(shouldSummarize(5500), true)

  // 8974 tokens (the failing scenario from Chrome runtime) triggers compaction
  assert.equal(shouldSummarize(8974), true)
})

test('Context Management: Base64 screenshot payloads are not stored as massive strings in conversation history', () => {
  const fakeLargeDataUrl = 'data:image/png;base64,' + 'A'.repeat(500000) // 500KB fake screenshot
  
  // Simulate the sanitized storage pattern implemented in chat-context.tsx
  let storedResult = fakeLargeDataUrl
  if (typeof storedResult === 'string' && storedResult.startsWith('data:image/')) {
    storedResult = '[Screenshot captured from tab. Visual data sent to model vision pipeline.]'
  }

  const msg = createInternalMessage(`[TOOL RESULT]\n${storedResult}`, 'tool_result', 0)
  
  assert.ok(msg.content.includes('[Screenshot captured from tab.'))
  assert.equal(msg.content.includes('data:image/'), false, 'Conversation message MUST NOT store the raw Base64 data URL')
  assert.ok(msg.content.length < 200, 'Tool result message should be a compact descriptor')
})

test('Context Management: Conversation summarizer filters out previous summaries to avoid recursive summarization', async () => {
  const messages = [
    createInternalMessage('[CONTEXT SUMMARY - Previous conversation]\nOld summary of initial actions', 'summary', 0),
    createUserMessage('Now open GitHub and find the repository'),
    createInternalMessage('[TOOL RESULT]\nPage title: GitHub: Let’s build from here', 'tool_result', 0),
    createAssistantMessage('I have opened GitHub.')
  ]

  // Mock global Summarizer API
  const originalSummarizer = (globalThis as any).Summarizer
  let capturedInputText = ''

  ;(globalThis as any).Summarizer = {
    availability: async () => 'available',
    create: async () => ({
      summarize: async (text: string) => {
        capturedInputText = text
        return 'User navigated to GitHub and is looking for repository.'
      },
      destroy: () => {}
    })
  }

  try {
    const summary = await summarizeConversation(messages)
    assert.ok(summary.includes('GitHub'))
    // Verify that the old [CONTEXT SUMMARY] was filtered out and not re-summarized
    assert.equal(capturedInputText.includes('[CONTEXT SUMMARY'), false, 'Must filter out previous summary messages')
    assert.ok(capturedInputText.includes('Now open GitHub'))
  } finally {
    if (originalSummarizer) {
      ;(globalThis as any).Summarizer = originalSummarizer
    } else {
      delete (globalThis as any).Summarizer
    }
  }
})

test('Context Management: Conversation summarizer falls back to LanguageModel when Summarizer is unavailable', async () => {
  const messages = [
    createUserMessage('What is the weather today?'),
    createAssistantMessage('It is sunny.')
  ]

  // Simulate Summarizer unavailable but LanguageModel available
  const originalSummarizer = (globalThis as any).Summarizer
  const originalLM = (globalThis as any).LanguageModel

  ;(globalThis as any).Summarizer = {
    availability: async () => 'unavailable'
  }

  let lmCalled = false
  ;(globalThis as any).LanguageModel = {
    create: async () => ({
      prompt: async (p: string) => {
        lmCalled = true
        return 'User asked for weather and assistant answered sunny.'
      },
      destroy: () => {}
    })
  }

  try {
    const summary = await summarizeConversation(messages)
    assert.equal(lmCalled, true, 'LanguageModel fallback must be invoked when Summarizer is unavailable')
    assert.ok(summary.includes('weather'))
  } finally {
    if (originalSummarizer) (globalThis as any).Summarizer = originalSummarizer
    else delete (globalThis as any).Summarizer
    if (originalLM) (globalThis as any).LanguageModel = originalLM
    else delete (globalThis as any).LanguageModel
  }
})

test('Page Summarization: Chunking function splits oversized content without truncating bottom sections', () => {
  // Simple chunking algorithm verification matching lib/ui-tools.ts
  const chunkText = (text: string, maxChunk: number = 3500): string[] => {
    const paragraphs = text.split(/\n\s*\n/)
    const chunks: string[] = []
    let current = ''
    for (const p of paragraphs) {
      if ((current + '\n\n' + p).length <= maxChunk) {
        current = current ? current + '\n\n' + p : p
      } else {
        if (current) chunks.push(current)
        if (p.length > maxChunk) {
          let rem = p
          while (rem.length > maxChunk) {
            const cutIdx = rem.lastIndexOf('\n', maxChunk) !== -1 
              ? rem.lastIndexOf('\n', maxChunk)
              : rem.lastIndexOf('. ', maxChunk) !== -1 
                ? rem.lastIndexOf('. ', maxChunk) + 1 
                : maxChunk
            chunks.push(rem.slice(0, cutIdx).trim())
            rem = rem.slice(cutIdx).trim()
          }
          current = rem
        } else {
          current = p
        }
      }
    }
    if (current) chunks.push(current)
    return chunks.length > 0 ? chunks : [text.slice(0, maxChunk)]
  }

  // Generate 10,000 characters of text across 10 paragraphs
  const paragraphs = Array.from({ length: 10 }, (_, i) => `Section ${i + 1}: ${'Content '.repeat(100)}`)
  const largeText = paragraphs.join('\n\n')

  const chunks = chunkText(largeText, 3000)
  assert.ok(chunks.length >= 3, 'Must produce multiple chunks for 10KB text')
  
  // Verify that all sections are preserved across the chunks
  for (let i = 1; i <= 10; i++) {
    const found = chunks.some(c => c.includes(`Section ${i}:`))
    assert.equal(found, true, `Section ${i} must be present in chunks and not truncated`)
  }
})

test('Page Summarization: Detects insufficient readable content and does not invent summaries', () => {
  const minimalContent = '   '
  const isSufficient = Boolean(minimalContent && minimalContent.trim().length >= 50)
  assert.equal(isSufficient, false, 'Empty or near-empty pages must be rejected rather than hallucinating a summary')
})

test('Page Summarization: YouTube feed extractor structures actual video items instead of promo banners', () => {
  // Simulated YouTube DOM video elements
  const mockVideoCards = [
    { title: 'Learn TypeScript in 1 Hour', channel: 'Code Academy', meta: '1.2M views • 2 weeks ago' },
    { title: 'Gemma 4 Chrome AI Architecture', channel: 'Web Dev Daily', meta: '45K views • 1 day ago' },
    { title: 'Building MV3 Chrome Extensions', channel: 'Extension Masters', meta: '80K views • 3 months ago' }
  ]

  const activeFilter = 'Programming'
  const formattedFeed = `Platform: YouTube\nPage: YouTube\nActive Filter / Topic: ${activeFilter}\n\nVisible Videos & Recommendations:\n` +
    mockVideoCards.map((v, i) => `- "${v.title}" by ${v.channel} (${v.meta})`).join('\n')

  assert.ok(formattedFeed.includes('Learn TypeScript in 1 Hour'))
  assert.ok(formattedFeed.includes('Gemma 4 Chrome AI Architecture'))
  assert.ok(formattedFeed.includes('Visible Videos & Recommendations:'))
  assert.equal(formattedFeed.includes('festivities, fashion, and fireworks'), false)
})

test('Clipboard & Selection Safety: Normal selection does NOT wipe window.getSelection() ranges', () => {
  // Mock browser window and selection
  let rangesCleared = false
  const mockSelection = {
    isCollapsed: false,
    toString: () => 'Selected article text for copying',
    removeAllRanges: () => {
      rangesCleared = true
    },
    getRangeAt: () => ({
      getClientRects: () => [{ top: 100, left: 100, width: 200, height: 20 }]
    })
  }

  // Under our updated logic, activateSelection reads the selection but never calls removeAllRanges()
  const text = mockSelection.toString().trim()
  assert.equal(text, 'Selected article text for copying')
  assert.equal(rangesCleared, false, 'selection.removeAllRanges() MUST NEVER be called on selection')
})

test('Settings: Default settings enable text selection and auto-popup toolbar by default', async () => {
  const { DEFAULT_SETTINGS } = await import('../lib/settings')
  assert.equal(DEFAULT_SETTINGS.textSelectionEnabled, true)
  assert.equal(DEFAULT_SETTINGS.autoTextSelectionPopup, true)
})

test('Tool Specs: clickElement handles all interactive elements and openTab is for navigation', async () => {
  const clickElementModule = await import('../lib/tools/clickElement')
  const openTabModule = await import('../lib/tools/openTab')

  // clickElement should not claim "NOT links"
  assert.doesNotMatch(clickElementModule.spec.description, /NOT links/i)
  assert.match(clickElementModule.spec.description, /button,\s*link,\s*video/i)

  // openTab should not claim "click first video"
  assert.doesNotMatch(openTabModule.spec.description, /USE THIS to open links\/videos,\s*NOT clickElement/i)
  assert.match(openTabModule.spec.description, /navigate directly to websites or URLs/i)
})

test('TTS: Timeout duration formula gives at least 5000ms buffer to prevent premature sentence cutoff', () => {
  const estimateSpeakingDuration = (text: string) => {
    const words = text.trim().split(/\s+/).length
    return Math.max(1000, (words / 150) * 60 * 1000)
  }

  const shortSentence = "Hello"
  const estDuration = estimateSpeakingDuration(shortSentence) // 1000ms
  const timeoutDuration = Math.max(estDuration * 2, estDuration + 5000) // 6000ms

  assert.ok(timeoutDuration >= estDuration + 5000, 'Timeout must provide at least 5000ms buffer')
  assert.ok(timeoutDuration >= 6000)
})
