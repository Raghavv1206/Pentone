import * as z from "zod"

import {
  activeTab,
  check,
  define,
  id,
  limit,
  poll,
  text,
  timeout,
  type Execution
} from "./common"

export const target = z
  .object({
    selector: text.optional(),
    role: text.optional(),
    name: text.optional()
  })
  .strict()
  .refine(
    (p) => p.selector || p.role || p.name,
    "Specify a selector, role or accessible name"
  )
const scope = { tabId: id.optional(), frameId: id.default(0) }
const targeted = { ...scope, target }

export async function pageSession(p: any, execution: Execution) {
  const tab = await activeTab(execution.page?.tabId ?? p.tabId)
  if (!/^https?:/.test(tab.url || ""))
    throw new Error("Chrome protects this page from extension interaction")
  check(execution)
  const loaded = await chrome.scripting.executeScript({
    target: { tabId: tab.id!, frameIds: [p.frameId ?? 0] },
    files: ["pentone-page-agent.js"],
    world: "ISOLATED"
  })
  const documentId = loaded[0]?.documentId
  if (execution.page && execution.page.documentId !== documentId)
    throw new Error("The reviewed document changed; inspect the target again")
  if (!documentId)
    throw new Error(
      "Cannot bind to a live document. Reload the page and try again."
    )
  const invoke = async (action: string, args: any = p) => {
    check(execution)
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id!, documentIds: [documentId] },
      world: "ISOLATED",
      func: async (action, args) => {
        try {
          const run = (globalThis as any).__pentonePageAgent
          if (typeof run !== "function")
            throw new Error("Page agent unavailable")
          return { ok: true, value: await run(action, args) }
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          }
        }
      },
      args: [action, args]
    })
    check(execution)
    if (!results[0]?.result?.ok)
      throw new Error(
        results[0]?.result?.error || "Target document changed or is unavailable"
      )
    return results[0].result.value
  }
  return Object.assign(invoke, { documentId, tabId: tab.id! })
}

const schemas: Record<string, z.ZodType> = {
  clickByRole: z.object(targeted).strict(),
  hoverElement: z.object(targeted).strict(),
  scrollToElement: z
    .object({
      ...targeted,
      align: z.enum(["start", "center", "end", "nearest"]).default("center")
    })
    .strict(),
  scrollContainer: z
    .object({
      ...targeted,
      x: z.number().min(-10000).max(10000).default(0),
      y: z.number().min(-10000).max(10000).default(500)
    })
    .strict(),
  setCheckbox: z.object({ ...targeted, checked: z.boolean() }).strict(),
  selectRadioOption: z.object(targeted).strict(),
  fillFormFields: z
    .object({
      ...scope,
      fields: z
        .array(z.object({ target, value: z.string().max(20000) }).strict())
        .min(1)
        .max(30)
    })
    .strict(),
  clearFormFields: z
    .object({ ...scope, targets: z.array(target).min(1).max(30) })
    .strict(),
  inspectFormErrors: z.object(scope).strict(),
  selectDate: z
    .object({ ...targeted, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
    .strict(),
  setRangeValue: z.object({ ...targeted, value: z.number().finite() }).strict(),
  replaceFieldText: z
    .object({ ...targeted, find: text, replacement: z.string().max(20000) })
    .strict(),
  readPageText: z.object({ ...scope, target: target.optional() }).strict(),
  readSelection: z.object(scope).strict(),
  extractTable: z.object({ ...targeted, limit }).strict(),
  collectLinks: z
    .object({ ...scope, selector: text.optional(), limit })
    .strict(),
  extractStructuredData: z.object(scope).strict(),
  findTextOnPage: z.object({ ...scope, text, limit }).strict(),
  readElementDetails: z.object(targeted).strict(),
  collectSearchResults: z
    .object({ ...scope, selector: text.optional(), limit })
    .strict(),
  selectCaptions: z.object({ ...targeted, language: text }).strict(),
  selectPlaybackQuality: z.object({ ...targeted, value: text }).strict(),
  extractAvailableTranscript: z
    .object({ ...scope, target: target.optional() })
    .strict(),
  inspectDialog: z.object(scope).strict(),
  chooseDialogAction: z.object({ ...targeted, dialog: target }).strict(),
  rejectOptionalCookies: z.object(scope).strict(),
  dismissNotificationPrompt: z.object(scope).strict()
}
const descriptions: Record<string, string> = {
  clickByRole:
    "Click one visible enabled element by exact accessible name, role or CSS selector. Verify resulting state separately.",
  hoverElement:
    "Dispatch hover events to one visible element. Some sites require a physical pointer.",
  scrollToElement: "Scroll one visible target into view.",
  scrollContainer: "Scroll an explicit container by bounded pixel offsets.",
  setCheckbox: "Set an explicit checkbox or switch state and verify it.",
  selectRadioOption: "Select and verify one radio option.",
  fillFormFields:
    "Fill explicit fields using native setters or text-only editable content. Never submits a form; excludes password and file fields.",
  clearFormFields: "Clear explicitly selected writable fields.",
  inspectFormErrors:
    "Read visible native validation errors and accessible alerts.",
  selectDate: "Set a native date input with YYYY-MM-DD.",
  setRangeValue:
    "Set and verify a native range slider respecting min, max and step.",
  replaceFieldText: "Replace literal text in one writable field.",
  readPageText: "Read bounded visible page text with its source URL.",
  readSelection: "Read the current text selection and source.",
  extractTable: "Extract an HTML table with spans and safely escaped CSV.",
  collectLinks:
    "Collect visible HTTP(S) links with their source, excluding unsafe URL schemes.",
  extractStructuredData: "Read bounded JSON-LD as untrusted data.",
  findTextOnPage: "Find visible literal text matches.",
  readElementDetails: "Inspect an element role, name, text and state.",
  collectSearchResults:
    "Collect visible search heading links or an explicitly inspected result selector.",
  selectCaptions:
    "Choose a loaded native caption track by language or label, or off.",
  selectPlaybackQuality:
    "Select an actual quality option in a native select. For custom players inspect and click their menus.",
  extractAvailableTranscript:
    "Read loaded caption cues or an explicitly selected transcript panel; never fabricates unavailable transcripts.",
  inspectDialog: "Inspect visible dialogs and available actions.",
  chooseDialogAction:
    "Click one explicitly named action within one visible dialog. Preserve the user choice.",
  rejectOptionalCookies:
    "Click a unique explicit rejection control in a visible cookie dialog.",
  dismissNotificationPrompt:
    "Dismiss a supported in-page notification dialog. Native browser prompts need direct interaction."
}
function category(name: string) {
  return name === "collectSearchResults"
    ? "research"
    : /Checkbox|Radio|Form|Date|Range|Field/.test(name)
      ? "forms"
      : /Captions|Playback|Transcript/.test(name)
        ? "media"
        : /Dialog|Cookies|Notification/.test(name)
          ? "dialogs"
          : /read|extract|collect|findText/.test(name)
            ? "reading"
            : "page"
}
export const pageTools = [
  ...Object.entries(schemas).map(([name, schema]) =>
    define(name, category(name), descriptions[name], schema, async (p, e) =>
      (await pageSession(p, e))(name)
    )
  ),
  ...["waitForElement", "clickWhenReady", "waitForElementState"].map((name) =>
    define(
      name,
      "monitoring",
      "Wait for an exact element state in the original document, bounded to 60 seconds and cancellable.",
      z
        .object({
          ...targeted,
          state: z
            .enum(["visible", "hidden", "enabled", "disabled"])
            .default("enabled"),
          timeoutMs: timeout
        })
        .strict(),
      async (p, e) => {
        const run = await pageSession(p, e)
        const result = await poll(
          () => run("probe"),
          (value) => {
            if (value.count > 1)
              throw new Error("Ambiguous target; specify a unique element")
            return name === "clickWhenReady"
              ? value.count === 1 && value.enabled
              : p.state === "hidden"
                ? value.count === 0
                : value.count === 1 &&
                  (p.state === "visible" ||
                    (p.state === "enabled" ? value.enabled : !value.enabled))
          },
          p.timeoutMs,
          e
        )
        check(e)
        return name === "clickWhenReady" ? run("clickWhenReady") : result
      }
    )
  ),
  define(
    "waitForText",
    "monitoring",
    "Wait for literal text in a uniquely selected element, in the original document.",
    z.object({ ...targeted, text, timeoutMs: timeout }).strict(),
    async (p, e) => {
      const run = await pageSession(p, e)
      return poll(
        () => run("probe"),
        (v) => {
          if (v.count > 1) throw new Error("Ambiguous target")
          return v.count === 1 && v.text.includes(p.text)
        },
        p.timeoutMs,
        e
      )
    }
  ),
  ...["clickSkipButton", "waitAndSkipAd"].map((name) =>
    define(
      name,
      "media",
      "Click one enabled skip control and verify it disappears. Wait at most 60 seconds; never bypass an unavailable skip.",
      z.object({ ...scope, timeoutMs: timeout }).strict(),
      async (p, e) => {
        const run = await pageSession(p, e)
        if (name === "waitAndSkipAd")
          await poll(
            () => run("skipProbe"),
            (v) => {
              if (v.count > 1) throw new Error("Multiple skip controls")
              return v.count === 1
            },
            p.timeoutMs,
            e
          )
        check(e)
        const dispatched = await run("clickSkipButton")
        await poll(
          () => run("skipProbe"),
          (v) => v.count === 0,
          Math.min(p.timeoutMs, 5000),
          e
        )
        return {
          ...dispatched,
          verified: "Skip control is no longer available"
        }
      }
    )
  )
]
