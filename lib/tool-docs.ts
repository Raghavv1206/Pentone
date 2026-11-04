// Tool documentation utilities (separated to avoid circular dependencies)

// Tool call format syntax (shared across system prompt and playbooks)
export const TOOL_FORMAT = `Format: <function_call>{"function": "toolName", "arguments": {...}}</function_call>`

// Generate compact formatted tool documentation for specific tools
export function generateToolDocumentation(toolRegistry: any[], toolNames?: string[]): string {
  const tools = toolNames 
    ? toolRegistry.filter(tool => toolNames.includes(tool.name))
    : toolRegistry

  return tools.map(tool => {
    const params = tool.parameters && tool.parameters.length > 0
      ? tool.parameters.map((p: any) => `${p.name}${p.required ? '' : '?'}: ${p.type}`).join(', ')
      : ''
    return `- \`${tool.name}(${params})\`: ${tool.description}`
  }).join('\n')
}
