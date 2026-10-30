// Message domain objects
export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  contextCount?: number
  rating?: 'up' | 'down' | null
  visualOnly?: boolean // If true, message is displayed in UI but not sent to AI
  isInternal?: boolean // If true, message is an internal system state/tool/summary event
  messageType?: 'chat' | 'tool_result' | 'summary' | 'status' | 'error'
}

export function createUserMessage(content: string): Message {
  return {
    id: Date.now() + '_user',
    role: 'user',
    content,
    timestamp: Date.now(),
    messageType: 'chat'
  }
}

export function createAssistantMessage(content: string, contextCount?: number, isInternal = false): Message {
  return {
    id: Date.now() + '_assistant',
    role: 'assistant',
    content: content.trim(),
    timestamp: Date.now(),
    contextCount,
    isInternal,
    messageType: isInternal ? 'status' : 'chat'
  }
}

export function createInternalMessage(
  content: string, 
  messageType: 'tool_result' | 'summary' | 'status' | 'error' = 'status',
  contextCount?: number
): Message {
  return {
    id: Date.now() + '_' + messageType,
    role: 'assistant',
    content: content.trim(),
    timestamp: Date.now(),
    contextCount,
    isInternal: true,
    messageType
  }
}
