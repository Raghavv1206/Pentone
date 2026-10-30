// storeMemory tool - Store information for later recall
import type { ToolSpec } from '../tool-types'

async function storeMemory(params: any) {
  try {
    const { content, tags } = params
    
    if (!content || typeof content !== 'string') {
      return { success: false, error: 'Content is required and must be a string' }
    }

    const trimmed = content.trim()
    const words = trimmed.split(/\s+/).filter(Boolean)
    
    // Explicit user intent guardrail: Reject single words, proper nouns, or short fragments
    if (words.length < 3 || trimmed.length < 10) {
      return { 
        success: false, 
        error: `storeMemory rejected: "${trimmed}" lacks sufficient factual context or appears to be a single word/name. Memory storage requires an explicit, complete user fact or preference (e.g. "User prefers dark mode"). Never store single words or unrequested names.`
      }
    }

    // Get existing memories
    const storage = await chrome.storage.local.get(['agent_memories'])
    const memories = storage.agent_memories || []

    // Generate embedding for semantic search
    let embedding: number[] | undefined
    try {
      console.log('[storeMemory] Generating embedding...')
      const { generateEmbedding } = await import('../embeddings')
      embedding = await generateEmbedding(content)
      console.log('[storeMemory] Embedding generated:', embedding.length, 'dimensions')
    } catch (embError) {
      console.warn('[storeMemory] Failed to generate embedding:', embError)
      // Continue without embedding - fallback to keyword search
    }

    // Create new memory entry
    const memory = {
      id: Date.now().toString(),
      content: content,
      tags: tags ? (Array.isArray(tags) ? tags : [tags]) : [],
      embedding: embedding, // Store embedding for semantic search
      timestamp: new Date().toISOString(),
      date: new Date().toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      })
    }

    // Add to memories array
    memories.push(memory)

    // Store back
    await chrome.storage.local.set({ agent_memories: memories })

    return {
      success: true,
      result: `Memory stored successfully (ID: ${memory.id}). Total memories: ${memories.length}${embedding ? ' [with embedding]' : ' [keyword only]'}`,
      memoryId: memory.id,
      hasEmbedding: !!embedding
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'storeMemory',
  description: 'Stores user information in persistent memory ONLY when the user EXPLICITLY instructs you to remember or save something (e.g. "remember that...", "save this to memory"). NEVER call this tool for names, single words, or unrequested facts.',
  parameters: [
    {
      name: 'content',
      type: 'string',
      description: 'The explicit fact or preference to remember (must be a full sentence, e.g. "User prefers Hindi language", "User work email is jane@corp.com")',
      required: true
    },
    {
      name: 'tags',
      type: 'string | string[]',
      description: 'Optional tags to categorize the memory (e.g., ["preferences", "email"], "user-info")',
      required: false
    }
  ],
  examples: [
    'User: "Remember that my preferred language is Hindi" → storeMemory with content: "User prefers Hindi language", tags: ["preferences", "language"]',
    'User: "Please save my work email: jane@corp.com" → storeMemory with content: "User work email is jane@corp.com", tags: ["contact"]'
  ],
  spokenLine: 'Storing that in memory'
}

export default storeMemory
