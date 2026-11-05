import React from 'react'
import { Send, GripVertical, Wand2, Sparkles, CornerDownLeft, X } from 'lucide-react'
import { RewriterPresets, type PresetAction } from './rewriter-presets'

interface TextRewriterViewProps {
  inputValue: string
  setInputValue: (value: string) => void
  isProcessing: boolean
  suggestion: string
  displayedSuggestion: string
  inputRef: React.RefObject<HTMLInputElement>
  isDragging: boolean
  onDragStart: (e: React.MouseEvent) => void
  onSendClick: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onPresetClick?: (preset: PresetAction) => void
}

// Animated "Rewriting..." component
const WritingAnimation = () => {
  const [dots, setDots] = React.useState(0)

  React.useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev + 1) % 4)
    }, 380)

    return () => clearInterval(interval)
  }, [])

  const text = 'Rewriting with Gemini Nano'
  const dotString = '.'.repeat(dots)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <Sparkles size={13} style={{ color: '#67E2C8', animation: 'spin-slow 3s linear infinite' }} />
      <span style={{ color: '#DDDCCB', fontStyle: 'italic', fontSize: '12px' }}>
        {text}
        <span style={{ minWidth: '1.5em', display: 'inline-block', color: '#67E2C8', fontWeight: 'bold' }}>
          {dotString}
        </span>
      </span>
      <style>
        {`
          @keyframes spin-slow {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>
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
  onDragStart,
  onSendClick,
  onKeyDown,
  onPresetClick
}) => {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [isHoveredSend, setIsHoveredSend] = React.useState(false)

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
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !isProcessing) {
        if (suggestion) {
          e.preventDefault()
          onSendClick()
        }
      }
    }

    const container = containerRef.current
    if (container) {
      container.addEventListener('keydown', handleKeyDown)
    }

    return () => {
      if (container) {
        container.removeEventListener('keydown', handleKeyDown)
      }
    }
  }, [suggestion, isProcessing, onSendClick])

  return (
    <div ref={containerRef} tabIndex={-1} style={{ outline: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* Header row with drag handle and title */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            onMouseDown={onDragStart}
            style={{
              background: 'transparent',
              border: 'none',
              color: isDragging ? '#67E2C8' : '#77776E',
              cursor: isDragging ? 'grabbing' : 'grab',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.2s',
              userSelect: 'none'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#A6A49B')}
            onMouseLeave={(e) => (e.currentTarget.style.color = isDragging ? '#67E2C8' : '#77776E')}
            title="Drag to reposition"
          >
            <GripVertical size={15} />
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{
              fontFamily: "'Newsreader', 'Fraunces', 'Georgia', serif",
              fontSize: '13.5px',
              fontWeight: 600,
              color: '#F5F1E7',
              letterSpacing: '-0.01em'
            }}>
              Pentone Rewrite
            </span>
            <span style={{
              fontSize: '9.5px',
              fontWeight: 600,
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
              color: '#67E2C8',
              background: 'rgba(0, 84, 71, 0.35)',
              border: '1px solid rgba(103, 226, 200, 0.3)',
              padding: '1.5px 6px',
              borderRadius: '6px',
              letterSpacing: '0.04em'
            }}>
              EDITABLE TEXT
            </span>
          </div>
        </div>
      </div>

      {/* Preset pills grid */}
      {!suggestion && onPresetClick && (
        <RewriterPresets 
          onPresetClick={onPresetClick}
          disabled={isProcessing}
        />
      )}

      {/* Input container */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '8px',
        background: 'rgba(34, 35, 31, 0.8)',
        border: '1px solid rgba(55, 56, 50, 0.85)',
        borderRadius: '12px',
        padding: '5px 8px 5px 12px'
      }}>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={isProcessing || !!suggestion}
          placeholder="Describe your changes (or select a preset above)..."
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            color: '#F5F1E7',
            fontSize: '12.5px',
            fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            outline: 'none',
            padding: '4px 0',
            opacity: isProcessing || suggestion ? 0.6 : 1
          }}
        />
        
        <button
          onClick={onSendClick}
          onMouseEnter={() => setIsHoveredSend(true)}
          onMouseLeave={() => setIsHoveredSend(false)}
          disabled={isProcessing || (!inputValue.trim() && !suggestion)}
          style={{
            background: suggestion 
              ? (isHoveredSend ? '#003F36' : '#005447')
              : (inputValue.trim() && !isProcessing ? (isHoveredSend ? '#003F36' : '#005447') : 'rgba(55, 56, 50, 0.3)'),
            border: (suggestion || (inputValue.trim() && !isProcessing)) ? '1px solid rgba(103, 226, 200, 0.3)' : '1px solid transparent',
            color: (suggestion || (inputValue.trim() && !isProcessing)) ? '#67E2C8' : '#77776E',
            cursor: (isProcessing || (!inputValue.trim() && !suggestion)) ? 'not-allowed' : 'pointer',
            padding: '5px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            borderRadius: '8px',
            fontSize: '11px',
            fontWeight: 600,
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            transition: 'all 0.18s ease',
            opacity: (isProcessing || (!inputValue.trim() && !suggestion)) ? 0.4 : 1
          }}
          title={suggestion ? "Apply to selection (Enter)" : "Rewrite (Enter)"}
        >
          {suggestion ? (
            <>
              <CornerDownLeft size={13} strokeWidth={2.4} />
              <span>Replace</span>
            </>
          ) : (
            <Send size={13} strokeWidth={2.2} />
          )}
        </button>
      </div>

      {/* Processing animation */}
      {isProcessing && !displayedSuggestion && (
        <div style={{
          padding: '10px 14px',
          background: 'rgba(0, 84, 71, 0.1)',
          border: '1px solid rgba(103, 226, 200, 0.2)',
          borderRadius: '10px'
        }}>
          <WritingAnimation />
        </div>
      )}

      {/* Output suggestion */}
      {displayedSuggestion && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{
            padding: '12px 14px',
            fontSize: '13px',
            color: '#F5F1E7',
            fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            lineHeight: '1.6',
            background: 'rgba(0, 84, 71, 0.12)',
            border: '1px solid rgba(103, 226, 200, 0.28)',
            borderRadius: '12px',
            maxHeight: '260px',
            overflowY: 'auto'
          }}>
            {displayedSuggestion}
            {isProcessing && <span style={{ color: '#67E2C8', fontWeight: 'bold', animation: 'blink 1s infinite' }}>▌</span>}
          </div>

          {!isProcessing && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '10.5px',
              color: '#A6A49B',
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
              padding: '0 2px'
            }}>
              <span>Rewrite ready</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>Press</span>
                <span style={{ 
                  background: 'rgba(0, 84, 71, 0.4)', 
                  padding: '2px 7px', 
                  borderRadius: '5px',
                  border: '1px solid rgba(103, 226, 200, 0.3)',
                  color: '#67E2C8',
                  fontWeight: 600
                }}>Enter</span>
                <span>to replace text</span>
              </div>
            </div>
          )}
        </div>
      )}
      
      {isProcessing && (
        <style>{`
          @keyframes blink {
            0%, 50% { opacity: 1; }
            51%, 100% { opacity: 0; }
          }
        `}</style>
      )}
    </div>
  )
}
