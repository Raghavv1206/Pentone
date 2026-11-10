/** Native on-device speech setup shared by the microphone, Settings and onboarding. */
type Availability = "available" | "downloadable" | "downloading" | "unavailable"
export interface LocalSpeechAPI {
  available?: (options: {
    langs: string[]
    processLocally: true
  }) => Promise<Availability>
  install?: (options: {
    langs: string[]
    processLocally: true
  }) => Promise<boolean>
}
export interface SpeechSetupOptions {
  signal?: AbortSignal
  onStatus?: (message: string) => void
  /** A previously inspected locale, retried directly from a fresh user gesture. */
  installLocale?: string
}
export class SpeechSetupNotice extends Error {
  constructor(
    message: string,
    public readonly installLocale?: string
  ) {
    super(message)
    this.name = "SpeechSetupNotice"
  }
}

export function localSpeechLocales(preferred: string): string[] {
  // Keep the language the user speaks. A missing regional English pack must
  // not disable an installed English recognizer or switch to another language.
  const canonical = (
    Intl as typeof Intl & { getCanonicalLocales(locale: string): string[] }
  ).getCanonicalLocales(preferred)[0]
  return [
    ...new Set([
      canonical,
      ...(canonical.split("-")[0] === "en" ? ["en-US", "en-GB"] : [])
    ])
  ]
}

function waitFor<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs: number
): Promise<T> {
  return new Promise((resolve, reject) => {
    const finish = (fn: (value: any) => void, value: any) => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      fn(value)
    }
    const abort = () =>
      finish(reject, new DOMException("Speech setup cancelled", "AbortError"))
    const timer = setTimeout(
      () =>
        finish(
          reject,
          new SpeechSetupNotice(
            "Speech setup is taking longer than expected. Check your connection and try the microphone again."
          )
        ),
      timeoutMs
    )
    signal?.addEventListener("abort", abort, { once: true })
    operation.then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error)
    )
    if (signal?.aborted) abort()
  })
}

function pause(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(new DOMException("Speech setup cancelled", "AbortError"))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort)
      resolve()
    }, 500)
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) abort()
  })
}

const installations = new WeakMap<
  LocalSpeechAPI,
  Map<string, Promise<boolean>>
>()
function install(api: LocalSpeechAPI, locale: string) {
  if (!api.install)
    throw new SpeechSetupNotice(
      "This browser cannot install local speech packs. Update Chrome to use the microphone; text commands remain available."
    )
  let jobs = installations.get(api)
  if (!jobs) {
    jobs = new Map()
    installations.set(api, jobs)
  }
  const pending = jobs.get(locale)
  if (pending) return pending
  // Call immediately: Chrome may require a fresh user activation for install.
  const job = api.install({ langs: [locale], processLocally: true })
  jobs.set(locale, job)
  job.then(
    () => jobs!.delete(locale),
    () => jobs!.delete(locale)
  )
  return job
}

export async function prepareLocalSpeech(
  api: LocalSpeechAPI,
  preferred: string,
  options: SpeechSetupOptions = {}
): Promise<string> {
  const { signal, onStatus } = options
  signal?.throwIfAborted()
  if (typeof api?.available !== "function")
    throw new SpeechSetupNotice(
      "This browser does not support on-device speech recognition. Update Chrome to use the microphone; text commands remain available."
    )
  const locales = localSpeechLocales(preferred)
  const inspect = (locale: string) => {
    signal?.throwIfAborted()
    return waitFor(
      api.available!({ langs: [locale], processLocally: true }),
      signal,
      15000
    )
  }
  let chosen = options.installLocale
  if (chosen && !locales.includes(chosen))
    throw new SpeechSetupNotice(
      "The selected speech language changed. Tap the microphone to check it again."
    )
  try {
    if (!chosen) {
      onStatus?.("Checking on-device speech…")
      const candidates: { locale: string; status: Availability }[] = []
      for (const locale of locales) {
        const status = await inspect(locale)
        signal?.throwIfAborted()
        if (status === "available") return locale
        if (status === "downloadable" || status === "downloading")
          candidates.push({ locale, status })
      }
      // Finish an existing download before starting another dialect's pack.
      const candidate =
        candidates.find((c) => c.status === "downloading") || candidates[0]
      if (!candidate)
        throw new SpeechSetupNotice(
          "Chrome has no supported on-device speech pack for this language. Update Chrome and try again; text commands remain available."
        )
      chosen = candidate.locale
      if (candidate.status === "downloading") {
        onStatus?.(
          "Chrome is downloading local speech. You can cancel microphone setup while it finishes."
        )
      } else {
        onStatus?.(
          "Downloading local speech for first use. Recognition stays on this device."
        )
        if (!(await waitFor(install(api, chosen), signal, 300000)))
          throw new SpeechSetupNotice(
            "Chrome could not finish speech setup. Check your connection, then select Set up microphone to retry.",
            chosen
          )
      }
    } else {
      onStatus?.(
        "Downloading local speech for first use. Recognition stays on this device."
      )
      if (!(await waitFor(install(api, chosen), signal, 300000)))
        throw new SpeechSetupNotice(
          "Chrome could not finish speech setup. Check your connection, then select Set up microphone to retry.",
          chosen
        )
    }
    // Installation success alone does not mean the recognizer is ready yet.
    const deadline = Date.now() + 120000
    while (true) {
      const status = await inspect(chosen)
      signal?.throwIfAborted()
      if (status === "available") return chosen
      if (status !== "downloading" || Date.now() >= deadline)
        throw new SpeechSetupNotice(
          "The local speech pack is not ready yet. Select Set up microphone to retry.",
          chosen
        )
      onStatus?.("Finishing local speech setup…")
      await pause(signal)
    }
  } catch (error) {
    if (signal?.aborted) signal.throwIfAborted()
    if (error instanceof SpeechSetupNotice) throw error
    const denied =
      error !== null &&
      typeof error === "object" &&
      "name" in error &&
      ["NotAllowedError", "SecurityError"].includes(String(error.name))
    throw new SpeechSetupNotice(
      denied
        ? "Chrome needs a fresh click to set up local speech. Select Set up microphone to continue."
        : "Chrome could not prepare local speech. Check your connection and try again.",
      chosen
    )
  }
}
