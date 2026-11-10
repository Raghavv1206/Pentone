import * as z from "zod"

import {
  activeTab,
  boundedInput,
  check,
  define,
  id,
  ids,
  limit,
  poll,
  text,
  url,
  type BrowserTool
} from "./common"
import { pageSession, target } from "./page-tools"

const workflowName = z.string().regex(/^[\p{L}\p{N} _-]{1,80}$/u)
const stepSchema = z
  .object({ tool: text, arguments: z.record(z.string().max(100), z.json()) })
  .strict()
const workflowSchema = z
  .object({ name: workflowName, steps: z.array(stepSchema).min(1).max(20) })
  .strict()
  .refine((v) => JSON.stringify(v).length <= 50000, "Workflow is too large")
// Saved workflows cannot hide consequential actions or invoke themselves.
const workflowAllowed = new Set([
  "selectTabs",
  "closeTabsToLeft",
  "closeTabsToRight",
  "closeTabsExcept",
  "closeDuplicateTabs",
  "pinTab",
  "unpinTab",
  "moveTab",
  "groupTabs",
  "ungroupTabs",
  "readPageText",
  "readSelection",
  "readElementDetails",
  "extractTable",
  "collectLinks",
  "collectSearchResults",
  "findTextOnPage",
  "waitForText",
  "waitForElement",
  "waitForUrl",
  "scrollToElement",
  "scrollContainer",
  "listDownloads",
  "findDownload"
])
export function interpolate(
  value: any,
  parameters: Record<string, unknown>
): any {
  if (typeof value === "string") {
    const match = value.match(/^\$\{([A-Za-z][A-Za-z0-9_]{0,50})\}$/)
    if (!match) return value
    if (!Object.hasOwn(parameters, match[1]))
      throw new Error(`Missing workflow parameter: ${match[1]}`)
    return parameters[match[1]]
  }
  if (Array.isArray(value)) return value.map((v) => interpolate(v, parameters))
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, interpolate(v, parameters)])
    )
  return value
}
function validateWorkflow(value: unknown) {
  boundedInput(value)
  const workflow = workflowSchema.parse(value)
  for (const step of workflow.steps) {
    if (!workflowAllowed.has(step.tool))
      throw new Error(`${step.tool} is not supported in saved workflows`)
    for (const [key, value] of Object.entries(step.arguments))
      if (
        /Ids?$/.test(key) &&
        !(
          typeof value === "string" &&
          /^\$\{[A-Za-z][A-Za-z0-9_]*\}$/.test(value)
        )
      )
        throw new Error(
          "Supply live IDs as workflow parameters instead of saving stale IDs"
        )
  }
  return workflow
}
export function workflowTools(catalog: () => BrowserTool[]): BrowserTool[] {
  return [
    define(
      "getBrowserTools",
      "discovery",
      "Discover additional tool schemas by category: tabs, windows, page, forms, reading, research, media, dialogs, bookmarks, downloads, history, monitoring, workflows.",
      z.object({ category: text }).strict(),
      async (p) => {
        const tools = catalog().filter((t) => t.category === p.category)
        if (!tools.length) throw new Error("Unknown category")
        return tools.map((t) => ({
          name: t.spec.name,
          description: t.spec.description,
          parameters: z.toJSONSchema(t.schema)
        }))
      }
    ),
    define(
      "saveWorkflow",
      "workflows",
      "Save a bounded local tool workflow. Use ${parameter} as a whole argument value; pass fresh tab IDs at run time. Existing names are preserved.",
      workflowSchema,
      async (p) => {
        validateWorkflow(p)
        const key = `pentone.workflow.${p.name}`
        if ((await chrome.storage.local.get(key))[key])
          throw new Error("Workflow name already exists")
        await chrome.storage.local.set({ [key]: p })
        return { name: p.name, steps: p.steps.length }
      }
    ),
    define(
      "listWorkflows",
      "workflows",
      "List saved local workflow definitions for review.",
      z.object({}).strict(),
      async () =>
        Object.entries(await chrome.storage.local.get(null))
          .filter(([k]) => k.startsWith("pentone.workflow."))
          .map(([, v]) => validateWorkflow(v))
    ),
    define(
      "runWorkflow",
      "workflows",
      "Run a saved local workflow with fresh parameters, stopping on cancellation or the first failure.",
      z
        .object({
          name: workflowName,
          parameters: z
            .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,50}$/), z.json())
            .default({})
        })
        .strict(),
      async (p, e) => {
        const workflow = validateWorkflow(
          (await chrome.storage.local.get(`pentone.workflow.${p.name}`))[
            `pentone.workflow.${p.name}`
          ]
        )
        const steps = workflow.steps.map((step) => {
          const tool = catalog().find((t) => t.spec.name === step.tool)!
          return {
            tool,
            arguments: tool.schema.parse(
              interpolate(step.arguments, p.parameters)
            )
          }
        })
        const completed: unknown[] = []
        for (const step of steps) {
          check(e)
          const result = await step.tool.run(step.arguments, undefined, e)
          if (!result.success)
            throw new Error(
              JSON.stringify({
                completed,
                failedTool: step.tool.spec.name,
                error: result.error
              })
            )
          completed.push({ tool: step.tool.spec.name, result: result.data })
        }
        return { completed }
      }
    ),
    define(
      "openResults",
      "research",
      "Open up to ten explicitly selected HTTP(S) search result URLs.",
      z.object({ urls: z.array(url).min(1).max(10) }).strict(),
      async (p, e) => {
        const opened: unknown[] = []
        try {
          for (const url of [...new Set<string>(p.urls)]) {
            check(e)
            const tab = await chrome.tabs.create({ url, active: false })
            opened.push({ id: tab.id, url })
          }
        } catch (error) {
          throw new Error(
            `Partially opened: ${JSON.stringify(opened)}. ${String(error)}`
          )
        }
        return { opened }
      }
    ),
    define(
      "compareOpenPages",
      "research",
      "Collect bounded text and sources from up to five explicit tabs for comparison using the existing on-device AI.",
      z.object({ tabIds: ids.refine((v) => v.length <= 5) }).strict(),
      async (p, e) => {
        const pages: unknown[] = []
        for (const tabId of p.tabIds) {
          check(e)
          const run = await pageSession({ tabId }, e)
          pages.push(await run("readPageText", {}))
        }
        return {
          pages,
          instruction:
            "Compare only the collected evidence with the on-device model; cite URLs and state missing facts."
        }
      }
    ),
    define(
      "collectPaginatedResults",
      "research",
      "Collect links from at most five pages using an explicitly inspected next-page link. Preserve origin, path and filters; stops on repeated pages.",
      z
        .object({
          tabId: id.optional(),
          selector: text.optional(),
          next: target,
          maxPages: z.number().int().min(1).max(5).default(3),
          limit,
          paginationKeys: z
            .array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/))
            .max(5)
            .default(["page", "p", "start", "offset", "cursor"])
        })
        .strict(),
      async (p, e) => {
        const tab = await activeTab(p.tabId),
          initial = new URL(tab.url!),
          visited = new Set<string>(),
          results = new Map<string, unknown>(),
          sources: string[] = []
        const filters = (u: URL) =>
          [...u.searchParams]
            .filter(([k]) => !p.paginationKeys.includes(k))
            .sort(([a], [b]) => a.localeCompare(b))
        let stopReason = "Page limit reached"
        for (let i = 0; i < p.maxPages && results.size < p.limit; i++) {
          check(e)
          const current = await chrome.tabs.get(tab.id!)
          if (visited.has(current.url!)) {
            stopReason = "Repeated page"
            break
          }
          visited.add(current.url!)
          sources.push(current.url!)
          const run = await pageSession({ tabId: tab.id }, e)
          const page = await run("collectLinks", {
            selector: p.selector,
            limit: p.limit
          })
          for (const result of page.results)
            if (results.size < p.limit) results.set(result.url, result)
          if (i + 1 === p.maxPages || results.size >= p.limit) break
          let next: any
          try {
            next = await run("readElementDetails", { target: p.next })
          } catch {
            stopReason = "Next link unavailable"
            break
          }
          if (!next.href) {
            stopReason = "Next control is not a supported link"
            break
          }
          const destination = new URL(next.href)
          if (
            destination.origin !== initial.origin ||
            destination.pathname !== initial.pathname ||
            JSON.stringify(filters(destination)) !==
              JSON.stringify(filters(initial))
          ) {
            stopReason = "Next link changes site, path or filters"
            break
          }
          if (visited.has(destination.href)) {
            stopReason = "Repeated next link"
            break
          }
          check(e)
          await chrome.tabs.update(tab.id!, { url: destination.href })
          await poll(
            () => chrome.tabs.get(tab.id!),
            (t) => t.status === "complete" && t.url === destination.href,
            15000,
            e
          )
        }
        return { results: [...results.values()], sources, stopReason }
      }
    )
  ]
}
