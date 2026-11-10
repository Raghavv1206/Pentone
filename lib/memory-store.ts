export interface StoredMemory {
  id: string
  content: string
  tags: string[]
  timestamp: string
  date: string
  embedding?: number[]
}
let pending: Promise<unknown> = Promise.resolve()
export async function mutateMemories(update: (memories: StoredMemory[]) => StoredMemory[]): Promise<StoredMemory[]> {
  const commit = async () => {
    const stored = await chrome.storage.local.get('agent_memories')
    const next = update(Array.isArray(stored.agent_memories) ? stored.agent_memories : [])
    await chrome.storage.local.set({ agent_memories: next })
    return next
  }
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request('pentone-memories', commit)
  const result = pending.then(commit, commit)
  pending = result.catch(() => {})
  return result
}
