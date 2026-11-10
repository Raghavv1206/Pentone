import type { ToolCall } from "../tools"

// Destructive shortcuts must consume the entire request. A qualifier is never
// discarded to make a command fit a broader legacy tool.
export function normalizeCommand(text: string) {
  return text
    .trim()
    .replace(/^(?:please\s+|can you\s+|could you\s+)/i, "")
    .replace(/[.!?]+$/, "")
    .trim()
}

export function scopedTabCommand(text: string): ToolCall | null {
  const command = normalizeCommand(text)
  const relative = command.match(
    /^(?:close|shut) (?:all )?(?:the |my |open )?tabs? (?:(?:to|on) )?(?:the )?(left|right)(?: side)? of (.+)$/i
  )
  const except = command.match(
    /^(?:close|shut) (?:all |every )?(?:the |my |open )?tabs? (?:except|apart from|other than) (.+)$/i
  )
  const match = relative || except
  if (!match || /\b(?:and|then|but|unless)\b/i.test(match[match.length - 1]))
    return null
  const reference = match[match.length - 1].trim().replace(/^['"]|['"]$/g, "")
  if (!reference) return null
  return {
    function: relative
      ? relative[1].toLowerCase() === "left"
        ? "closeTabsToLeft"
        : "closeTabsToRight"
      : "closeTabsExcept",
    arguments: { reference }
  }
}

export function hasTabCloseIntent(text: string) {
  return (
    /\b(?:close|shut|kill)\b/i.test(text) &&
    /\b(?:tabs?|left|right)\b/i.test(text)
  )
}

export function isExactCloseAll(text: string) {
  return /^(?:close|shut|kill) (?:all (?:the |my |open |of my )?tabs?|every tab)$/i.test(
    normalizeCommand(text)
  )
}

export function tabScopeError(request: string, call: ToolCall): string | null {
  if (
    !/^(?:closeTab|closeTabsToLeft|closeTabsToRight|closeTabsExcept|closeDuplicateTabs)$/.test(
      call.function
    )
  )
    return null
  if (/\b(?:not|don't|don’t|never|without|unless)\b/i.test(request))
    return "This request contains a restriction. Clarify the exact tabs to close."
  const scoped = scopedTabCommand(request)
  if (
    scoped &&
    (call.function !== scoped.function ||
      call.arguments.reference !== scoped.arguments.reference)
  ) {
    return "Tab scope mismatch. Use the requested direction and reference tab exactly; do not close a broader set."
  }
  if (
    call.function === "closeTab" &&
    call.arguments.all &&
    !isExactCloseAll(request)
  )
    return "Closing all tabs requires an unqualified request to close all tabs."
  if (
    hasTabCloseIntent(request) &&
    /\b(?:left|right|except|apart|other than|keep|before|after)\b/i.test(
      request
    ) &&
    !scoped
  )
    return "Could not resolve the qualified tab request. Ask for the exact reference tab and scope."
  return null
}
