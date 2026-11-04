/**
 * Global configuration for the extension screens and navigation
 */

export type Screen = 'main' | 'chat' | 'history' | 'tools' | 'memory' | 'settings' | 'debug' | 'diagnostics'

/**
 * Default screen to show when opening the popup or side panel
 */
export const DEFAULT_SCREEN: Screen = 'main'
