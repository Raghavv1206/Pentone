import React from 'react'
import { Send, GripVertical, X, Sparkles, CornerDownLeft, AlertCircle } from 'lucide-react'

interface TextWriterViewProps {
  inputValue: string
  setInputValue: (value: string) => void
  isProcessing: boolean
  output: string
  displayedOutput: string
  inputRef: React.RefObject<HTMLInputElement>
  isDragging: boolean
  onDragStart: (e: React.MouseEvent) => void
  onSendClick: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onClose: () => void
}

// Animated "Drafting..." component
const WritingAnimation = () => {
  const [dots, setDots] = React.useState(0)

  React.useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev + 1) % 4)
    }, 380)

    return () => clearInterval(interval)
  }, [])

  const text = 'Drafting with Gemini Nano'
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

export const TextWriterView: React.FC<TextWriterViewProps> = ({
  inputValue,
  setInputValue,
  isProcessing,
  output,
  displayedOutput,
  inputRef,
  isDragging,
  onDragStart,
  onSendClick,
  onKeyDown,
  onClose
}) => {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [isHoveredSend, setIsHoveredSend] = React.useState(false)

  // Auto-focus input when component mounts or becomes visible
  React.useEffect(() => {
    if (inputRef.current && !output) {
      inputRef.current.focus()
      const timer = setTimeout(() => {
        inputRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [output])
  
  React.useEffect(() => {
    if (inputRef.current && !output) {
      inputRef.current.focus()
    }
  }, [inputRef, output])

  React.useEffect(() => {
    if (output && containerRef.current) {
      containerRef.current.focus()
    }
  }, [output])

  // Handle Enter & Escape key
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !isProcessing) {
        if (output) {
          e.preventDefault()
          onSendClick()
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
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
  }, [output, isProcessing, onSendClick, onClose])

  const isError = Boolean(
    displayedOutput &&
    (displayedOutput.toLowerCase().startsWith('unable to write') ||
      displayedOutput.toLowerCase().startsWith('gemini nano is not ready') ||
      displayedOutput.toLowerCase().startsWith('error') ||
      displayedOutput.toLowerCase().includes('error generating text') ||
      displayedOutput.includes('chrome://flags') ||
      displayedOutput.includes('availability()'))
  )

  return (
    <div ref={containerRef} tabIndex={-1} style={{ outline: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* Header row with brand title and drag handle */}
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
              Pentone Writer
            </span>
            <span style={{
              fontSize: '9.5px',
              fontWeight: 600,
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
              color: isError ? '#F28B82' : '#67E2C8',
              background: isError ? 'rgba(234, 67, 53, 0.2)' : 'rgba(0, 84, 71, 0.35)',
              border: isError ? '1px solid rgba(242, 139, 130, 0.3)' : '1px solid rgba(103, 226, 200, 0.3)',
              padding: '1.5px 6px',
              borderRadius: '6px',
              letterSpacing: '0.04em'
            }}>
              {isError ? 'AI NOTICE' : 'INLINE ASSIST'}
            </span>
          </div>
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#77776E',
            cursor: 'pointer',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '9999px',
            transition: 'all 0.15s'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(239, 68, 68, 0.18)'
            e.currentTarget.style.color = '#EF4444'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = '#77776E'
          }}
          title="Close (Esc)"
        >
          <X size={15} />
        </button>
      </div>

      {/* Input container */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '8px',
        background: 'rgba(34, 35, 31, 0.8)',
        border: '1px solid rgba(55, 56, 50, 0.85)',
        borderRadius: '12px',
        padding: '5px 8px 5px 12px',
        transition: 'border-color 0.2s, box-shadow 0.2s'
      }}>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={isProcessing || (!!output && !isError)}
          placeholder="What would you like Pentone to write? (e.g. professional follow-up)..."
          autoFocus
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            color: '#F5F1E7',
            fontSize: '12.5px',
            fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            outline: 'none',
            padding: '4px 0',
            opacity: isProcessing || (output && !isError) ? 0.6 : 1
          }}
        />
        
        <button
          onClick={onSendClick}
          onMouseEnter={() => setIsHoveredSend(true)}
          onMouseLeave={() => setIsHoveredSend(false)}
          disabled={isProcessing || (!inputValue.trim() && !output) || isError}
          style={{
            background: (output && !isError)
              ? (isHoveredSend ? '#003F36' : '#005447')
              : (inputValue.trim() && !isProcessing && !isError ? (isHoveredSend ? '#003F36' : '#005447') : 'rgba(55, 56, 50, 0.3)'),
            border: ((output && !isError) || (inputValue.trim() && !isProcessing && !isError)) ? '1px solid rgba(103, 226, 200, 0.3)' : '1px solid transparent',
            color: ((output && !isError) || (inputValue.trim() && !isProcessing && !isError)) ? '#67E2C8' : '#77776E',
            cursor: (isProcessing || (!inputValue.trim() && !output) || isError) ? 'not-allowed' : 'pointer',
            padding: '5px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            borderRadius: '8px',
            fontSize: '11px',
            fontWeight: 600,
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            transition: 'all 0.18s ease',
            opacity: (isProcessing || (!inputValue.trim() && !output) || isError) ? 0.4 : 1
          }}
          title={isError ? "Unable to insert due to model error" : output ? "Insert Draft into page (Enter)" : "Generate (Enter)"}
        >
          {output && !isError ? (
            <>
              <CornerDownLeft size={13} strokeWidth={2.4} />
              <span>Insert</span>
            </>
          ) : (
            <Send size={13} strokeWidth={2.2} />
          )}
        </button>
      </div>

      {/* Processing animation */}
      {isProcessing && !displayedOutput && (
        <div style={{
          padding: '10px 14px',
          background: 'rgba(0, 84, 71, 0.1)',
          border: '1px solid rgba(103, 226, 200, 0.2)',
          borderRadius: '10px'
        }}>
          <WritingAnimation />
        </div>
      )}

      {/* Output display during streaming or complete */}
      {displayedOutput && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{
            padding: '12px 14px',
            fontSize: '13px',
            color: isError ? '#F5A8A0' : '#F5F1E7',
            fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            lineHeight: '1.6',
            background: isError ? 'rgba(234, 67, 53, 0.12)' : 'rgba(0, 84, 71, 0.12)',
            border: isError ? '1px solid rgba(242, 139, 130, 0.35)' : '1px solid rgba(103, 226, 200, 0.28)',
            borderRadius: '12px',
            maxHeight: '260px',
            overflowY: 'auto',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px'
          }}>
            {isError && <AlertCircle size={16} style={{ color: '#F28B82', flexShrink: 0, marginTop: '2px' }} />}
            <div style={{ flex: 1 }}>
              {displayedOutput}
              {isProcessing && <span style={{ color: '#67E2C8', fontWeight: 'bold', animation: 'blink 1s infinite' }}>▌</span>}
            </div>
          </div>

          {!isProcessing && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '10.5px',
              color: isError ? '#F28B82' : '#A6A49B',
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
              padding: '0 2px'
            }}>
              <span>{isError ? 'Action required' : 'Draft ready'}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {isError ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <button
                      onClick={() => {
                        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                          chrome.runtime.sendMessage({ type: 'open_chrome_flags' })
                        }
                      }}
                      style={{
                        background: 'rgba(234, 67, 53, 0.25)',
                        border: '1px solid rgba(242, 139, 130, 0.45)',
                        color: '#F28B82',
                        padding: '2px 8px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '10px',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                        transition: 'all 0.15s ease'
                      }}
                      title="Open all required flags in Chrome tabs"
                    >
                      <span>⚡ Open Flags</span>
                    </button>
                    <button
                      onClick={() => {
                        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                          chrome.runtime.sendMessage({ type: 'open_chrome_components' })
                        }
                      }}
                      style={{
                        background: 'rgba(255, 255, 255, 0.08)',
                        border: '1px solid rgba(255, 255, 255, 0.18)',
                        color: '#DDDCCB',
                        padding: '2px 7px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '10px',
                        fontWeight: 600,
                        transition: 'all 0.15s ease'
                      }}
                      title="Open chrome://components to check download progress"
                    >
                      <span>Components</span>
                    </button>
                  </div>
                ) : (
                  <>
                    <span>Press</span>
                    <span style={{ 
                      background: 'rgba(0, 84, 71, 0.4)', 
                      padding: '2px 7px', 
                      borderRadius: '5px',
                      border: '1px solid rgba(103, 226, 200, 0.3)',
                      color: '#67E2C8',
                      fontWeight: 600
                    }}>Enter</span>
                    <span>to insert</span>
                  </>
                )}
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
