import * as z from "zod"

import { check, define, id, ids, permission, text } from "./common"

const windowScope = { windowId: id.optional() }
const relative = z
  .object({ reference: text, referenceId: id.optional(), ...windowScope })
  .strict()
export function resolveReference(
  tabs: chrome.tabs.Tab[],
  reference: string,
  referenceId?: number
) {
  const q = reference.trim().toLowerCase()
  const candidates = /^(?:current|this|active)(?: tab)?$/.test(q)
    ? tabs.filter((t) => t.active)
    : tabs.filter((t) => {
        let host = ""
        try {
          host = new URL(t.url || "").hostname.replace(/^www\./, "")
        } catch {}
        return (
          t.title?.toLowerCase().includes(q) ||
          host === q ||
          host === `${q}.com`
        )
      })
  const matches =
    referenceId === undefined
      ? candidates
      : candidates.filter((t) => t.id === referenceId)
  if (matches.length !== 1)
    throw new Error(
      matches.length
        ? `Ambiguous reference "${reference}". Choose a tab ID: ${JSON.stringify(matches.map(tabDetails))}`
        : `No tab matches "${reference}". No tabs were closed.`
    )
  return matches[0]
}
export function tabDetails(t: chrome.tabs.Tab) {
  return {
    id: t.id,
    windowId: t.windowId,
    index: t.index,
    title: t.title,
    url: t.url,
    active: t.active,
    pinned: t.pinned,
    audible: t.audible,
    groupId: t.groupId
  }
}
async function windowTabs(windowId?: number) {
  return (
    await chrome.tabs.query(
      windowId === undefined ? { currentWindow: true } : { windowId }
    )
  ).sort((a, b) => a.index - b.index)
}
export function relativeSelection(
  tabs: chrome.tabs.Tab[],
  reference: chrome.tabs.Tab,
  side: "left" | "right" | "except"
) {
  return tabs.filter(
    (t) =>
      t.windowId === reference.windowId &&
      t.id !== reference.id &&
      (side === "except" ||
        (side === "left"
          ? t.index < reference.index
          : t.index > reference.index))
  )
}
async function closeSelected(selected: chrome.tabs.Tab[], execution: any) {
  const closed: number[] = [],
    failed: { id: number; error: string }[] = []
  for (const tab of selected) {
    check(execution)
    try {
      await chrome.tabs.remove(tab.id!)
      closed.push(tab.id!)
    } catch (error) {
      failed.push({ id: tab.id!, error: String(error) })
    }
  }
  const live = new Set((await chrome.tabs.query({})).map((t) => t.id))
  const stillOpen = closed.filter((id) => live.has(id))
  if (failed.length || stillOpen.length)
    throw new Error(
      JSON.stringify({
        closed: closed.filter((id) => !live.has(id)),
        failed,
        stillOpen
      })
    )
  return { closed, count: closed.length }
}
export const tabTools = [
  define(
    "selectTabs",
    "tabs",
    "List structured tab IDs and details, filtered within one window.",
    z
      .object({
        ...windowScope,
        domain: text.optional(),
        query: text.optional(),
        audible: z.boolean().optional(),
        pinned: z.boolean().optional()
      })
      .strict(),
    async (p) => {
      const tabs = await windowTabs(p.windowId)
      return tabs
        .filter((t) => {
          let host = ""
          try {
            host = new URL(t.url || "").hostname
          } catch {}
          return (
            (!p.domain || host === p.domain || host.endsWith(`.${p.domain}`)) &&
            (!p.query ||
              `${t.title} ${t.url}`
                .toLowerCase()
                .includes(p.query.toLowerCase())) &&
            (p.audible === undefined || !!t.audible === p.audible) &&
            (p.pinned === undefined || !!t.pinned === p.pinned)
          )
        })
        .map(tabDetails)
    }
  ),
  ...(["left", "right", "except"] as const).map((side) =>
    define(
      side === "left"
        ? "closeTabsToLeft"
        : side === "right"
          ? "closeTabsToRight"
          : "closeTabsExcept",
      "tabs",
      `Close tabs ${side === "except" ? "except the reference" : `to the ${side} of the reference`} in one window. Preserve the reference; ambiguity fails without closing tabs.`,
      relative,
      async (p, execution) => {
        const tabs = await windowTabs(p.windowId)
        const ref = resolveReference(tabs, p.reference, p.referenceId)
        const selected = relativeSelection(tabs, ref, side)
        // Revalidate the complete order before destructive work; never expand a saved selection.
        const fresh = await windowTabs(ref.windowId)
        if (
          JSON.stringify(fresh.map((t) => [t.id, t.index, t.url])) !==
          JSON.stringify(tabs.map((t) => [t.id, t.index, t.url]))
        )
          throw new Error("Tabs changed. Select the reference again.")
        return {
          reference: tabDetails(ref),
          ...(await closeSelected(selected, execution))
        }
      }
    )
  ),
  define(
    "closeDuplicateTabs",
    "tabs",
    "Close exact duplicate URLs in one window, keeping an active or pinned copy when present.",
    z.object(windowScope).strict(),
    async (p, e) => {
      const groups = new Map<string, chrome.tabs.Tab[]>()
      for (const tab of await windowTabs(p.windowId))
        if (tab.url && /^https?:/.test(tab.url))
          groups.set(tab.url, [...(groups.get(tab.url) || []), tab])
      return closeSelected(
        [...groups.values()].flatMap((tabs) =>
          tabs
            .sort(
              (a, b) =>
                Number(!!b.active) - Number(!!a.active) ||
                Number(!!b.pinned) - Number(!!a.pinned)
            )
            .slice(1)
        ),
        e
      )
    }
  ),
  define(
    "duplicateTab",
    "tabs",
    "Duplicate a tab by its live ID.",
    z.object({ tabId: id }).strict(),
    async (p) => tabDetails(await chrome.tabs.duplicate(p.tabId))
  ),
  define(
    "moveTab",
    "tabs",
    "Move a tab to a zero-based index in its window.",
    z.object({ tabId: id, index: id }).strict(),
    async (p) => chrome.tabs.move(p.tabId, { index: p.index })
  ),
  ...[true, false].map((pinned) =>
    define(
      pinned ? "pinTab" : "unpinTab",
      "tabs",
      `${pinned ? "Pin" : "Unpin"} a tab by its live ID.`,
      z.object({ tabId: id }).strict(),
      async (p) => tabDetails(await chrome.tabs.update(p.tabId, { pinned }))
    )
  ),
  define(
    "groupTabs",
    "tabs",
    "Group explicit tab IDs in the same window.",
    z
      .object({
        tabIds: ids,
        title: text,
        color: z
          .enum([
            "grey",
            "blue",
            "red",
            "yellow",
            "green",
            "pink",
            "purple",
            "cyan",
            "orange"
          ])
          .default("blue")
      })
      .strict(),
    async (p, e) => {
      await permission("tabGroups")
      const tabs = await Promise.all(
        p.tabIds.map((id: number) => chrome.tabs.get(id))
      )
      if (
        new Set(tabs.map((t) => t.windowId)).size !== 1 ||
        tabs.some((t) => t.pinned)
      )
        throw new Error("Choose unpinned tabs from one window")
      check(e)
      const groupId = await chrome.tabs.group({ tabIds: p.tabIds })
      return chrome.tabGroups.update(groupId, {
        title: p.title,
        color: p.color
      })
    }
  ),
  define(
    "ungroupTabs",
    "tabs",
    "Ungroup explicit tab IDs.",
    z.object({ tabIds: ids }).strict(),
    async (p) => {
      await chrome.tabs.ungroup(p.tabIds)
      return { ungrouped: p.tabIds }
    }
  ),
  define(
    "restoreClosedTab",
    "history",
    "Restore an explicit recently closed session ID from listRecentlyClosed.",
    z.object({ sessionId: text }).strict(),
    async (p, e) => {
      await permission("sessions")
      check(e)
      return chrome.sessions.restore(p.sessionId)
    }
  )
]
