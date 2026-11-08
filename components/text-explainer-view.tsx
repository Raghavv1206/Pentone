import React from 'react'
import { GripVertical, ExternalLink, MessageSquare, Sparkles, Table } from 'lucide-react'

interface TextExplainerViewProps {
  selectedText: string
  screenshot?: string // base64 image data
  audio?: string // base64 audio data
  csv?: string // extracted CSV table data
  mode: 'options' | 'explaining' // What state we're in
  isProcessing: boolean
  result: string // explanation
  displayedResult: string
  isDragging: boolean
  onDragStart: (e: React.MouseEvent) => void
  onExplain: () => void
  onSendToChat: () => void
}

// Animated "Analyzing..." component
const AnalyzingAnimation = () => {
  const [dots, setDots] = React.useState(0)

  React.useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev + 1) % 4)
    }, 380)

    return () => clearInterval(interval)
  }, [])

  const text = 'Analyzing with Gemini Nano'
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

export const TextExplainerView: React.FC<TextExplainerViewProps> = ({
  selectedText,
  screenshot,
  audio,
  csv,
  mode,
  isProcessing,
  result,
  displayedResult,
  isDragging,
  onDragStart,
  onExplain,
  onSendToChat
}) => {
  const [isHoveredChat, setIsHoveredChat] = React.useState(false)
  const [isHoveredExplain, setIsHoveredExplain] = React.useState(false)
  const [copiedCsv, setCopiedCsv] = React.useState(false)

  const getTitle = () => {
    if (mode === 'explaining') return 'AI Explanation'
    if (csv) return 'Table Detected'
    if (screenshot) return 'Screenshot Analysis'
    if (audio) return 'Audio Analysis'
    return 'Text Selection'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* Header row with drag handle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
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
              Pentone Inspector
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
              letterSpacing: '0.04em',
              textTransform: 'uppercase'
            }}>
              {getTitle()}
            </span>
          </div>
        </div>

        {result && !isProcessing && (
          <button
            onClick={onSendToChat}
            onMouseEnter={() => setIsHoveredChat(true)}
            onMouseLeave={() => setIsHoveredChat(false)}
            style={{
              background: isHoveredChat ? '#003F36' : '#005447',
              border: '1px solid rgba(103, 226, 200, 0.35)',
              color: '#67E2C8',
              cursor: 'pointer',
              padding: '4px 9px',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              borderRadius: '7px',
              fontSize: '11px',
              fontWeight: 600,
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              transition: 'all 0.18s ease'
            }}
          >
            <ExternalLink size={12} strokeWidth={2.2} />
            <span>Send to Sidepanel</span>
          </button>
        )}
      </div>

      {/* Selected text, image, or audio preview */}
      {screenshot ? (
        <div style={{
          padding: '8px',
          background: 'rgba(34, 35, 31, 0.7)',
          border: '1px solid rgba(55, 56, 50, 0.75)',
          borderRadius: '12px',
          display: 'flex',
          justifyContent: 'center'
        }}>
          <img 
            src={screenshot} 
            alt="Screenshot" 
            style={{
              maxWidth: '100%',
              maxHeight: '190px',
              borderRadius: '8px',
              border: '1px solid rgba(55, 56, 50, 0.8)'
            }}
          />
        </div>
      ) : audio ? (
        <div style={{
          padding: '12px',
          background: 'rgba(34, 35, 31, 0.7)',
          border: '1px solid rgba(55, 56, 50, 0.75)',
          borderRadius: '12px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px'
        }}>
          <div style={{
            fontSize: '10.5px',
            color: '#67E2C8',
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}>
            Captured Audio (5 seconds)
          </div>
          <audio 
            src={audio} 
            controls 
            style={{
              width: '100%',
              maxWidth: '320px',
              height: '32px'
            }}
          />
        </div>
      ) : (
        <div style={{
          padding: '10px 14px',
          fontSize: '12.5px',
          color: '#DDDCCB',
          fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          background: 'rgba(34, 35, 31, 0.7)',
          border: '1px solid rgba(55, 56, 50, 0.75)',
          borderLeft: '3px solid #67E2C8',
          borderRadius: '8px',
          lineHeight: '1.5',
          fontStyle: 'italic',
          maxHeight: '75px',
          overflowY: 'auto'
        }}>
          "{selectedText.length > 140 ? selectedText.substring(0, 140) + '...' : selectedText}"
        </div>
      )}

      {/* Action buttons (options mode) */}
      {mode === 'options' && !isProcessing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {csv && (
            <button
              onClick={() => {
                navigator.clipboard.writeText(csv)
                setCopiedCsv(true)
                setTimeout(() => setCopiedCsv(false), 2000)
              }}
              style={{
                background: copiedCsv ? '#005447' : 'rgba(0, 84, 71, 0.45)',
                border: '1px solid #67E2C8',
                color: '#67E2C8',
                cursor: 'pointer',
                padding: '8px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                borderRadius: '9px',
                fontSize: '12px',
                fontWeight: 700,
                fontFamily: "'Plus Jakarta Sans', sans-serif",
                boxShadow: '0 2px 8px rgba(0, 84, 71, 0.3)',
                transition: 'all 0.2s ease'
              }}
            >
              <Table size={14} />
              <span>{copiedCsv ? '✓ Copied CSV to Clipboard!' : '📊 Copy as CSV (Table Detected)'}</span>
            </button>
          )}

          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '8px',
            paddingTop: '2px'
          }}>
            <button
            onClick={onExplain}
            onMouseEnter={() => setIsHoveredExplain(true)}
            onMouseLeave={() => setIsHoveredExplain(false)}
            style={{
              background: isHoveredExplain ? '#003F36' : '#005447',
              border: '1px solid rgba(103, 226, 200, 0.4)',
              color: '#67E2C8',
              cursor: 'pointer',
              padding: '8px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              borderRadius: '9px',
              fontSize: '12px',
              fontWeight: 600,
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              transition: 'all 0.18s ease'
            }}
          >
            <Sparkles size={14} strokeWidth={2.2} />
            <span>{screenshot ? 'Analyze Image' : audio ? 'Analyze Audio' : 'Explain Selection'}</span>
          </button>

          <button
            onClick={onSendToChat}
            onMouseEnter={() => setIsHoveredChat(true)}
            onMouseLeave={() => setIsHoveredChat(false)}
            style={{
              background: isHoveredChat ? 'rgba(0, 84, 71, 0.25)' : 'rgba(34, 35, 31, 0.85)',
              border: isHoveredChat ? '1px solid #67E2C8' : '1px solid rgba(55, 56, 50, 0.85)',
              color: isHoveredChat ? '#FFFFFF' : '#DDDCCB',
              cursor: 'pointer',
              padding: '8px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              borderRadius: '9px',
              fontSize: '12px',
              fontWeight: 500,
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              transition: 'all 0.18s ease'
            }}
          >
            <MessageSquare size={14} strokeWidth={2} />
            <span>Send to Sidepanel</span>
          </button>
          </div>
        </div>
      )}

      {/* Processing state */}
      {isProcessing && !displayedResult && (
        <div style={{
          padding: '10px 14px',
          background: 'rgba(0, 84, 71, 0.1)',
          border: '1px solid rgba(103, 226, 200, 0.2)',
          borderRadius: '10px'
        }}>
          <AnalyzingAnimation />
        </div>
      )}

      {/* Result display */}
      {displayedResult && (
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
          {displayedResult}
          {isProcessing && <span style={{ color: '#67E2C8', fontWeight: 'bold', animation: 'blink 1s infinite' }}>▌</span>}
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
