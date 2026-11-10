import { expect, test, vi } from "vitest"

import {
  localSpeechLocales,
  prepareLocalSpeech,
  SpeechSetupNotice
} from "../lib/local-speech"

test("locales preserve language and prefer the requested dialect", () => {
  expect(localSpeechLocales("en-IN")).toEqual(["en-IN", "en-US", "en-GB"])
  expect(localSpeechLocales("en-US")).toEqual(["en-US", "en-GB"])
  expect(localSpeechLocales("hi-IN")).toEqual(["hi-IN"])
})

test("an installed local English dialect works when the preferred dialect is missing", async () => {
  const api = {
    available: vi.fn(async ({ langs }) =>
      langs[0] === "en-US" ? ("available" as const) : ("unavailable" as const)
    ),
    install: vi.fn()
  }
  expect(await prepareLocalSpeech(api, "en-IN")).toBe("en-US")
  expect(api.install).not.toHaveBeenCalled()
  expect(
    api.available.mock.calls.every(
      ([options]) => options.processLocally === true
    )
  ).toBe(true)
})

test("uses an installed dialect before downloading another one", async () => {
  const api = {
    available: vi.fn(async ({ langs }) =>
      langs[0] === "en-US" ? ("available" as const) : ("downloadable" as const)
    ),
    install: vi.fn()
  }
  expect(await prepareLocalSpeech(api, "en-IN")).toBe("en-US")
  expect(api.install).not.toHaveBeenCalled()
})

test("first-use setup downloads one pack, reports progress and verifies readiness", async () => {
  let installed = false
  const status = vi.fn()
  const api = {
    available: vi.fn(async () =>
      installed ? ("available" as const) : ("downloadable" as const)
    ),
    install: vi.fn(async () => {
      installed = true
      return true
    })
  }
  expect(await prepareLocalSpeech(api, "en-IN", { onStatus: status })).toBe(
    "en-IN"
  )
  expect(api.install).toHaveBeenCalledExactlyOnceWith({
    langs: ["en-IN"],
    processLocally: true
  })
  expect(status).toHaveBeenCalledWith(expect.stringContaining("Downloading"))
  expect(api.available).toHaveBeenLastCalledWith({
    langs: ["en-IN"],
    processLocally: true
  })
})

test("an in-progress browser download is awaited without a duplicate install", async () => {
  vi.useFakeTimers()
  let finished = false
  const api = {
    available: vi.fn(async () =>
      finished ? ("available" as const) : ("downloading" as const)
    ),
    install: vi.fn()
  }
  const pending = prepareLocalSpeech(api, "en-IN")
  await vi.advanceTimersByTimeAsync(500)
  finished = true
  await vi.advanceTimersByTimeAsync(500)
  expect(await pending).toBe("en-IN")
  expect(api.install).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

test("failed setup produces an actionable notice and does not claim readiness", async () => {
  const api = {
    available: vi.fn(async () => "downloadable" as const),
    install: vi.fn(async () => false)
  }
  await expect(prepareLocalSpeech(api, "en-IN")).rejects.toMatchObject({
    name: "SpeechSetupNotice",
    installLocale: "en-IN"
  })
})

test("a fresh-click retry calls install before awaiting availability", async () => {
  const sequence: string[] = []
  const api = {
    available: vi.fn(async () => {
      sequence.push("available")
      return "available" as const
    }),
    install: vi.fn(async () => {
      sequence.push("install")
      return true
    })
  }
  expect(
    await prepareLocalSpeech(api, "en-IN", { installLocale: "en-IN" })
  ).toBe("en-IN")
  expect(sequence).toEqual(["install", "available"])
})

test("permission-policy rejection produces a setup notice instead of an online fallback", async () => {
  const api = {
    available: vi.fn(async () => "downloadable" as const),
    install: vi.fn(async () => {
      throw new DOMException("User activation required", "NotAllowedError")
    })
  }
  await expect(prepareLocalSpeech(api, "en-IN")).rejects.toMatchObject({
    name: "SpeechSetupNotice",
    installLocale: "en-IN",
    message: expect.stringContaining("fresh click")
  })
})

test("cancellation clears polling timers and stops later readiness checks", async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const api = { available: vi.fn(async () => "downloading" as const) }
  const pending = prepareLocalSpeech(api, "en-IN", {
    signal: controller.signal
  }).catch((e) => e)
  await vi.advanceTimersByTimeAsync(100)
  controller.abort()
  expect((await pending).name).toBe("AbortError")
  const count = api.available.mock.calls.length
  await vi.advanceTimersByTimeAsync(2000)
  expect(api.available).toHaveBeenCalledTimes(count)
  expect(vi.getTimerCount()).toBe(0)
})

test("unsupported local speech is described honestly without enabling online recognition", async () => {
  await expect(prepareLocalSpeech({}, "en-IN")).rejects.toBeInstanceOf(
    SpeechSetupNotice
  )
  const api = {
    available: vi.fn(async () => "unavailable" as const),
    install: vi.fn()
  }
  await expect(prepareLocalSpeech(api, "en-IN")).rejects.toBeInstanceOf(
    SpeechSetupNotice
  )
  expect(api.install).not.toHaveBeenCalled()
})

test("simultaneous setup requests share one native installation", async () => {
  let complete: (v: boolean) => void = () => {}
  let installed = false
  const api = {
    available: vi.fn(async () =>
      installed ? ("available" as const) : ("downloadable" as const)
    ),
    install: vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          complete = resolve
        })
    )
  }
  const a = prepareLocalSpeech(api, "en-IN"),
    b = prepareLocalSpeech(api, "en-IN")
  await vi.waitFor(() => expect(api.install).toHaveBeenCalledTimes(1))
  installed = true
  complete(true)
  expect(await Promise.all([a, b])).toEqual(["en-IN", "en-IN"])
})
