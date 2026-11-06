// zoomPage tool - Adjusts the zoom level of the active browser page
import type { ToolSpec } from '../tool-registry'

interface ZoomPageParams {
  action: 'in' | 'out' | 'reset' | 'set'
  factor?: number
}

async function zoomPage(params: ZoomPageParams) {
  try {
    const action = params.action?.toLowerCase() || 'in'

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    const currentZoom = await chrome.tabs.getZoom(tab.id)
    let newZoom = currentZoom

    if (action === 'in') {
      newZoom = Math.min(3.0, Math.round((currentZoom + 0.15) * 100) / 100)
    } else if (action === 'out') {
      newZoom = Math.max(0.3, Math.round((currentZoom - 0.15) * 100) / 100)
    } else if (action === 'reset') {
      newZoom = 1.0
    } else if (action === 'set') {
      const target = typeof params.factor === 'number' ? params.factor : 1.0
      // Normalize percentages if passed as 100, 125, etc.
      const normalized = target > 5 ? target / 100 : target
      newZoom = Math.min(5.0, Math.max(0.25, Math.round(normalized * 100) / 100))
    } else {
      return { success: false, error: `Unknown zoom action: ${action}` }
    }

    await chrome.tabs.setZoom(tab.id, newZoom)
    const percentage = Math.round(newZoom * 100)

    return {
      success: true,
      result: `Page zoom level set to ${percentage}%.`
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'zoomPage',
  description: 'Adjusts the visual zoom level of the active browser tab: "in" to zoom in (+15%), "out" to zoom out (-15%), "reset" to return to 100%, or "set" with a specific factor.',
  parameters: [
    {
      name: 'action',
      type: 'string',
      description: 'The zoom action: "in", "out", "reset", or "set"',
      required: true
    },
    {
      name: 'factor',
      type: 'number',
      description: 'Target zoom level (e.g. 1.25 for 125%, 0.8 for 80%, or 150 for 150%). Required when action is "set".',
      required: false
    }
  ],
  spokenLine: 'Adjusting page zoom',
  examples: [
    'User: "zoom in" → zoomPage with action: "in"',
    'User: "zoom out" → zoomPage with action: "out"',
    'User: "reset zoom" → zoomPage with action: "reset"',
    'User: "zoom to 125%" → zoomPage with action: "set", factor: 1.25'
  ]
}

export default zoomPage
