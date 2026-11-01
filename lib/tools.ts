// Tool execution module
import { parseToolCall, parseToolCallDetailed, validateToolCallSchema, type ToolCall } from './tool-parser'
import type { VoiceAuthorizationToken } from './audio/voice-authorization-types'

export type { ToolCall }
export { parseToolCall, parseToolCallDetailed, validateToolCallSchema }

export function detectInvalidToolFormat(content: string): string | null {
  // Only check for print() syntax - we'll handle code blocks in parseToolCall
  if (/print\s*\(/.test(content) && /get|click|fill|open/i.test(content)) {
    return 'Invalid format detected: print() syntax - must use <function_call> format'
  }
  return null
}

export async function executeTool(
  toolCall: ToolCall,
  token?: VoiceAuthorizationToken,
  confirmationApproved?: boolean,
  authContext?: { turnId?: number; userId?: string; sessionId?: string }
): Promise<any> {
  // Detect if we're in popup or sidepanel context
  const isPopup = typeof window !== 'undefined' && window.location?.pathname?.includes('popup.html')
  const context = isPopup ? 'popup' : 'sidepanel'
  
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: 'run_tool',
      payload: {
        toolName: toolCall.function,
        parameters: toolCall.arguments,
        context: context,
        token: token,
        confirmationApproved: confirmationApproved,
        turnId: authContext?.turnId,
        userId: authContext?.userId,
        sessionId: authContext?.sessionId
      }
    }, resolve)
  })
}
