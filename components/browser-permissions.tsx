import React, { useEffect, useState } from "react"

import { getRecommendedSpeechLocale } from "../lib/voice-selector"

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
          try {
            const api =
              (window as any).SpeechRecognition ||
              (window as any).webkitSpeechRecognition
            if (!api?.install)
              throw new Error(
                "This browser does not support local speech pack installation."
              )
            setStatus(
              "Installing a speech pack. This setup step downloads model files."
            )
            const installed = await api.install({
              langs: [getRecommendedSpeechLocale()]
            })
            setStatus(
              installed
                ? "Local speech pack installed."
                : "Speech pack installation did not complete."
            )
          } catch (error) {
            setStatus(String(error))
          }
        }}>
        Install local speech pack
      </button>
      <p role="status">{status}</p>
    </section>
  )
}
