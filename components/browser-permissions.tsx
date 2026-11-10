import React, { useEffect, useRef, useState } from "react"

import { getRecommendedSpeechLocale } from "../lib/voice-selector"
import { prepareLocalSpeech, SpeechSetupNotice } from '../lib/local-speech'

const permissions = [
  "tabGroups",
  "bookmarks",
  "downloads",
  "history",
  "sessions"
] as const
const labels = {
  tabGroups: "Tab groups",
  bookmarks: "Bookmarks",
  downloads: "Downloads",
  history: "Browsing history",
  sessions: "Recently closed tabs"
}
export function BrowserPermissions() {
  const [granted, setGranted] = useState<string[]>([])
  const [status, setStatus] = useState("")
  const [installing, setInstalling] = useState(false)
  const [retryLocale, setRetryLocale] = useState<string | undefined>()
  const setupRef = useRef<AbortController | null>(null)
  const refresh = async () => {
    const result = await Promise.all(
      permissions.map(async (p) =>
        (await chrome.permissions.contains({ permissions: [p] })) ? p : null
      )
    )
    setGranted(
      result.filter((p): p is (typeof permissions)[number] => p !== null)
    )
  }
  useEffect(() => {
    refresh().catch(() => setStatus("Permission settings are unavailable."))
    return () => setupRef.current?.abort()
  }, [])
  return (
    <section aria-label="Additional browser tools" style={{ padding: 16 }}>
      <h3>Additional browser tools</h3>
      <p>
        Enable access for the tools you use. AI processing stays on your device.
      </p>
      {permissions.map((permission) => (
        <label key={permission} style={{ display: "block", marginTop: 8 }}>
          <input
            type="checkbox"
            checked={granted.includes(permission)}
            onChange={async (event) => {
              try {
                if (event.target.checked)
                  await chrome.permissions.request({
                    permissions: [permission]
                  })
                else
                  await chrome.permissions.remove({ permissions: [permission] })
                await refresh()
              } catch (error) {
                setStatus(String(error))
              }
            }}
          />{" "}
          {labels[permission]}
        </label>
      ))}
      <p>Speech uses installed local language packs and local voices only.</p>
      <button
        type="button"
        onClick={async () => {
          if (setupRef.current) { setupRef.current.abort(); setupRef.current = null; setInstalling(false); setStatus('Microphone setup cancelled.'); return }
          const setup = new AbortController()
          setupRef.current = setup
          setInstalling(true)
          try {
            const api =
              (window as any).SpeechRecognition ||
              (window as any).webkitSpeechRecognition
            const locale = await prepareLocalSpeech(api, getRecommendedSpeechLocale(), {
              signal: setup.signal,
              onStatus: setStatus,
              installLocale: retryLocale
            })
            if (!setup.signal.aborted) { setStatus(`On-device speech is ready (${locale}).`); setRetryLocale(undefined) }
          } catch (error) {
            if (!setup.signal.aborted) {
              setStatus(error instanceof Error ? error.message : 'Speech setup could not finish.')
              setRetryLocale(error instanceof SpeechSetupNotice ? error.installLocale : undefined)
            }
          } finally {
            if (setupRef.current === setup) { setupRef.current = null; setInstalling(false) }
          }
        }}>
        {installing ? 'Cancel microphone setup' : 'Set up local speech'}
      </button>
      <p role="status">{status}</p>
    </section>
  )
}
