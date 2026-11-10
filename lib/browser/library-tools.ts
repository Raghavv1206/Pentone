import * as z from "zod"

import {
  activeTab,
  check,
  define,
  id,
  ids,
  limit,
  permission,
  poll,
  text,
  timeout,
  url
} from "./common"
import { tabDetails } from "./tab-tools"

const name = z.string().regex(/^[\p{L}\p{N} _-]{1,80}$/u)
const workspaceKey = (name: string) => `pentone.workspace.${name}`
const savedTab = z
  .object({
    url,
    pinned: z.boolean(),
    group: z.number().int(),
    title: z.string().max(1000)
  })
  .strict()
const savedGroup = z
  .object({
    id: id,
    title: z.string().max(1000),
    color: z.enum([
      "grey",
      "blue",
      "red",
      "yellow",
      "green",
      "pink",
      "purple",
      "cyan",
      "orange"
    ]),
    collapsed: z.boolean()
  })
  .strict()
const workspace = z
  .object({
    version: z.literal(1),
    tabs: z.array(savedTab).min(1).max(100),
    groups: z.array(savedGroup).max(100)
  })
  .strict()
const bookmarkIds = z.array(z.string().regex(/^\d+$/)).min(1).max(100)

export const libraryTools = [
  define(
    "listWindows",
    "windows",
    "List browser windows and their tabs.",
    z.object({}).strict(),
    async () =>
      (
        await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] })
      ).map((w) => ({
        id: w.id,
        focused: w.focused,
        state: w.state,
        incognito: w.incognito,
        tabs: w.tabs?.map(tabDetails)
      }))
  ),
  define(
    "createWindow",
    "windows",
    "Create a browser window with explicit HTTP(S) URLs.",
    z.object({ urls: z.array(url).min(1).max(25) }).strict(),
    async (p) => chrome.windows.create({ url: p.urls })
  ),
  define(
    "switchWindow",
    "windows",
    "Focus an existing browser window.",
    z.object({ windowId: id }).strict(),
    async (p) => chrome.windows.update(p.windowId, { focused: true })
  ),
  define(
    "moveTabsToWindow",
    "windows",
    "Move explicit tab IDs into an existing window.",
    z
      .object({
        tabIds: ids,
        windowId: id,
        index: z.number().int().min(-1).default(-1)
      })
      .strict(),
    async (p) => {
      const target = await chrome.windows.get(p.windowId)
      const tabs = await Promise.all(
        p.tabIds.map((id: number) => chrome.tabs.get(id))
      )
      if (tabs.some((t) => !!t.incognito !== !!target.incognito))
        throw new Error("Cannot mix private and normal windows")
      return chrome.tabs.move(p.tabIds, {
        windowId: p.windowId,
        index: p.index
      })
    }
  ),
  define(
    "mergeWindows",
    "windows",
    "Move tabs from explicit source windows into a target window.",
    z.object({ sourceWindowIds: ids, targetWindowId: id }).strict(),
    async (p, e) => {
      if (p.sourceWindowIds.includes(p.targetWindowId))
        throw new Error("Target cannot also be a source")
      const target = await chrome.windows.get(p.targetWindowId)
      const windows = await Promise.all(
        p.sourceWindowIds.map((id: number) =>
          chrome.windows.get(id, { populate: true })
        )
      )
      if (
        windows.some(
          (w) => w.type !== "normal" || !!w.incognito !== !!target.incognito
        )
      )
        throw new Error("Choose compatible normal windows")
      const moved: number[] = []
      try {
        for (const w of windows) {
          check(e)
          const ids = w.tabs!.map((t) => t.id!)
          await chrome.tabs.move(ids, { windowId: p.targetWindowId, index: -1 })
          moved.push(...ids)
        }
      } catch (error) {
        throw new Error(
          `Partially merged: ${JSON.stringify(moved)}. ${String(error)}`
        )
      }
      return { moved }
    }
  ),
  define(
    "saveWorkspace",
    "windows",
    "Save a named window workspace locally: HTTP(S) URLs, order, pins and available groups. Excludes form state and private tabs.",
    z.object({ name, windowId: id.optional() }).strict(),
    async (p) => {
      const tabs = await chrome.tabs.query(
        p.windowId === undefined
          ? { currentWindow: true }
          : { windowId: p.windowId }
      )
      if (tabs.some((t) => t.incognito))
        throw new Error("Private windows cannot be saved")
      const key = workspaceKey(p.name)
      if ((await chrome.storage.local.get(key))[key])
        throw new Error("Workspace name already exists; choose a new name")
      const groups = (await chrome.permissions.contains({
        permissions: ["tabGroups"]
      }))
        ? await chrome.tabGroups.query({ windowId: tabs[0]?.windowId })
        : []
      const value = workspace.parse({
        version: 1,
        tabs: tabs
          .filter((t) => /^https?:/.test(t.url || ""))
          .sort((a, b) => a.index - b.index)
          .map((t) => ({
            url: t.url,
            pinned: !!t.pinned,
            group: t.groupId ?? -1,
            title: t.title || ""
          })),
        groups: groups.map((g) => ({
          id: g.id,
          title: g.title || "",
          color: g.color,
          collapsed: g.collapsed
        }))
      })
      await chrome.storage.local.set({ [key]: value })
      return {
        name: p.name,
        savedTabs: value.tabs.length,
        savedGroups: value.groups.length
      }
    }
  ),
  define(
    "listWorkspaces",
    "windows",
    "List saved local workspace names.",
    z.object({}).strict(),
    async () =>
      Object.keys(await chrome.storage.local.get(null))
        .filter((k) => k.startsWith("pentone.workspace."))
        .map((k) => k.slice(18))
  ),
  define(
    "restoreWorkspace",
    "windows",
    "Restore a saved workspace into a new window.",
    z.object({ name }).strict(),
    async (p, e) => {
      const key = workspaceKey(p.name),
        saved = workspace.parse((await chrome.storage.local.get(key))[key])
      if (saved.groups.length) await permission("tabGroups")
      check(e)
      const w = await chrome.windows.create({
        url: saved.tabs[0].url,
        focused: true
      })
      const created = [w!.tabs![0].id!]
      try {
        await chrome.tabs.update(created[0], { pinned: saved.tabs[0].pinned })
        for (const tab of saved.tabs.slice(1)) {
          check(e)
          const t = await chrome.tabs.create({
            windowId: w!.id,
            url: tab.url,
            pinned: tab.pinned,
            active: false
          })
          created.push(t.id!)
        }
        for (const group of saved.groups) {
          check(e)
          const tabIds = saved.tabs.flatMap((t, i) =>
            t.group === group.id && !t.pinned ? [created[i]] : []
          )
          if (tabIds.length) {
            const gid = await chrome.tabs.group({
              tabIds: tabIds as [number, ...number[]]
            })
            await chrome.tabGroups.update(gid, {
              title: group.title,
              color: group.color,
              collapsed: group.collapsed
            })
          }
        }
      } catch (error) {
        throw new Error(
          `Partially restored in window ${w!.id}; created tabs ${created.join(", ")}. ${String(error)}`
        )
      }
      return { windowId: w!.id, tabIds: created }
    }
  ),
  define(
    "searchBookmarks",
    "bookmarks",
    "Search bookmarks by text.",
    z.object({ query: text }).strict(),
    async (p) => {
      await permission("bookmarks")
      return (await chrome.bookmarks.search(p.query)).slice(0, 100)
    }
  ),
  define(
    "listBookmarkFolders",
    "bookmarks",
    "List bookmark folder IDs for creating or organizing bookmarks and reading lists.",
    z.object({}).strict(),
    async () => {
      await permission("bookmarks")
      const queue = [...(await chrome.bookmarks.getTree())]
      const folders: { id: string; title: string; parentId?: string }[] = []
      while (queue.length && folders.length < 100) {
        const node = queue.shift()!
        if (!node.url) {
          folders.push({
            id: node.id,
            title: node.title,
            parentId: node.parentId
          })
          queue.push(...(node.children || []).filter((child) => !child.url))
        }
      }
      return { folders, truncated: queue.length > 0 }
    }
  ),
  define(
    "createBookmarkFolder",
    "bookmarks",
    "Create a bookmark folder under an explicit parent ID.",
    z.object({ title: text, parentId: z.string().regex(/^\d+$/) }).strict(),
    async (p) => {
      await permission("bookmarks")
      return chrome.bookmarks.create(p)
    }
  ),
  define(
    "bookmarkTabs",
    "bookmarks",
    "Bookmark explicit tab IDs in a folder; also supports a local reading-list folder.",
    z.object({ tabIds: ids, parentId: z.string().regex(/^\d+$/) }).strict(),
    async (p, e) => {
      await permission("bookmarks")
      const tabs = await Promise.all(
        p.tabIds.map((id: number) => chrome.tabs.get(id))
      )
      tabs.forEach((t) => {
        url.parse(t.url)
        if (t.incognito)
          throw new Error("Private tabs cannot be bookmarked by this tool")
      })
      const created: unknown[] = []
      try {
        for (const t of tabs) {
          check(e)
          created.push(
            await chrome.bookmarks.create({
              parentId: p.parentId,
              title: t.title,
              url: t.url
            })
          )
        }
      } catch (error) {
        throw new Error(
          `Partially bookmarked: ${JSON.stringify(created)}. ${String(error)}`
        )
      }
      return created
    }
  ),
  define(
    "moveBookmarks",
    "bookmarks",
    "Move explicit bookmarks into a folder.",
    z.object({ bookmarkIds, parentId: z.string().regex(/^\d+$/) }).strict(),
    async (p, e) => {
      await permission("bookmarks")
      const moved: unknown[] = []
      try {
        for (const id of p.bookmarkIds) {
          check(e)
          moved.push(await chrome.bookmarks.move(id, { parentId: p.parentId }))
        }
      } catch (error) {
        throw new Error(
          `Partially moved: ${JSON.stringify(moved)}. ${String(error)}`
        )
      }
      return moved
    }
  ),
  define(
    "removeBookmarks",
    "bookmarks",
    "Remove explicit bookmark leaves after a user confirmation. Folders are never recursively deleted.",
    z.object({ bookmarkIds }).strict(),
    async (p, e) => {
      await permission("bookmarks")
      const nodes = await chrome.bookmarks.get(p.bookmarkIds)
      if (nodes.some((n) => !n.url))
        throw new Error("Only bookmark leaves can be removed")
      const removed: string[] = []
      try {
        for (const node of nodes) {
          check(e)
          await chrome.bookmarks.remove(node.id)
          removed.push(node.id)
        }
      } catch (error) {
        throw new Error(
          `Partially removed: ${removed.join(", ")}. ${String(error)}`
        )
      }
      return { removed }
    }
  ),
  ...["listDownloads", "findDownload"].map((name) =>
    define(
      name,
      "downloads",
      "List downloads and their state, optionally matching search terms.",
      z.object({ query: z.array(text).max(10).optional(), limit }).strict(),
      async (p) => {
        await permission("downloads")
        return chrome.downloads.search({
          query: p.query,
          limit: p.limit,
          orderBy: ["-startTime"]
        })
      }
    )
  ),
  define(
    "downloadLink",
    "downloads",
    "Download an HTTP(S) link using Chrome. Opens the Save As picker.",
    z.object({ url }).strict(),
    async (p) => {
      await permission("downloads")
      return {
        downloadId: await chrome.downloads.download({
          url: p.url,
          saveAs: true
        })
      }
    }
  ),
  ...(["pause", "resume", "cancel", "show"] as const).map((action) =>
    define(
      action === "show" ? "showDownloadInFolder" : `${action}Download`,
      "downloads",
      `${action === "show" ? "Show" : action} one explicit download. Cancellation does not delete a local file or history.`,
      z.object({ downloadId: id }).strict(),
      async (p) => {
        await permission("downloads")
        if (!(await chrome.downloads.search({ id: p.downloadId })).length)
          throw new Error("Download not found")
        await chrome.downloads[action](p.downloadId)
        return {
          downloadId: p.downloadId,
          action,
          state: await chrome.downloads.search({ id: p.downloadId })
        }
      }
    )
  ),
  define(
    "waitForDownload",
    "downloads",
    "Wait for an explicit download to complete, up to 60 seconds.",
    z.object({ downloadId: id, timeoutMs: timeout }).strict(),
    async (p, e) => {
      await permission("downloads")
      return poll(
        async () => {
          const [d] = await chrome.downloads.search({ id: p.downloadId })
          if (!d || d.state === "interrupted")
            throw new Error(d?.error || "Download unavailable")
          return d
        },
        (d) => d.state === "complete",
        p.timeoutMs,
        e
      )
    }
  ),
  define(
    "searchHistory",
    "history",
    "Search Chrome history within explicit millisecond timestamps.",
    z
      .object({
        query: z.string().max(1000),
        startTime: z.number().nonnegative(),
        endTime: z.number().nonnegative(),
        limit
      })
      .strict()
      .refine((p) => p.endTime >= p.startTime),
    async (p) => {
      await permission("history")
      return chrome.history.search({
        text: p.query,
        startTime: p.startTime,
        endTime: p.endTime,
        maxResults: p.limit
      })
    }
  ),
  define(
    "openHistoryResult",
    "history",
    "Open an HTTP(S) history URL returned by searchHistory.",
    z.object({ url }).strict(),
    async (p) => {
      await permission("history")
      if (!(await chrome.history.getVisits({ url: p.url })).length)
        throw new Error("URL is not in history")
      return chrome.tabs.create({ url: p.url })
    }
  ),
  define(
    "listRecentlyClosed",
    "history",
    "List recently closed tabs and windows with session IDs.",
    z.object({ limit: z.number().int().min(1).max(25).default(10) }).strict(),
    async (p) => {
      await permission("sessions")
      return chrome.sessions.getRecentlyClosed({ maxResults: p.limit })
    }
  ),
  define(
    "deleteHistoryUrl",
    "history",
    "Delete ALL history visits for one exact URL after user confirmation. Chrome does not support deleting one individual visit.",
    z.object({ url }).strict(),
    async (p) => {
      await permission("history")
      await chrome.history.deleteUrl({ url: p.url })
      return {
        url: p.url,
        remainingVisits: (await chrome.history.getVisits({ url: p.url })).length
      }
    }
  ),
  ...["waitForUrl", "waitForNavigation"].map((name) =>
    define(
      name,
      "monitoring",
      "Wait for an exact URL on one tab; requires a complete load for navigation.",
      z.object({ tabId: id.optional(), url, timeoutMs: timeout }).strict(),
      async (p, e) => {
        const tab = await activeTab(p.tabId)
        return poll(
          () => chrome.tabs.get(tab.id!),
          (t) =>
            t.url === p.url &&
            (name !== "waitForNavigation" || t.status === "complete"),
          p.timeoutMs,
          e
        )
      }
    )
  ),
  define(
    "inspectFrames",
    "page",
    "List frame IDs and URLs available for a tab. Page tools accept an explicit frameId subject to Chrome permissions.",
    z.object({ tabId: id.optional() }).strict(),
    async (p) =>
      chrome.webNavigation.getAllFrames({
        tabId: (await activeTab(p.tabId)).id!
      })
  )
]
