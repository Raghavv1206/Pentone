/**
 * Core Tool Type Definitions
 * Pure type definitions to prevent circular imports between tools and tool-registry.
 */

export interface ToolParameter {
  name: string
  type: string
  description: string
  required: boolean
}

export interface ToolSpec {
  name: string
  description: string
  parameters: ToolParameter[]
  examples: string[]
  spokenLine: string  // Spoken text for TTS during execution
  requiresUserGesture?: boolean  // True if tool requires direct user interaction
}
