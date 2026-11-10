import { tabScopeError } from "./command-scope"
import {
  boundedInput,
  check,
  failure,
  permission,
  poll,
  type Execution
} from "./common"
import { browserTools } from "./index"
import { pageSession } from "./page-tools"

const runs = new Map<string, AbortController>()
const stopped = new Map<string, number>()
const pending = new Map<
  string,
  {
    runId: string
    tool: string
    args: any
    snapshot: string
    expires: number
    request: string
  }
>()
export function cancelBrowserRun(runId: string) {
  runs.get(runId)?.abort()
  runs.delete(runId)
  stopped.set(runId, Date.now())
  for (const [id, item] of pending) if (item.runId === runId) pending.delete(id)
  for (const [id, time] of stopped)
    if (time < Date.now() - 120000 || stopped.size > 100) stopped.delete(id)
}
async function snapshot(tool: string, args: any, execution: Execution) {
  if (tool === "removeBookmarks") {
    await permission("bookmarks")
    return JSON.stringify(await chrome.bookmarks.get(args.bookmarkIds))
  }
  if (tool === "deleteHistoryUrl") {
    await permission("history")
    return JSON.stringify({
      url: args.url,
      visits: await chrome.history.getVisits({ url: args.url })
    })
  }
  if (["clickByRole", "chooseDialogAction", "clickWhenReady"].includes(tool)) {
    const run = await pageSession(args, execution)
    if (tool === "clickWhenReady")
      await poll(
        () => run("probe", args),
        (v) => {
          if (v.count > 1) throw new Error("Ambiguous target")
          return v.count === 1 && v.enabled
        },
        args.timeoutMs,
        execution
      )
    const details = await run("readElementDetails", { target: args.target })
    execution.page = { tabId: run.tabId, documentId: run.documentId }
    if (
      /\b(?:pay|buy|purchase|order|send|delete|remove|publish|submit|confirm|accept|allow)\b/i.test(
        details.name
      )
    )
      return JSON.stringify({
        ...details,
        documentId: run.documentId,
        tabId: run.tabId
      })
  }
  return ""
}
export async function runBrowserTool(
  toolName: string,
  parameters: any,
  runId: string,
  request: string,
  confirmationId?: string
): Promise<any> {
  try {
    if (
      !/^[A-Za-z0-9_-]{1,100}$/.test(runId) ||
      !request ||
      request.length > 20000
    )
      throw new Error("Missing trusted user request or task ID")
    for (const [id, item] of pending)
      if (item.expires < Date.now()) pending.delete(id)
    if (stopped.has(runId)) throw new Error("Task was stopped")
    const tool = browserTools.find((t) => t.spec.name === toolName)
    if (!tool) throw new Error("Unknown browser tool")
    boundedInput(parameters)
    let args = tool.schema.parse(parameters)
    const scopeError = tabScopeError(request, {
      function: toolName,
      arguments: args
    })
    if (scopeError) throw new Error(scopeError)
    let controller = runs.get(runId)
    if (!controller) {
      if (runs.size >= 20) throw new Error("Too many active tasks")
      controller = new AbortController()
      runs.set(runId, controller)
    }
    const execution: Execution = { signal: controller.signal, request }
    const current = await snapshot(toolName, args, execution)
    if (current || confirmationId) {
      check(execution)
      if (!confirmationId) {
        if (pending.size >= 20)
          throw new Error("Too many pending confirmations")
        const token = crypto.randomUUID()
        pending.set(token, {
          runId,
          tool: toolName,
          args,
          snapshot: current,
          expires: Date.now() + 60000,
          request
        })
        const preview =
          toolName === "deleteHistoryUrl"
            ? `Delete all history visits for ${args.url}?`
            : toolName === "removeBookmarks"
              ? `Remove these bookmarks?\n${(JSON.parse(current) as any[]).map((n) => `${n.title}: ${n.url || "(folder — cannot delete)"}`).join("\n")}`
              : `Activate "${JSON.parse(current).name}" on ${JSON.parse(current).url}?\nReview the page content before confirming.`
        return {
          success: false,
          requiresConfirmation: true,
          confirmationId: token,
          preview
        }
      }
      const approved = pending.get(confirmationId)
      pending.delete(confirmationId)
      if (
        !approved ||
        approved.runId !== runId ||
        approved.tool !== toolName ||
        approved.request !== request ||
        approved.expires < Date.now() ||
        approved.snapshot !== current ||
        JSON.stringify(approved.args) !== JSON.stringify(args)
      )
        throw new Error(
          "Confirmation expired or targets changed. Review again."
        )
      args = approved.args
    }
    check(execution)
    return await tool.run(args, undefined, execution)
  } catch (error) {
    return failure(error)
  }
}
export function finishBrowserRun(runId: string) {
  cancelBrowserRun(runId)
}
