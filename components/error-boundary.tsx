import React, { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertCircle, RefreshCw, RotateCcw, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react'

interface ErrorBoundaryProps {
  children: ReactNode
  fallbackTitle?: string
  onReset?: () => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  copied: boolean
  showDetails: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
      showDetails: false
    }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[Pentone ErrorBoundary] Uncaught render error:', error, errorInfo)
    this.setState({ errorInfo })
  }

  handleReload = () => {
    if (this.props.onReset) {
      this.props.onReset()
    }
    this.setState({ hasError: false, error: null, errorInfo: null })
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  handleResetState = () => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.remove([
          'pentone_onboarding_complete',
          'pentone_legacy_onboarding_complete',
          'chat_messages',
          'chat_reference'
        ], () => {
          this.handleReload()
        })
        return
      }
    } catch {}
    this.handleReload()
  }

  handleCopyError = () => {
    const errorText = `[Pentone Error]
Message: ${this.state.error?.message}
Stack: ${this.state.error?.stack}
Component Stack: ${this.state.errorInfo?.componentStack}`

    navigator.clipboard?.writeText?.(errorText).then(() => {
      this.setState({ copied: true })
      setTimeout(() => this.setState({ copied: false }), 2000)
    }).catch(() => {})
  }

  render() {
    if (this.state.hasError) {
      const { fallbackTitle = 'Something went wrong' } = this.props
      const { error, copied, showDetails } = this.state

      return (
        <div className="w-full h-full min-h-screen flex flex-col items-center justify-center p-4 bg-[#FFFEEF] dark:bg-[#171816] text-[#191919] dark:text-[#F5F1E7] select-none transition-colors duration-200">
          <div className="w-full max-w-sm p-5 rounded-2xl bg-[#F3F1DF] dark:bg-[#1E1F1C] border border-[#DDDCCB] dark:border-[#373832] shadow-md space-y-4 text-center animate-fadeIn">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-rose-100 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-900/60 flex items-center justify-center text-rose-600 dark:text-rose-400">
              <AlertCircle className="w-6 h-6" />
            </div>

            <div className="space-y-1">
              <span className="font-display text-xs font-bold tracking-wider text-[#005447] dark:text-[#67E2C8] uppercase">
                PENTONE
              </span>
              <h2 className="font-display text-lg font-bold text-[#191919] dark:text-[#F5F1E7]">
                {fallbackTitle}
              </h2>
              <p className="text-xs text-[#77776E] dark:text-[#A6A49B] leading-relaxed">
                Pentone recovered from an unexpected error. You can reload the screen or reset the session below.
              </p>
            </div>

            {error && (
              <div className="text-left text-xs bg-[#FFFEEF] dark:bg-[#171816] border border-[#DDDCCB] dark:border-[#373832] rounded-xl p-2.5 font-mono text-rose-700 dark:text-rose-300 break-words max-h-24 overflow-y-auto">
                {error.message || 'Unknown runtime exception'}
              </div>
            )}

            <div className="space-y-2 pt-1">
              <button
                onClick={this.handleReload}
                className="w-full py-2.5 px-4 rounded-xl font-sans text-xs font-bold bg-[#005447] hover:bg-[#003F36] dark:bg-[#67E2C8] dark:hover:bg-[#52C5AD] text-white dark:text-[#171816] shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99]"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Reload Pentone</span>
              </button>

              <div className="flex items-center justify-between gap-2 pt-1 text-[11px]">
                <button
                  onClick={this.handleResetState}
                  className="px-2.5 py-1.5 rounded-lg text-[#77776E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] transition-colors flex items-center gap-1 cursor-pointer"
                  title="Clear saved setup and restart fresh"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset State</span>
                </button>

                <button
                  onClick={this.handleCopyError}
                  className="px-2.5 py-1.5 rounded-lg text-[#77776E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] transition-colors flex items-center gap-1 cursor-pointer"
                  title="Copy error details to clipboard"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? 'Copied' : 'Copy Error'}</span>
                </button>
              </div>
            </div>

            {/* Collapsible Details */}
            <div className="pt-1 border-t border-[#DDDCCB]/60 dark:border-[#373832]/60 text-left">
              <button
                onClick={() => this.setState({ showDetails: !showDetails })}
                className="text-[10px] text-[#77776E] dark:text-[#A6A49B] hover:text-[#191919] dark:hover:text-[#F5F1E7] flex items-center justify-between w-full py-1 cursor-pointer"
              >
                <span>Technical Stack Trace</span>
                {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              {showDetails && (
                <pre className="mt-1 text-[9px] font-mono text-[#56564E] dark:text-[#A6A49B] bg-[#FFFEEF] dark:bg-[#171816] p-2 rounded-lg max-h-36 overflow-auto whitespace-pre-wrap select-text">
                  {error?.stack || 'No stack trace available'}
                </pre>
              )}
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
