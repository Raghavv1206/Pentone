import type { ToolSpec } from '../tool-types'
import { extractViewCountFromText, selectHighestViewVideo, type VideoCandidate } from '../view-count-normalizer'

async function findElements(params: { query: string }) {
  try {
    if (!params.query) {
      return { success: false, error: 'Query string is required' }
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    const scriptResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        // Helper: Brief wait for dynamic elements if page is still rendering (e.g. YouTube Polymer)
        const isYouTube = window.location.hostname.includes('youtube.com')
        if (isYouTube && !document.querySelector('ytd-video-renderer, ytd-rich-item-renderer, a#video-title')) {
          await new Promise(r => setTimeout(r, 600))
        }

        const elements: any[] = []
        const videoCards: any[] = []
        let globalIndex = 0

        // 1. YouTube & video search result cards dedicated extraction
        const videoRenderers = Array.from(document.querySelectorAll(
          'ytd-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, .video-card, [data-video-id]'
        ))

        const processedVideoHrefs = new Set<string>()

        videoRenderers.forEach((cardEl) => {
          const titleLink = (cardEl.querySelector('a#video-title, h3 a, a.yt-simple-endpoint#video-title, a[href*="/watch"]') as HTMLAnchorElement | null)
          if (!titleLink) return

          const href = titleLink.href || titleLink.getAttribute('href') || ''
          if (!href || processedVideoHrefs.has(href)) return
          processedVideoHrefs.add(href)

          // Extract title
          const title = titleLink.getAttribute('title') || titleLink.textContent?.trim() || ''
          const ariaLabel = titleLink.getAttribute('aria-label') || ''

          // Extract channel name
          const channelEl = cardEl.querySelector('#channel-info a, ytd-channel-name a, #byline a, #channel-name, .ytd-channel-name, .channel-name')
          const channel = channelEl?.textContent?.trim() || ''

          // Extract view count from metadata line or aria-label
          const metaSpans = Array.from(cardEl.querySelectorAll('#metadata-line span.inline-metadata-item, #metadata-line span, .view-count'))
          let viewCountRaw = ''
          metaSpans.forEach(span => {
            const text = span.textContent?.trim() || ''
            if (/\b(?:views|aufrufe|vues|visualizaciones|watching|lakh|crore|万|亿)\b/i.test(text) || /^\d+[kmb]?\b/i.test(text)) {
              if (!viewCountRaw) viewCountRaw = text
            }
          })

          // Tag the clickable element
          const dataAttr = `data-pentone-${globalIndex}`
          titleLink.setAttribute(dataAttr, 'true')

          const rect = titleLink.getBoundingClientRect()
          const isVisible = rect.width > 0 && rect.height > 0 && rect.top < 10000

          const videoCardData = {
            index: globalIndex,
            role: 'video',
            name: title || ariaLabel.substring(0, 80),
            fullAriaLabel: ariaLabel,
            title,
            channel,
            viewCountRaw,
            href: href.startsWith('/') ? `${window.location.origin}${href}` : href,
            selector: `[${dataAttr}]`,
            tagName: 'a',
            visibility: isVisible,
            disabled: false
          }

          videoCards.push(videoCardData)
          elements.push(videoCardData)
          globalIndex++
        })

        // 2. Standard interactive elements extraction
        const interactiveSelectors = [
          'button',
          'a[href]',
          'input',
          'textarea',
          'select',
          '[role="button"]',
          '[role="link"]',
          '[role="textbox"]',
          '[tabindex]:not([tabindex="-1"])',
          '[onclick]'
        ]

        const allElements = document.querySelectorAll(interactiveSelectors.join(','))

        allElements.forEach((el) => {
          const htmlEl = el as HTMLElement

          // Avoid double-indexing already tagged video links
          if (htmlEl.hasAttribute('data-pentone-0') || Array.from(htmlEl.attributes).some(a => a.name.startsWith('data-pentone-'))) {
            return
          }

          // Skip hidden or non-visible elements
          const style = window.getComputedStyle(htmlEl)
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return
          }

          const rect = htmlEl.getBoundingClientRect()
          if (rect.width === 0 || rect.height === 0 || rect.top < -10000 || rect.left < -10000) {
            return
          }

          // Compute accessible name
          let accessibleName = ''
          if (htmlEl.hasAttribute('aria-label')) {
            accessibleName = htmlEl.getAttribute('aria-label') || ''
          } else if (htmlEl.hasAttribute('aria-labelledby')) {
            const labelId = htmlEl.getAttribute('aria-labelledby')
            const labelEl = labelId ? document.getElementById(labelId) : null
            accessibleName = labelEl?.textContent?.trim() || ''
          } else if (htmlEl instanceof HTMLInputElement || htmlEl instanceof HTMLTextAreaElement) {
            const label = htmlEl.labels?.[0]
            accessibleName = label?.textContent?.trim() || htmlEl.placeholder || ''
          } else {
            accessibleName = htmlEl.textContent?.trim() || ''
          }

          // Get role
          let role = htmlEl.getAttribute('role') || ''
          if (!role) {
            const tagName = htmlEl.tagName.toLowerCase()
            if (tagName === 'button') role = 'button'
            else if (tagName === 'a') role = 'link'
            else if (tagName === 'input') {
              const type = (htmlEl as HTMLInputElement).type
              role = type === 'submit' ? 'button' : 'textbox'
            }
            else if (tagName === 'textarea') role = 'textbox'
            else if (tagName === 'select') role = 'combobox'
          }

          const dataAttr = `data-pentone-${globalIndex}`
          htmlEl.setAttribute(dataAttr, 'true')

          // Generous length preservation (250 chars) so view counts / metadata are never truncated
          const displayName = accessibleName.length > 250 
            ? accessibleName.substring(0, 247) + '...'
            : accessibleName

          elements.push({
            index: globalIndex,
            role,
            name: displayName,
            tagName: htmlEl.tagName.toLowerCase(),
            selector: `[${dataAttr}]`,
            type: htmlEl instanceof HTMLInputElement ? htmlEl.type : null,
            href: htmlEl instanceof HTMLAnchorElement ? htmlEl.href : null,
            disabled: htmlEl.hasAttribute('disabled')
          })

          globalIndex++
        })

        return { elements, videoCards }
      }
    })

    const payload = scriptResult[0]?.result || { elements: [], videoCards: [] }
    const rawElements = payload.elements || []
    const rawVideoCards = payload.videoCards || []

    if (rawElements.length === 0) {
      return {
        success: true,
        result: `No interactive elements found on this page.`
      }
    }

    // Process and normalize video candidates
    const videoCandidates: VideoCandidate[] = rawVideoCards.map((card: any) => {
      // Extract views from dedicated viewCountRaw or full aria-label
      let parsed = card.viewCountRaw ? extractViewCountFromText(card.viewCountRaw) : { numeric: null, raw: '', confidence: 'none' as const }
      if (parsed.numeric === null && card.fullAriaLabel) {
        parsed = extractViewCountFromText(card.fullAriaLabel)
      }

      return {
        index: card.index,
        title: card.title || card.name,
        channel: card.channel,
        viewCountRaw: parsed.raw || card.viewCountRaw || 'Views unavailable',
        viewCountNumeric: parsed.numeric ?? undefined,
        url: card.href,
        confidence: parsed.confidence,
        visibility: card.visibility
      }
    })

    const qLower = params.query.toLowerCase().trim()
    const isVideoSpecificQuery = /\b(?:video|videos|views|view\s+count|most\s+views|highest\s+views|react|tutorial|search\s+results)\b/i.test(qLower)
    const isMostViewsQuery = /\b(?:most\s+views|highest\s+views|top\s+views|most\s+viewed|highest\s+view\s+count)\b/i.test(qLower)

    // If query specifically seeks videos or the page has video cards
    if (videoCandidates.length > 0 && isVideoSpecificQuery) {
      const highestViewVideo = selectHighestViewVideo(videoCandidates)

      // Sort candidates if user asked for most views
      const displayCandidates = [...videoCandidates]
      if (isMostViewsQuery) {
        displayCandidates.sort((a, b) => (b.viewCountNumeric || 0) - (a.viewCountNumeric || 0))
      }

      let output = `Found ${videoCandidates.length} video result cards on this page:\n\n`
      displayCandidates.slice(0, 10).forEach(c => {
        const viewsStr = c.viewCountNumeric !== undefined
          ? `${c.viewCountRaw} (${c.viewCountNumeric.toLocaleString()} views)`
          : c.viewCountRaw || 'View count unavailable'
        const channelStr = c.channel ? ` by "${c.channel}"` : ''
        output += `[${c.index}] VIDEO: "${c.title}"${channelStr} | Views: ${viewsStr} | URL: ${c.url}\n`
      })

      if (highestViewVideo && highestViewVideo.viewCountNumeric !== undefined) {
        output += `\n[VERIFIED HIGHEST-VIEW CANDIDATE: [${highestViewVideo.index}] "${highestViewVideo.title}" with ${highestViewVideo.viewCountRaw} (${highestViewVideo.viewCountNumeric.toLocaleString()} views)]`
        output += `\nRecommendation: Call clickElement({"index": ${highestViewVideo.index}}) or openTab({"url": "${highestViewVideo.url}"}) to open this video.`
      } else if (isMostViewsQuery) {
        output += `\n[Note: View counts could not be verified from the visible cards. Inspect additional results or report unavailable.]`
      }

      return {
        success: true,
        candidates: displayCandidates,
        highestViewCandidate: highestViewVideo,
        result: output
      }
    }

    // Filter out elements with no meaningful text/name
    const meaningfulElements = rawElements.filter((el: any) => {
      const hasText = el.name && el.name.trim().length > 0
      const isNotJustSymbol = el.name && el.name.length > 1 || el.name && !/^[×☰≡•]$/.test(el.name)
      return hasText && isNotJustSymbol
    })

    if (meaningfulElements.length === 0) {
      return {
        success: true,
        result: `No elements with text found matching "${params.query}". Try a different query.`
      }
    }

    let topElements: any[] = []

    // Direct CSS selector query handling (e.g. "[data-pentone-1]", "#id", ".class")
    const pentoneMatch = params.query.match(/\[data-pentone-(\d+)\]/i)
    if (pentoneMatch) {
      const targetIdx = Number(pentoneMatch[1])
      const exactMatch = rawElements.find((el: any) => el.index === targetIdx)
      if (exactMatch) {
        topElements = [{ ...exactMatch, similarity: 1.0 }]
      }
    } else if (params.query.startsWith('#') || params.query.startsWith('.') || params.query.startsWith('[')) {
      const selectorMatches = rawElements.filter((el: any) => 
        el.selector === params.query || (el.tagName && el.tagName === params.query)
      )
      if (selectorMatches.length > 0) {
        topElements = selectorMatches.map((el: any) => ({ ...el, similarity: 1.0 }))
      }
    }

    if (topElements.length === 0) {
      try {
        const { generateEmbedding, cosineSimilarity } = await import('../embeddings')
        const queryEmbedding = await generateEmbedding(params.query)
        const elementsWithSimilarity = await Promise.all(
          meaningfulElements.map(async (el: any) => {
            const elementText = `${el.role} ${el.name}`.trim()
            const embedding = await generateEmbedding(elementText)
            const similarity = cosineSimilarity(queryEmbedding, embedding)
            return { ...el, similarity }
          })
        )
        elementsWithSimilarity.sort((a, b) => b.similarity - a.similarity)
        topElements = elementsWithSimilarity.slice(0, 10)
      } catch (embErr) {
        const qWords = qLower.split(/\s+/).filter(w => w.length > 1)
        const isSecond = /\b(?:second|2nd|2)\b/i.test(qLower)
        const isThird = /\b(?:third|3rd|3)\b/i.test(qLower)
        const isFirst = /\b(?:first|1st|1)\b/i.test(qLower)
        const targetOrdinal = isSecond ? 1 : isThird ? 2 : isFirst ? 0 : -1

        const scored = meaningfulElements.map((el: any) => {
          let score = 0
          const nameLower = el.name.toLowerCase()
          const roleLower = el.role.toLowerCase()

          if (nameLower.includes(qLower)) score += 50
          for (const w of qWords) {
            if (nameLower.includes(w)) score += 10
            if (roleLower.includes(w)) score += 5
          }
          if (el.role === 'video' || el.role === 'link' || el.role === 'button') score += 5
          return { ...el, similarity: Math.min(score / 50, 1) }
        })

        scored.sort((a, b) => (b.similarity || 0) - (a.similarity || 0))

        const videoLinks = meaningfulElements.filter((el: any) => 
          el.role === 'video' || (el.role === 'link' && (el.href?.includes('/watch') || el.name.length > 10))
        )
        if (targetOrdinal >= 0 && videoLinks.length > targetOrdinal) {
          const target = videoLinks[targetOrdinal]
          topElements = [
            { ...target, similarity: 0.99 },
            ...scored.filter((el: any) => el.index !== target.index).slice(0, 9)
          ]
        } else {
          topElements = scored.slice(0, 10)
        }
      }
    }

    if (topElements.length === 0) {
      return {
        success: true,
        result: `No elements found matching "${params.query}".`
      }
    }

    let output = `Found ${rawElements.length} elements (${meaningfulElements.length} with text), showing top ${topElements.length} matches for "${params.query}":\n\n`
    topElements.forEach((el: any) => {
      const disabled = el.disabled ? ' [DISABLED]' : ''
      const type = el.type ? ` (type: ${el.type})` : ''
      const href = el.href ? ` (${el.href})` : ''
      const similarity = ` [${(el.similarity * 100).toFixed(0)}% match]`
      output += `[${el.index}] ${el.role.toUpperCase()}: "${el.name}"${type}${href}${disabled}${similarity}\n`
    })

    return { 
      success: true, 
      result: output
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'findElements',
  description: 'Finds and inspects UI elements (buttons, inputs, links, and video cards with view counts) on the active page. Returns relevant matches with indices for clickElement.',
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'Natural language description of what to find (e.g., "video results", "most views", "search input", "submit button")',
      required: true
    }
  ],
  spokenLine: "Looking for {query}",
  examples: [
    'User: "analyze this page and open the video with most views" → findElements with query: "video results"',
    'User: "click the submit button" → findElements with query: "submit button"',
    'User: "click first video" → findElements with query: "video results"'
  ]
}

export default findElements
