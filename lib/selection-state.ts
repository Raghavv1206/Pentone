// selection-state.ts - Manages selection state between Pentone SidePanel and active web pages

export const PENTONE_SELECTED_KEY = 'pentone_selected'
export const PENTONE_SIDEPANEL_OPEN_KEY = 'pentone_sidepanel_open'

/**
 * Updates whether Pentone extension is currently selected/active for keyboard commands (Spacebar hold-to-talk).
 */
export async function setPentoneSelected(selected: boolean): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return

  try {
    await chrome.storage.local.set({
      [PENTONE_SELECTED_KEY]: selected,
      pentone_selected_timestamp: Date.now()
    })

    // Broadcast message to active tabs
    if (chrome.tabs?.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'pentone_set_selected',
            selected
          }).catch(() => {})
        }
      })
    }
  } catch (err) {
    console.warn('[SelectionState] Error setting pentone_selected:', err)
  }
}

/**
 * Checks if Pentone is currently selected/active.
 */
export async function isPentoneSelected(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return false

  try {
    const res = await chrome.storage.local.get([PENTONE_SELECTED_KEY])
    return Boolean(res[PENTONE_SELECTED_KEY])
  } catch {
    return false
  }
}

/**
 * Updates whether the SidePanel is currently open.
 */
export async function setSidepanelOpen(open: boolean): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return

  try {
    await chrome.storage.local.set({
      [PENTONE_SIDEPANEL_OPEN_KEY]: open
    })
    if (!open) {
      await chrome.storage.local.set({ [PENTONE_SELECTED_KEY]: false })
    }
  } catch (err) {
    console.warn('[SelectionState] Error setting sidepanel_open:', err)
  }
}

/**
 * Checks if SidePanel is open.
 */
export async function isSidepanelOpen(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return false

  try {
    const res = await chrome.storage.local.get([PENTONE_SIDEPANEL_OPEN_KEY])
    return Boolean(res[PENTONE_SIDEPANEL_OPEN_KEY])
  } catch {
    return false
  }
}
