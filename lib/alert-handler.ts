/**
 * Global Alert Handler Bridge
 * Pure event/handler bridge to prevent circular imports between alert-context and chat-context.
 */

export interface AlertAction {
  label: string
  onClick: () => void
}

export type GlobalAlertHandler = (
  type: 'error' | 'info',
  title: string,
  message: string,
  action?: AlertAction
) => void

let activeAlertHandler: GlobalAlertHandler | null = null

export function setGlobalAlertHandler(handler: GlobalAlertHandler | null): void {
  activeAlertHandler = handler
}

export function emitGlobalAlert(
  type: 'error' | 'info',
  title: string,
  message: string,
  action?: AlertAction
): void {
  if (activeAlertHandler) {
    activeAlertHandler(type, title, message, action)
  } else {
    console.warn('[AlertHandler] No active alert handler registered. Dropped alert:', { type, title, message })
  }
}
