import React, { useState } from 'react'
import { 
  BookOpen, 
  FileText, 
  Sparkles, 
  Languages, 
  MessageSquare, 
  GripVertical, 
  X, 
  ArrowLeft, 
  Copy, 
  Check, 
  RotateCcw, 
  Send
} from 'lucide-react'

export type TextActionType = 'explain' | 'summarize' | 'rewrite' | 'translate' | 'ask'

interface TextExplainerViewProps {
  selectedText: string
  screenshot?: string // base64 image data
  audio?: string // base64 audio data
  mode: 'options' | 'explaining'
  isProcessing: boolean
  result: string
  displayedResult: string
  isDragging: boolean
  isDark?: boolean
  onDragStart: (e: React.MouseEvent) => void
  onExplain?: () => void
  onAction?: (action: TextActionType, customPrompt?: string) => void
  onSendToChat: () => void
  onClose?: () => void
  onReplace?: (text: string) => void
  isEditable?: boolean
}

// Animated Analyzing Component
const AnalyzingAnimation: React.FC<{ isDark: boolean }> = ({ isDark }) => {
  const [dots, setDots] = useState(0)

  React.useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev + 1) % 4)
    }, 350)
    return () => clearInterval(interval)
  }, [])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 14px' }}>
      <div 
        style={{
          width: '14px',
          height: '14px',
          borderRadius: '50%',
          border: `2px solid ${isDark ? '#67E2C8' : '#005447'}`,
          borderTopColor: 'transparent',
          animation: 'pentoneSpin 0.8s linear infinite'
        }}
      />
      <span style={{ 
        fontSize: '12px', 
        fontWeight: 500, 
        color: isDark ? '#A6A49B' : '#56564E',
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif"
      }}>
        Analyzing{'.'.repeat(dots)}
      </span>
      <style>{`
        @keyframes pentoneSpin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

export const TextExplainerView: React.FC<TextExplainerViewProps> = ({
  selectedText,
  screenshot,
  audio,
  mode,
  isProcessing,
  result,
  displayedResult,
  isDragging,
  isDark = false,
  onDragStart,
  onExplain,
  onAction,
  onSendToChat,
  onClose,
  onReplace,
  isEditable = false
}) => {
  const [activeAction, setActiveAction] = useState<TextActionType | null>(mode === 'explaining' ? 'explain' : null)
  const [customPrompt, setCustomPrompt] = useState('')
  const [copied, setCopied] = useState(false)
  const [showAskInput, setShowAskInput] = useState(false)

  // Explicit semantic color tokens with guaranteed WCAG AA contrast
  const textPrimary = isDark ? '#F5F1E7' : '#191919'
  const textSecondary = isDark ? '#A6A49B' : '#56564E'
  const textMuted = isDark ? '#88867C' : '#73736A'
  const borderSubtle = isDark ? '#373832' : '#DDDCCB'
  const borderControl = isDark ? '#6D6E63' : '#878571' // >= 3:1 contrast against adjacent backgrounds
  const borderStrong = isDark ? '#6D6E63' : '#878571'
  const placeholderColor = isDark ? '#949286' : '#636257'
  const surfaceSecondary = isDark ? '#22231F' : '#F3F1DF'
  const surfaceElevated = isDark ? '#2D2E29' : '#E8E5CE'
  const surfaceInput = isDark ? '#1E1F1B' : '#FAF8E8'
  const accentPrimary = isDark ? '#67E2C8' : '#005447'
  const accentHover = isDark ? '#52C7AE' : '#004238'
  const accentOnSolid = isDark ? '#0D1F1B' : '#FFFFFF'

  const handleActionClick = (action: TextActionType) => {
    if (action === 'ask') {
      setShowAskInput(prev => !prev)
      return
    }
    setActiveAction(action)
    if (onAction) {
      onAction(action)
    } else if (action === 'explain' && onExplain) {
      onExplain()
    }
  }

  const handleAskSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!customPrompt.trim()) return
    setActiveAction('ask')
    if (onAction) {
      onAction('ask', customPrompt)
    } else if (onExplain) {
      onExplain()
    }
  }

  const handleCopy = () => {
    const textToCopy = displayedResult || result
    if (!textToCopy) return
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  const handleRetry = () => {
    if (activeAction) {
      if (onAction) {
        onAction(activeAction, activeAction === 'ask' ? customPrompt : undefined)
      } else if (onExplain) {
        onExplain()
      }
    }
  }

  const handleBackToOptions = () => {
    setActiveAction(null)
    setShowAskInput(false)
  }

  const actionButtons: Array<{ 
    id: TextActionType
    label: string
    icon: React.ReactNode
    tier: 'primary' | 'secondary' | 'tertiary'
  }> = [
    { id: 'explain', label: 'Explain', icon: <BookOpen size={13} />, tier: 'primary' },
    { id: 'summarize', label: 'Summarize', icon: <FileText size={13} />, tier: 'secondary' },
    { id: 'rewrite', label: 'Rewrite', icon: <Sparkles size={13} />, tier: 'secondary' },
    { id: 'translate', label: 'Translate', icon: <Languages size={13} />, tier: 'tertiary' },
    { id: 'ask', label: 'Ask Pentone', icon: <MessageSquare size={13} />, tier: 'tertiary' }
  ]

  const isExpanded = Boolean(activeAction && (isProcessing || displayedResult))

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
      color: textPrimary
    }}>
      {/* Header bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '2px 4px 4px 4px',
        borderBottom: `1px solid ${borderSubtle}`
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {isExpanded ? (
            <button
              onClick={handleBackToOptions}
              style={{
                background: 'transparent',
                border: 'none',
                color: textSecondary,
                cursor: 'pointer',
                padding: '4px',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = textPrimary
                e.currentTarget.style.background = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = textSecondary
                e.currentTarget.style.background = 'transparent'
              }}
              title="Back to text actions"
            >
              <ArrowLeft size={13} />
            </button>
          ) : (
            <div
              onMouseDown={onDragStart}
              style={{
                cursor: isDragging ? 'grabbing' : 'grab',
                padding: '4px 2px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: textSecondary,
                userSelect: 'none'
              }}
              title="Drag to reposition"
            >
              <GripVertical size={13} />
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Sparkles size={12} color={accentPrimary} />
            <span style={{
              fontSize: '10px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: textSecondary
            }}>
              {isExpanded && activeAction 
                ? (activeAction === 'ask' ? 'Ask Pentone' : activeAction.toUpperCase()) 
                : 'TEXT ACTIONS'}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {onClose && (
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: textSecondary,
                cursor: 'pointer',
                padding: '4px',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = textPrimary
                e.currentTarget.style.background = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = textSecondary
                e.currentTarget.style.background = 'transparent'
              }}
              title="Close"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Selected media/text preview */}
      {screenshot ? (
        <div style={{
          padding: '4px',
          display: 'flex',
          justifyContent: 'center',
          borderRadius: '8px',
          background: surfaceSecondary,
          border: `1px solid ${borderSubtle}`
        }}>
          <img 
            src={screenshot} 
            alt="Screenshot" 
            style={{
              maxWidth: '100%',
              maxHeight: isExpanded ? '80px' : '150px',
              borderRadius: '6px',
              objectFit: 'contain'
            }}
          />
        </div>
      ) : audio ? (
        <div style={{
          padding: '8px 12px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '6px',
          borderRadius: '8px',
          background: surfaceSecondary,
          border: `1px solid ${borderSubtle}`
        }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: textSecondary }}>
            Audio Recording (5 seconds)
          </span>
          <audio src={audio} controls style={{ width: '100%', maxWidth: '260px', height: '28px' }} />
        </div>
      ) : selectedText ? (
        <div style={{
          padding: '8px 11px',
          fontSize: '12px',
          lineHeight: '1.45',
          fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
          color: textPrimary,
          background: surfaceSecondary,
          borderRadius: '8px',
          border: `1px solid ${borderControl}`,
          maxHeight: isExpanded ? '46px' : '65px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: isExpanded ? 2 : 3,
          WebkitBoxOrient: 'vertical'
        }}>
          <span style={{ color: textSecondary, fontWeight: 700, marginRight: '3px' }}>“</span>
          {selectedText}
          <span style={{ color: textSecondary, fontWeight: 700, marginLeft: '3px' }}>”</span>
        </div>
      ) : null}

      {/* Action buttons (when not expanded or below preview) */}
      {!isExpanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '5px'
          }}>
            {actionButtons.map((btn) => {
              const isPrimary = btn.tier === 'primary'
              const isSecondary = btn.tier === 'secondary'
              
              const btnBg = isPrimary 
                ? accentPrimary 
                : (isSecondary ? surfaceSecondary : surfaceInput)
              const btnColor = isPrimary 
                ? accentOnSolid 
                : (isSecondary ? textPrimary : textSecondary)
              const btnBorder = isPrimary 
                ? `1px solid ${accentPrimary}` 
                : `1px solid ${borderControl}`
              const iconColor = isPrimary 
                ? accentOnSolid 
                : (isSecondary ? accentPrimary : textSecondary)

              return (
                <button
                  key={btn.id}
                  onClick={() => handleActionClick(btn.id)}
                  style={{
                    background: btnBg,
                    border: btnBorder,
                    borderRadius: '9999px',
                    padding: isPrimary ? '5px 12px' : '5px 9px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    fontSize: '11px',
                    fontWeight: isPrimary ? 700 : 600,
                    color: btnColor,
                    cursor: 'pointer',
                    boxShadow: isPrimary 
                      ? (isDark ? '0 2px 8px rgba(103, 226, 200, 0.25)' : '0 2px 6px rgba(0, 84, 71, 0.2)') 
                      : 'none',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (isPrimary) {
                      e.currentTarget.style.background = accentHover
                    } else {
                      e.currentTarget.style.background = surfaceElevated
                      e.currentTarget.style.borderColor = accentPrimary
                      e.currentTarget.style.color = textPrimary
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = btnBg
                    e.currentTarget.style.borderColor = btnBorder.replace('1px solid ', '')
                    e.currentTarget.style.color = btnColor
                  }}
                >
                  <span style={{ color: iconColor, display: 'flex', alignItems: 'center' }}>
                    {btn.icon}
                  </span>
                  <span>{btn.label}</span>
                </button>
              )
            })}
          </div>

          {/* Ask Pentone quick prompt input */}
          {showAskInput && (
            <form 
              onSubmit={handleAskSubmit}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                marginTop: '3px',
                padding: '3px 4px',
                borderRadius: '8px',
                background: surfaceInput,
                border: `1px solid ${accentPrimary}`
              }}
            >
              <input
                type="text"
                autoFocus
                placeholder="Ask anything about this selection..."
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  fontSize: '11px',
                  color: textPrimary,
                  padding: '4px 6px',
                  fontFamily: 'inherit'
                }}
              />
              <button
                type="submit"
                disabled={!customPrompt.trim()}
                style={{
                  background: accentPrimary,
                  border: 'none',
                  borderRadius: '6px',
                  padding: '4px 9px',
                  color: accentOnSolid,
                  cursor: customPrompt.trim() ? 'pointer' : 'not-allowed',
                  opacity: customPrompt.trim() ? 1 : 0.45,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease'
                }}
              >
                <Send size={11} />
              </button>
            </form>
          )}
        </div>
      )}

      {/* Expanded result state */}
      {isExpanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {isProcessing && !displayedResult ? (
            <AnalyzingAnimation isDark={isDark} />
          ) : (
            <div style={{
              padding: '10px 12px',
              fontSize: '12.5px',
              lineHeight: '1.55',
              color: textPrimary,
              background: surfaceSecondary,
              borderRadius: '10px',
              border: `1px solid ${borderControl}`,
              maxHeight: '220px',
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}>
              {displayedResult}
              {isProcessing && (
                <span style={{ 
                  display: 'inline-block',
                  width: '6px',
                  height: '13px',
                  background: accentPrimary,
                  marginLeft: '4px',
                  verticalAlign: 'middle',
                  animation: 'pentoneCursorBlink 0.8s infinite'
                }} />
              )}
            </div>
          )}

          {/* Action result toolbar */}
          {displayedResult && !isProcessing && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: '2px',
              gap: '6px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <button
                  onClick={handleCopy}
                  style={{
                    background: surfaceInput,
                    border: `1px solid ${borderControl}`,
                    borderRadius: '6px',
                    padding: '4px 8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: copied ? accentPrimary : textSecondary,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = textPrimary
                    e.currentTarget.style.background = surfaceElevated
                    e.currentTarget.style.borderColor = accentPrimary
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = copied ? accentPrimary : textSecondary
                    e.currentTarget.style.background = surfaceInput
                    e.currentTarget.style.borderColor = borderControl
                  }}
                  title="Copy result"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>

                {isEditable && onReplace && (
                  <button
                    onClick={() => onReplace(displayedResult)}
                    style={{
                      background: surfaceInput,
                      border: `1px solid ${borderControl}`,
                      borderRadius: '6px',
                      padding: '4px 8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '11px',
                      fontWeight: 600,
                      color: textSecondary,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = textPrimary
                      e.currentTarget.style.background = surfaceElevated
                      e.currentTarget.style.borderColor = accentPrimary
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = textSecondary
                      e.currentTarget.style.background = surfaceInput
                      e.currentTarget.style.borderColor = borderControl
                    }}
                    title="Replace selected text"
                  >
                    <span>Replace</span>
                  </button>
                )}

                <button
                  onClick={handleRetry}
                  style={{
                    background: surfaceInput,
                    border: `1px solid ${borderControl}`,
                    borderRadius: '6px',
                    padding: '4px 6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '11px',
                    color: textSecondary,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = textPrimary
                    e.currentTarget.style.background = surfaceElevated
                    e.currentTarget.style.borderColor = accentPrimary
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = textSecondary
                    e.currentTarget.style.background = surfaceInput
                    e.currentTarget.style.borderColor = borderControl
                  }}
                  title="Regenerate"
                >
                  <RotateCcw size={12} />
                </button>
              </div>

              <button
                onClick={onSendToChat}
                style={{
                  background: accentPrimary,
                  border: `1px solid ${accentPrimary}`,
                  borderRadius: '6px',
                  padding: '4px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: accentOnSolid,
                  cursor: 'pointer',
                  transition: 'opacity 0.15s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = accentHover
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = accentPrimary
                }}
                title="Send context to Pentone Chat"
              >
                <MessageSquare size={11} />
                <span>Send to Chat</span>
              </button>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes pentoneCursorBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  )
}
