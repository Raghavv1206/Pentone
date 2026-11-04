import React, { useEffect } from "react"

const Popup = () => {
  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.tabs && chrome.sidePanel?.open) {
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const tabId = tabs[0]?.id
        if (tabId) {
          try {
            await chrome.sidePanel.open({ tabId })
          } catch (e) {
            console.error("[Popup] Could not open side panel:", e)
          }
        }
        window.close()
      })
    }
  }, [])

  return (
    <div style={{ width: "1px", height: "1px", overflow: "hidden" }} />
  )
}

export default Popup
