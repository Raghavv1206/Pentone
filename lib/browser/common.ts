import * as z from "zod"

import type { ToolSpec } from "../tool-registry"

export type Execution = {
  signal?: AbortSignal
  request?: string
  page?: { tabId: number; documentId: string }
}
export type Result = {
  success: boolean
  result?: string
  error?: string
  data?: unknown
}
export type BrowserTool = {
  spec: ToolSpec
  schema: z.ZodType
  category: string
  run: (args: any, context?: string, execution?: Execution) => Promise<Result>
}
export const id = z.number().int().nonnegative()
export const ids = z
  .array(id)
  .min(1)
  .max(100)
  .refine((v) => new Set(v).size === v.length, "IDs must be unique")
export const text = z.string().trim().min(1).max(1000)
export const url = z
  .string()
  .max(8192)
  .refine((v) => {
    try {
      const parsed = new URL(v)
      return (
        ["http:", "https:"].includes(parsed.protocol) &&
        !parsed.username &&
        !parsed.password
      )
    } catch {
      return false
    }
  }, "Only HTTP(S) URLs without embedded credentials are supported")
export const timeout = z.number().int().min(0).max(60000).default(10000)
export const limit = z.number().int().min(1).max(100).default(25)
export function check(execution?: Execution) {
  execution?.signal?.throwIfAborted()
}
export function boundedInput(value: unknown) {
  const queue: [unknown, number][] = [[value, 0]]
  let nodes = 0,
    characters = 0
  while (queue.length) {
    const [item, depth] = queue.pop()!
    if (++nodes > 10000 || depth > 20)
      throw new Error("Input exceeds the structure budget")
    if (typeof item === "string") characters += item.length
    else if (item && typeof item === "object") {
      const keys = Object.keys(item)
      if (keys.length + nodes + queue.length > 10000)
        throw new Error("Input exceeds the structure budget")
      for (const key of keys) {
        characters += key.length
        queue.push([(item as Record<string, unknown>)[key], depth + 1])
      }
    }
    if (characters > 100000) throw new Error("Input exceeds the text budget")
  }
}
export function success(data: unknown): Result {
  if (data === undefined) throw new Error("Tool returned no result")
  const encoded = typeof data === "string" ? data : JSON.stringify(data)
  if (encoded.length > 64000) {
    const bounded = {
      truncated: true,
      excerpt: encoded.slice(0, 64000),
      note: "Result exceeded the output budget; request a smaller selection."
    }
    return { success: true, result: JSON.stringify(bounded), data: bounded }
  }
  return { success: true, result: encoded, data }
}
export function failure(error: unknown): Result {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error)
  }
}
export function define(
  name: string,
  category: string,
  description: string,
  schema: z.ZodType,
  action: (args: any, execution: Execution) => Promise<unknown>
): BrowserTool {
  const json = z.toJSONSchema(schema) as any
  const spec: ToolSpec = {
    name,
    description,
    parameters: Object.entries(json.properties || {}).map(
      ([name, value]: [string, any]) => ({
        name,
        type: value.type === "array" ? "object" : value.type || "object",
        description: JSON.stringify(value),
        required:
          (json.required || []).includes(name) && value.default === undefined
      })
    ),
    examples: [
      `Use ${name} with the documented parameters; discover live IDs before acting.`
    ],
    spokenLine: description.split(".")[0]
  }
  return {
    spec,
    schema,
    category,
    async run(args = {}, _context, execution = {}) {
      try {
        check(execution)
        boundedInput(args)
        return success(await action(schema.parse(args), execution))
      } catch (error) {
        return failure(error)
      }
    }
  }
}
export async function permission(name: chrome.runtime.ManifestPermissions) {
  if (!(await chrome.permissions.contains({ permissions: [name] })))
    throw new Error(
      `Enable ${name} access in Pentone Settings before using this tool.`
    )
}
export async function activeTab(tabId?: number) {
  const tab =
    tabId === undefined
      ? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
      : await chrome.tabs.get(tabId)
  if (tab?.id === undefined) throw new Error("No target tab is available")
  return tab
}
export async function poll<T>(
  read: () => Promise<T>,
  ready: (v: T) => boolean,
  timeoutMs: number,
  execution: Execution = {}
): Promise<T> {
  const end = Date.now() + timeoutMs
  do {
    check(execution)
    const value = await read()
    check(execution)
    if (ready(value)) return value
    if (Date.now() >= end) break
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer)
        reject(new DOMException("Task stopped", "AbortError"))
      }
      const timer = setTimeout(
        () => {
          execution.signal?.removeEventListener("abort", abort)
          resolve()
        },
        Math.min(250, end - Date.now())
      )
      execution.signal?.addEventListener("abort", abort, { once: true })
    })
  } while (Date.now() <= end)
  throw new Error("Timed out waiting for the requested state")
}
