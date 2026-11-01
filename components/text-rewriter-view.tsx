import React from 'react'
import { Send, GripVertical, Sparkles } from 'lucide-react'
import { RewriterPresets, type PresetAction } from './rewriter-presets'

interface TextRewriterViewProps {
  inputValue: string
  setInputValue: (value: string) => void
  isProcessing: boolean
  suggestion: string
  displayedSuggestion: string
  inputRef: React.RefObject<HTMLInputElement>
  isDragging: boolean
  isDark?: boolean
  onDragStart: (e: React.MouseEvent) => void
  onSendClick: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onPresetClick?: (preset: PresetAction) => void
}

// Animated "Rewriting..." component
const WritingAnimation: React.FC<{ isDark: boolean }> = ({ isDark }) => {
  const [dots, setDots] = React.useState(0)

  React.useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev + 1) % 4)
    }, 350)
    return () => clearInterval(interval)
  }, [])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px' }}>
      <div 
        style={{
          width: '13px',
          height: '13px',
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
        Rewriting{'.'.repeat(dots)}
      </span>
      <style>{`
        @keyframes pentoneSpin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

export const TextRewriterView: React.FC<TextRewriterViewProps> = ({
  inputValue,
  setInputValue,
  isProcessing,
  suggestion,
  displayedSuggestion,
  inputRef,
  isDragging,
  isDark = false,
  onDragStart,
  onSendClick,
  onKeyDown,
  onPresetClick
}) => {
  const containerRef = React.useRef<HTMLDivElement>(null)

  // Auto-focus input when component mounts
  React.useEffect(() => {
    if (inputRef.current && !suggestion) {
      setTimeout(() => {
        inputRef.current?.focus()
      }, 100)
    }
  }, [inputRef, suggestion])

  // Focus container when suggestion appears
  React.useEffect(() => {
    if (suggestion && containerRef.current) {
      containerRef.current.focus()
    }
  }, [suggestion])

  // Handle Enter key globally for the component
  React.useEffect(() => {
    const handleKeyDownGlobal = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !isProcessing) {
        if (suggestion) {
          e.preventDefault()
          onSendClick()
        }
      }
    }

    const container = containerRef.current
    if (container) {
      container.addEventListener('keydown', handleKeyDownGlobal)
      return () => container.removeEventListener('keydown', handleKeyDownGlobal)
    }
  }, [suggestion, isProcessing, onSendClick])

  const textPrimary = isDark ? '#F5F1E7' : '#191919'
  const textSecondary = isDark ? '#A6A49B' : '#56564E'
  const borderSubtle = isDark ? '#373832' : '#DDDCCB'
  const borderControl = isDark ? '#6D6E63' : '#878571'
  const surfaceSecondary = isDark ? '#22231F' : '#F3F1DF'
  const accentPrimary = isDark ? '#67E2C8' : '#005447'

  return (
    <div 
      ref={containerRef}
      tabIndex={-1}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        outline: 'none',
        fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
        color: textPrimary
      }}
    >
      {/* Header row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '2px 4px 4px 4px',
        borderBottom: `1px solid ${borderSubtle}`
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
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

          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Sparkles size={12} color={accentPrimary} />
            <span style={{
              fontSize: '10px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: textSecondary
            }}>
              Rewrite Text
            </span>
          </div>
        </div>
      </div>

      {/* Input row */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '6px',
        background: surfaceSecondary,
        borderRadius: '8px',
        border: `1px solid ${borderControl}`,
        padding: '4px 8px'
      }}>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={isProcessing || Boolean(suggestion)}
          placeholder="Describe your changes (e.g. more polite, concise)..."
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            color: textPrimary,
            fontSize: '12px',
            fontFamily: 'inherit',
            outline: 'none',
            padding: '4px 2px',
            opacity: isProcessing || suggestion ? 0.6 : 1
          }}
        />
        
        <button
          onClick={onSendClick}
          disabled={isProcessing || (!inputValue.trim() && !suggestion)}
          style={{
            background: suggestion ? accentPrimary : 'transparent',
            border: suggestion ? 'none' : `1px solid ${borderSubtle}`,
            color: suggestion ? (isDark ? '#171816' : '#FFFFFF') : textSecondary,
            cursor: (isProcessing || (!inputValue.trim() && !suggestion)) ? 'not-allowed' : 'pointer',
            padding: '5px 8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '6px',
            transition: 'all 0.15s ease',
            opacity: (isProcessing || (!inputValue.trim() && !suggestion)) ? 0.45 : 1
          }}
          onMouseEnter={(e) => {
            if (!isProcessing && (inputValue.trim() || suggestion)) {
              e.currentTarget.style.borderColor = accentPrimary
              if (!suggestion) e.currentTarget.style.color = textPrimary
            }
          }}
          onMouseLeave={(e) => {
            if (!suggestion) {
              e.currentTarget.style.borderColor = borderSubtle
              e.currentTarget.style.color = textSecondary
            }
          }}
          title={suggestion ? 'Apply rewrite' : 'Send'}
        >
          <Send size={12} />
        </button>
      </div>

      {/* Presets - visible when no suggestion */}
      {!suggestion && onPresetClick && (
        <RewriterPresets 
          onPresetClick={onPresetClick}
          disabled={isProcessing}
          isDark={isDark}
        />
      )}

      {/* Processing state */}
      {isProcessing && !displayedSuggestion && (
        <WritingAnimation isDark={isDark} />
      )}

      {/* Suggestion display */}
      {displayedSuggestion && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{
            padding: '10px 12px',
            fontSize: '12.5px',
            lineHeight: '1.55',
            color: textPrimary,
            background: surfaceSecondary,
            borderRadius: '8px',
            border: `1px solid ${accentPrimary}`,
            maxHeight: '200px',
            overflowY: 'auto'
          }}>
            {displayedSuggestion}
            {isProcessing && (
              <span style={{ 
                display: 'inline-block',
                width: '6px',
                height: '13px',
                background: accentPrimary,
                marginLeft: '4px',
                verticalAlign: 'middle',
                animation: 'pentoneBlink 0.8s infinite'
              }} />
            )}
          </div>

          {!isProcessing && (
            <div style={{
              fontSize: '11px',
              color: textSecondary,
              textAlign: 'center',
              paddingTop: '2px'
            }}>
              Press <span style={{ 
                background: surfaceSecondary, 
                padding: '2px 6px', 
                borderRadius: '4px',
                border: `1px solid ${borderSubtle}`,
                color: textPrimary,
                fontWeight: 600
              }}>Enter</span> to replace selection
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes pentoneBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  )
}
