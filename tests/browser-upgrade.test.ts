import fc from "fast-check"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { browserTools } from "../lib/browser"
import { scopedTabCommand, tabScopeError } from "../lib/browser/command-scope"
import { boundedInput } from "../lib/browser/common"
import {
  cancelBrowserRun,
  finishBrowserRun,
  runBrowserTool
} from "../lib/browser/execution"
import { relativeSelection, resolveReference } from "../lib/browser/tab-tools"
import { detectIntents } from "../lib/intent-detector"
import { matchVoiceIntent } from "../lib/voice-intent-matcher"
import { chromeMock, data, seed, setTabs, tabs } from "./setup"

const tool = (name: string, args: any = {}, execution: any = {}) =>
  browserTools
    .find((t) => t.spec.name === name)!
    .run(args, undefined, execution)
const layout = () =>
  ["Mail", "Docs", "YouTube", "GitHub"].map((title, i) => ({
    id: i + 1,
    index: i,
    windowId: 1,
    title,
    url: `https://${title.toLowerCase()}.com`,
    active: i === 2
  }))

describe("real user sentence to exact tab targets", () => {
  test.each([
    ["close all tabs to the left of YouTube", [3, 4]],
    ["close all tabs to the right of YouTube", [1, 2, 3]],
    ["close all tabs except YouTube", [3]],
    ["please close tabs left of YouTube.", [3, 4]]
  ])("%s preserves the correct tabs", async (request, remaining) => {
    setTabs([
      ...layout(),
      {
        id: 50,
        index: 0,
        windowId: 2,
        title: "Other window",
        url: "https://other.com"
      }
    ])
    const intents = detectIntents(request)
    expect(intents).toHaveLength(1)
    const call = intents[0].toolCall
    expect(call.function).not.toBe("closeTab")
    const runId = crypto.randomUUID()
    const result = await runBrowserTool(
      call.function,
      call.arguments,
      runId,
      request
    )
    expect(result.success, result.error).toBe(true)
    expect(tabs.map((t) => t.id)).toEqual([...remaining, 50])
    finishBrowserRun(runId)
  })
  test.each([
    "do not close all tabs",
    "don't close all tabs",
    "close all tabs except",
    "close all tabs unless they are pinned",
    "close all tabs and open mail",
    "close all tabs before YouTube"
  ])("qualified or negative request never becomes close all: %s", (request) => {
    expect(
      detectIntents(request).some(
        (t) => t.toolCall.function === "closeTab" && t.toolCall.arguments.all
      )
    ).toBe(false)
    expect(matchVoiceIntent(request)?.toolCall.arguments.all).not.toBe(true)
    expect(
      tabScopeError(request, { function: "closeTab", arguments: { all: true } })
    ).toBeTruthy()
  })
  test("voice preserves the same scope; plain close-all remains supported", () => {
    expect(
      matchVoiceIntent("close all tabs to the left of YouTube")?.toolCall
    ).toEqual(scopedTabCommand("close all tabs to the left of YouTube"))
    expect(detectIntents("close all tabs")[0].toolCall).toEqual({
      function: "closeTab",
      arguments: { all: true }
    })
  })
  test("missing, ambiguous and mismatched ID references close nothing", async () => {
    setTabs([...layout(), { ...layout()[2], id: 8, index: 4 }])
    for (const p of [
      { reference: "YouTube" },
      { reference: "missing" },
      { reference: "YouTube", referenceId: 1 }
    ])
      expect((await tool("closeTabsToLeft", p)).success).toBe(false)
    expect(chromeMock.tabs.remove).not.toHaveBeenCalled()
    expect(
      (await tool("closeTabsToLeft", { reference: "YouTube", referenceId: 3 }))
        .success
    ).toBe(true)
  })
  test("reordering during resolution causes a safe failure", async () => {
    setTabs(layout())
    chromeMock.tabs.query
      .mockResolvedValueOnce(layout())
      .mockResolvedValueOnce(
        [...layout()].reverse().map((t, index) => ({ ...t, index }))
      )
    expect(
      (await tool("closeTabsToLeft", { reference: "YouTube" })).success
    ).toBe(false)
    expect(chromeMock.tabs.remove).not.toHaveBeenCalled()
  })
  test("2000 generated layouts preserve anchors, windows and direction", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.nat(),
        fc.constantFrom("left", "right", "except"),
        (count, position, direction) => {
          const anchor = position % count
          const candidates = Array.from({ length: count }, (_, index) => ({
            id: index + 1,
            index,
            windowId: 1,
            title: `Tab ${index}`,
            url: `https://example.com/${index}`
          })) as chrome.tabs.Tab[]
          const extra = { ...candidates[0], id: 1000, windowId: 2 }
          const selected = relativeSelection(
            [...candidates, extra],
            candidates[anchor],
            direction as any
          )
          expect(
            selected.every(
              (t) => t.id !== candidates[anchor].id && t.windowId === 1
            )
          ).toBe(true)
          expect(selected.map((t) => t.index)).toEqual(
            candidates
              .filter((t) =>
                direction === "except"
                  ? t.index !== anchor
                  : direction === "left"
                    ? t.index < anchor
                    : t.index > anchor
              )
              .map((t) => t.index)
          )
        }
      ),
      { numRuns: 2000 }
    )
  })
  test("duplicates keep the active copy and only compare exact URLs", async () => {
    setTabs([
      { ...layout()[0], url: "https://example.com/a#one" },
      { ...layout()[1], url: "https://example.com/a#one", active: true },
      { ...layout()[2], url: "https://example.com/a#two" }
    ])
    expect((await tool("closeDuplicateTabs")).data).toEqual({
      closed: [1],
      count: 1
    })
  })
  test("domain selection cannot match a suffix attack or another window", async () => {
    setTabs([
      { ...layout()[0], url: "https://example.com" },
      { ...layout()[1], url: "https://evil-example.com" },
      { ...layout()[2], url: "https://sub.example.com" }
    ])
    expect((await tool("selectTabs", { domain: "example.com" })).data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 1 }),
        expect.objectContaining({ id: 3 })
      ])
    )
    expect(
      (await tool("selectTabs", { domain: "example.com" })).data
    ).toHaveLength(2)
  })
})

describe("page interaction and extraction", () => {
  test("accessible labels, disabled states, ambiguity and open shadow DOM", async () => {
    document.body.innerHTML =
      '<button aria-label="Continue">Next</button><button disabled>Disabled</button><div id="host"></div>'
    const click = vi.fn()
    document.querySelector("button")!.addEventListener("click", click)
    expect(
      (
        await tool("clickByRole", {
          target: { role: "button", name: "Continue" }
        })
      ).success
    ).toBe(true)
    expect(click).toHaveBeenCalledTimes(1)
    expect(
      (await tool("clickByRole", { target: { name: "Disabled" } })).success
    ).toBe(false)
    expect(
      (await tool("clickByRole", { target: { role: "button" } })).success
    ).toBe(false)
    document.querySelector("#host")!.attachShadow({ mode: "open" }).innerHTML =
      "<button>Shadow action</button>"
    expect(
      (await tool("readElementDetails", { target: { name: "Shadow action" } }))
        .data
    ).toMatchObject({ name: "Shadow action", role: "button" })
  })
  test("document binding prevents acting after navigation", async () => {
    document.body.innerHTML = "<button>Continue</button>"
    chromeMock.scripting.executeScript
      .mockResolvedValueOnce([{ documentId: "old" }])
      .mockResolvedValueOnce([])
    expect(
      (await tool("clickByRole", { target: { name: "Continue" } })).success
    ).toBe(false)
    expect(
      chromeMock.scripting.executeScript.mock.calls[1][0].target.documentIds
    ).toEqual(["old"])
  })
  test("forms retain values, never submit, and refuse password, file or read-only fields", async () => {
    document.body.innerHTML =
      '<form><label>Name<input id="name"></label><label>Agree<input type="checkbox" id="agree"></label><input type="radio" id="r" aria-label="Choice"><input type="password" id="secret"><input type="file" id="file"><input readonly id="locked"><input type="date" id="date"><input type="range" min="0" max="10" step="2" id="range"><div contenteditable="true" id="edit"></div></form>'
    const submit = vi.fn()
    document.querySelector("form")!.addEventListener("submit", submit)
    expect(
      (
        await tool("fillFormFields", {
          fields: [
            { target: { name: "Name" }, value: "Alice" },
            { target: { selector: "#edit" }, value: "<script>literal</script>" }
          ]
        })
      ).success
    ).toBe(true)
    expect(document.querySelector("#edit script")).toBeNull()
    expect(
      (await tool("setCheckbox", { target: { name: "Agree" }, checked: true }))
        .success
    ).toBe(true)
    expect(
      (await tool("selectRadioOption", { target: { name: "Choice" } })).success
    ).toBe(true)
    expect(
      (
        await tool("selectDate", {
          target: { selector: "#date" },
          date: "2026-11-10"
        })
      ).success
    ).toBe(true)
    expect(
      (
        await tool("setRangeValue", {
          target: { selector: "#range" },
          value: 3
        })
      ).success
    ).toBe(false)
    expect(
      (
        await tool("setRangeValue", {
          target: { selector: "#range" },
          value: 4
        })
      ).success
    ).toBe(true)
    for (const selector of ["#secret", "#file", "#locked"])
      expect(
        (
          await tool("fillFormFields", {
            fields: [{ target: { selector }, value: "blocked" }]
          })
        ).success
      ).toBe(false)
    expect(
      (
        await tool("replaceFieldText", {
          target: { selector: "#name" },
          find: "Ali",
          replacement: "A"
        })
      ).success
    ).toBe(true)
    expect((document.querySelector("#name") as HTMLInputElement).value).toBe(
      "Ace"
    )
    expect(
      (await tool("clearFormFields", { targets: [{ selector: "#name" }] }))
        .success
    ).toBe(true)
    expect(submit).not.toHaveBeenCalled()
  })
  test("tables preserve spans and escape CSV formulas and quotes", async () => {
    document.body.innerHTML =
      '<table><tr><td rowspan="2">=HYPERLINK("evil")</td><td>A,B</td></tr><tr><td>next</td></tr></table>'
    const result: any = await tool("extractTable", {
      target: { selector: "table" }
    })
    expect(result.success, result.error).toBe(true)
    expect(result.data.rows[1]).toEqual(['=HYPERLINK("evil")', "next"])
    expect(result.data.csv).toContain("'=HYPERLINK")
    expect(result.data.csv).toContain('"A,B"')
  })
  test("reading excludes hidden text and scripts; links reject unsafe schemes", async () => {
    document.body.innerHTML =
      '<p>Public article</p><p hidden>Hidden secret</p><script>Secret script</script><input type="password" value="secret"><a href="javascript:alert(1)">bad</a><h2><a href="https://example.com/a">Result</a></h2><a href="https://example.com/a">duplicate</a><script type="application/ld+json">{"name":"Product"}</script>'
    const read: any = await tool("readPageText")
    expect(read.data.text).toContain("Public article")
    expect(read.data.text).not.toMatch(/Hidden secret|Secret script|secret/)
    expect((await tool("collectLinks")).data).toMatchObject({
      results: [{ url: "https://example.com/a", title: "Result" }]
    })
    expect((await tool("collectSearchResults")).data).toMatchObject({
      results: [{ title: "Result" }]
    })
    expect((await tool("extractStructuredData")).data).toMatchObject({
      values: [{ name: "Product" }]
    })
    expect(
      (await tool("findTextOnPage", { text: "Public article" })).data
    ).toMatchObject({ matches: [{ text: "Public article" }] })
  })
  test("cookie rejection never falls back to accepting", async () => {
    document.body.innerHTML =
      '<div role="dialog">Cookies<button>Accept all</button></div>'
    const accept = vi.fn()
    document.querySelector("button")!.addEventListener("click", accept)
    expect((await tool("rejectOptionalCookies")).success).toBe(false)
    expect(accept).not.toHaveBeenCalled()
    const reject = document.createElement("button")
    reject.textContent = "Reject all"
    document.querySelector('[role="dialog"]')!.append(reject)
    const rejectClick = vi.fn()
    reject.addEventListener("click", rejectClick)
    expect((await tool("rejectOptionalCookies")).success).toBe(true)
    expect(rejectClick).toHaveBeenCalledTimes(1)
  })
  test("skip is only verified if the supported control disappears", async () => {
    document.body.innerHTML = "<button>Skip ad</button>"
    document
      .querySelector("button")!
      .addEventListener("click", (event) => (event.target as Element).remove())
    expect(
      (await tool("clickSkipButton", { timeoutMs: 0 })).data
    ).toMatchObject({ verified: "Skip control is no longer available" })
    expect((await tool("clickSkipButton", { timeoutMs: 0 })).success).toBe(
      false
    )
    document.body.innerHTML = "<button>Skip ad</button>"
    expect((await tool("clickSkipButton", { timeoutMs: 0 })).success).toBe(
      false
    )
  })
  test("stop during a wait prevents a later click and cleans timers", async () => {
    vi.useFakeTimers()
    const controller = new AbortController(),
      click = vi.fn()
    const result = tool(
      "clickWhenReady",
      { target: { name: "Delayed" }, timeoutMs: 10000 },
      { signal: controller.signal }
    )
    await vi.advanceTimersByTimeAsync(500)
    controller.abort()
    document.body.innerHTML = "<button>Delayed</button>"
    document.querySelector("button")!.addEventListener("click", click)
    expect((await result).success).toBe(false)
    await vi.advanceTimersByTimeAsync(10000)
    expect(click).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  test("wait succeeds when an element becomes ready and enforces timeout bounds", async () => {
    vi.useFakeTimers()
    const result = tool("waitForElement", {
      target: { name: "Ready" },
      timeoutMs: 1000
    })
    await vi.advanceTimersByTimeAsync(100)
    document.body.innerHTML = "<button>Ready</button>"
    await vi.advanceTimersByTimeAsync(250)
    expect((await result).success).toBe(true)
    expect(
      (
        await tool("waitForElement", {
          target: { name: "Ready" },
          timeoutMs: 1000000
        })
      ).success
    ).toBe(false)
  })
})

describe("permissions, confirmation and local workflows", () => {
  test("oversized, cyclic and deeply nested input is rejected before schema recursion", () => {
    const cycle: any = {}
    cycle.self = cycle
    expect(() => boundedInput(cycle)).toThrow("structure budget")
    expect(() => boundedInput({ values: Array(10001).fill(1) })).toThrow(
      "structure budget"
    )
    expect(() => boundedInput({ text: "a".repeat(100001) })).toThrow(
      "text budget"
    )
  })
  test("window tools preserve explicit IDs and reject private-window mixing", async () => {
    chromeMock.windows.getAll.mockResolvedValue([{ id: 1, tabs: layout() }])
    expect((await tool("listWindows")).data).toMatchObject([{ id: 1 }])
    chromeMock.windows.create.mockResolvedValue({ id: 2 })
    expect(
      (await tool("createWindow", { urls: ["https://example.com"] })).success
    ).toBe(true)
    chromeMock.windows.update.mockResolvedValue({ id: 2, focused: true })
    expect((await tool("switchWindow", { windowId: 2 })).success).toBe(true)
    chromeMock.windows.get.mockResolvedValue({
      id: 2,
      incognito: true,
      type: "normal"
    })
    expect(
      (await tool("moveTabsToWindow", { tabIds: [1], windowId: 2 })).success
    ).toBe(false)
    expect(chromeMock.tabs.move).not.toHaveBeenCalled()
    chromeMock.windows.get.mockResolvedValue({
      id: 2,
      incognito: false,
      type: "normal"
    })
    chromeMock.tabs.move.mockResolvedValue([{ id: 1, windowId: 2 }])
    expect(
      (await tool("moveTabsToWindow", { tabIds: [1], windowId: 2 })).success
    ).toBe(true)
    expect(chromeMock.tabs.move).toHaveBeenCalledWith([1], {
      windowId: 2,
      index: -1
    })
  })
  test("workspace restoration reconstructs tab order, pins and groups", async () => {
    chromeMock.permissions.contains.mockResolvedValue(true)
    seed({
      "pentone.workspace.Restore": {
        version: 1,
        tabs: [
          { url: "https://a.com", pinned: true, group: -1, title: "A" },
          { url: "https://b.com", pinned: false, group: 4, title: "B" },
          { url: "https://c.com", pinned: false, group: 4, title: "C" }
        ],
        groups: [{ id: 4, title: "Research", color: "blue", collapsed: false }]
      }
    })
    chromeMock.windows.create.mockResolvedValue({ id: 5, tabs: [{ id: 1 }] })
    chromeMock.tabs.create
      .mockResolvedValueOnce({ id: 2 })
      .mockResolvedValueOnce({ id: 3 })
    chromeMock.tabs.group.mockResolvedValue(44)
    chromeMock.tabGroups.update.mockResolvedValue({ id: 44 })
    expect((await tool("restoreWorkspace", { name: "Restore" })).data).toEqual({
      windowId: 5,
      tabIds: [1, 2, 3]
    })
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(1, { pinned: true })
    expect(chromeMock.tabs.group).toHaveBeenCalledWith({ tabIds: [2, 3] })
    expect(chromeMock.tabGroups.update).toHaveBeenCalledWith(44, {
      title: "Research",
      color: "blue",
      collapsed: false
    })
  })
  test("bookmark folder discovery and creation expose usable native IDs", async () => {
    chromeMock.permissions.contains.mockResolvedValue(true)
    chromeMock.bookmarks.getTree.mockResolvedValue([
      {
        id: "0",
        title: "",
        children: [
          {
            id: "1",
            title: "Bookmarks bar",
            children: [{ id: "2", title: "Link", url: "https://a.com" }]
          }
        ]
      }
    ])
    expect((await tool("listBookmarkFolders")).data).toMatchObject({
      folders: [{ id: "0" }, { id: "1" }]
    })
    chromeMock.bookmarks.create.mockResolvedValue({
      id: "3",
      title: "Reading list"
    })
    expect(
      (
        await tool("createBookmarkFolder", {
          title: "Reading list",
          parentId: "1"
        })
      ).success
    ).toBe(true)
    expect(chromeMock.bookmarks.create).toHaveBeenCalledWith({
      title: "Reading list",
      parentId: "1"
    })
  })
  test("research pagination preserves filters and stops at cross-site next links", async () => {
    document.body.innerHTML =
      '<a href="https://example.com/a">Result</a><a id="next" href="https://other.com/next">Next</a>'
    const result: any = await tool("collectPaginatedResults", {
      selector: "a:not(#next)",
      next: { selector: "#next" }
    })
    expect(result.success, result.error).toBe(true)
    expect(result.data.results).toHaveLength(1)
    expect(result.data.stopReason).toContain("changes site")
    expect(chromeMock.tabs.update).not.toHaveBeenCalled()
  })
  test("optional permission denial blocks access", async () => {
    for (const [name, args] of [
      ["searchBookmarks", { query: "work" }],
      ["listDownloads", {}],
      ["searchHistory", { query: "", startTime: 0, endTime: 1000 }],
      ["listRecentlyClosed", {}]
    ] as const) {
      expect((await tool(name, args)).error).toContain("Settings")
    }
    expect(chromeMock.bookmarks.search).not.toHaveBeenCalled()
    expect(chromeMock.history.search).not.toHaveBeenCalled()
  })
  test("history deletion binds confirmation to exact URL, run and current visits", async () => {
    chromeMock.permissions.contains.mockResolvedValue(true)
    chromeMock.history.getVisits.mockResolvedValue([{ id: "1", visitId: "v1" }])
    const runId = crypto.randomUUID(),
      args = { url: "https://example.com" },
      request = "Delete all history for example.com"
    const preview = await runBrowserTool(
      "deleteHistoryUrl",
      args,
      runId,
      request
    )
    expect(preview.requiresConfirmation).toBe(true)
    expect(chromeMock.history.deleteUrl).not.toHaveBeenCalled()
    expect(
      (
        await runBrowserTool(
          "deleteHistoryUrl",
          { url: "https://other.com" },
          runId,
          request,
          preview.confirmationId
        )
      ).success
    ).toBe(false)
    const fresh = await runBrowserTool("deleteHistoryUrl", args, runId, request)
    expect(
      (
        await runBrowserTool(
          "deleteHistoryUrl",
          args,
          runId,
          request,
          fresh.confirmationId
        )
      ).success
    ).toBe(true)
    expect(chromeMock.history.deleteUrl).toHaveBeenCalledExactlyOnceWith(args)
    expect(
      (
        await runBrowserTool(
          "deleteHistoryUrl",
          args,
          runId,
          request,
          fresh.confirmationId
        )
      ).success
    ).toBe(false)
    finishBrowserRun(runId)
  })
  test("bookmarks refuse recursive folder deletion and report partial failures", async () => {
    chromeMock.permissions.contains.mockResolvedValue(true)
    chromeMock.bookmarks.get.mockResolvedValue([{ id: "5", title: "Folder" }])
    expect(
      (await tool("removeBookmarks", { bookmarkIds: ["5"] })).success
    ).toBe(false)
    expect(chromeMock.bookmarks.remove).not.toHaveBeenCalled()
    chromeMock.bookmarks.get.mockResolvedValue([
      { id: "5", url: "https://a.com" },
      { id: "6", url: "https://b.com" }
    ])
    chromeMock.bookmarks.remove
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("API failure"))
    expect(
      (await tool("removeBookmarks", { bookmarkIds: ["5", "6"] })).error
    ).toContain("Partially removed: 5")
  })
  test("cancelled run cannot resume or use pending approval", async () => {
    const runId = crypto.randomUUID()
    cancelBrowserRun(runId)
    expect(
      (await runBrowserTool("selectTabs", {}, runId, "list tabs")).error
    ).toContain("stopped")
  })
  test("consequential page action requires a target-bound confirmation", async () => {
    document.body.innerHTML = "<button>Delete account</button>"
    const clicked = vi.fn()
    document.querySelector("button")!.addEventListener("click", clicked)
    const runId = crypto.randomUUID(),
      args = { target: { name: "Delete account" } },
      request = "Delete this account"
    const preview = await runBrowserTool("clickByRole", args, runId, request)
    expect(preview.requiresConfirmation).toBe(true)
    expect(clicked).not.toHaveBeenCalled()
    expect(
      (
        await runBrowserTool(
          "clickByRole",
          args,
          runId,
          request,
          preview.confirmationId
        )
      ).success
    ).toBe(true)
    expect(clicked).toHaveBeenCalledTimes(1)
    finishBrowserRun(runId)
  })
  test("download cancellation never removes files and checks the requested ID", async () => {
    chromeMock.permissions.contains.mockResolvedValue(true)
    expect((await tool("cancelDownload", { downloadId: 9 })).success).toBe(
      false
    )
    chromeMock.downloads.search.mockResolvedValue([
      { id: 9, state: "in_progress" }
    ])
    expect((await tool("cancelDownload", { downloadId: 9 })).success).toBe(true)
    expect(chromeMock.downloads.cancel).toHaveBeenCalledExactlyOnceWith(9)
    expect(
      (await tool("downloadLink", { url: "javascript:alert(1)" })).success
    ).toBe(false)
  })
  test("workspaces validate stored data, preserve pin/order and exclude private state", async () => {
    setTabs(layout().map((t, i) => ({ ...t, pinned: i === 0 })))
    expect((await tool("saveWorkspace", { name: "Work" })).success).toBe(true)
    const saved = data["pentone.workspace.Work"]
    expect(saved.tabs.map((t: any) => t.url)).toEqual(
      layout().map((t) => t.url)
    )
    expect(saved.tabs[0].pinned).toBe(true)
    expect((await tool("saveWorkspace", { name: "Work" })).success).toBe(false)
    seed({
      "pentone.workspace.Bad": {
        ...saved,
        tabs: [{ ...saved.tabs[0], url: "javascript:alert(1)" }]
      }
    })
    expect((await tool("restoreWorkspace", { name: "Bad" })).success).toBe(
      false
    )
    expect(chromeMock.windows.create).not.toHaveBeenCalled()
    setTabs([{ ...layout()[0], incognito: true }])
    expect((await tool("saveWorkspace", { name: "Private" })).success).toBe(
      false
    )
  })
  test("saved workflows reject recursion, fixed IDs, unknown args and missing parameters", async () => {
    expect(
      (
        await tool("saveWorkflow", {
          name: "Bad",
          steps: [{ tool: "runWorkflow", arguments: { name: "Bad" } }]
        })
      ).success
    ).toBe(false)
    expect(
      (
        await tool("saveWorkflow", {
          name: "Bad",
          steps: [{ tool: "pinTab", arguments: { tabId: 1 } }]
        })
      ).success
    ).toBe(false)
    expect(
      (
        await tool("saveWorkflow", {
          name: "Work",
          steps: [
            { tool: "pinTab", arguments: { tabId: "${tab}" } },
            { tool: "selectTabs", arguments: {} }
          ]
        })
      ).success
    ).toBe(true)
    expect((await tool("runWorkflow", { name: "Work" })).success).toBe(false)
    expect(
      (await tool("runWorkflow", { name: "Work", parameters: { tab: 1 } }))
        .success
    ).toBe(true)
    expect(tabs[0].pinned).toBe(true)
    expect((await tool("pinTab", { tabId: 1, confirmed: true })).success).toBe(
      false
    )
  })
})
