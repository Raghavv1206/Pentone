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
    /\b(?:close|shut|kill|band|cerrar|cierra|fermer|schließen|schließe|chiudi|fechar|fecha|закрыть|закрой|閉じて|閉じる|关闭|أغلق|اغلق)\b/i.test(text) &&
    /\b(?:tabs?|left|right|pestañas?|onglets?|schede|abas?|вкладки|タブ|标签页|التبويبات|टैब)\b/i.test(text)
  )
}

export function isExactCloseAll(text: string) {
  const norm = normalizeCommand(text)
  return /^(?:close|shut|kill) (?:all (?:the |my |open |of my )?tabs?|every tab)$/i.test(norm)
    || /^(?:sare|sab|sari)\s+tabs?\s+band\s+(?:karo|kar\s*do)$/i.test(norm)
    || /^(?:cerrar|cierra)\s+todas\s+las\s+pestañas$/i.test(norm)
    || /^fermer\s+tous\s+les\s+onglets$/i.test(norm)
    || /^(?:schließe\s+alle\s+tabs|alle\s+tabs\s+schließen)$/i.test(norm)
    || /^chiudi\s+tutte\s+le\s+schede$/i.test(norm)
    || /^(?:fechar|fecha)\s+todas\s+as\s+abas$/i.test(norm)
    || /^(?:закрыть|закрой)\s+все\s+вкладки$/i.test(norm)
    || /^すべてのタブを閉じて?$/i.test(norm)
    || /^关闭所有标签页$/i.test(norm)
    || /^(?:أغلق|اغلق)\s+(?:كل|جميع)\s+(?:التبويبات|علامات\s+التبويب)$/i.test(norm)
    || /^(?:सारे|सभी)\s+टैब\s+बंद\s+(?:करो|कर\s*दो)$/i.test(norm)
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
