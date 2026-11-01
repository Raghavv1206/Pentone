import { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { Camera, Mic, GripVertical, Square } from 'lucide-react'
import { getAudioCountdown, getIsCapturingAudio, cancelAudioCapture } from './custom-text-selection'
import { useInjectedTheme } from '~lib/theme-context'

interface CaptureOverlayButtonsProps {
  onScreenshot: () => void
  onAudio: () => void
}

export const CaptureOverlayButtons = ({ onScreenshot, onAudio }: CaptureOverlayButtonsProps) => {
  const [position, setPosition] = useState({ x: typeof window !== 'undefined' ? Math.max(20, window.innerWidth - 140) : 200, y: 24 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [audioCountdown, setAudioCountdown] = useState(5)
  const [isCapturingAudio, setIsCapturingAudio] = useState(false)
  const { effectiveTheme } = useInjectedTheme()
  const isDark = effectiveTheme === 'dark'

  const handleDragStart = (e: React.MouseEvent) => {
    setIsDragging(true)
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    })
  }

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const maxX = typeof window !== 'undefined' ? window.innerWidth - 130 : 1000
      const maxY = typeof window !== 'undefined' ? window.innerHeight - 50 : 800
      setPosition({
        x: Math.max(12, Math.min(maxX, e.clientX - dragOffset.x)),
        y: Math.max(12, Math.min(maxY, e.clientY - dragOffset.y))
      })
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, dragOffset])

  // Poll for audio state
  useEffect(() => {
    const interval = setInterval(() => {
      setAudioCountdown(getAudioCountdown())
      setIsCapturingAudio(getIsCapturingAudio())
    }, 100)

    return () => clearInterval(interval)
  }, [])

  const containerBg = isDark ? 'rgba(23, 24, 22, 0.94)' : 'rgba(255, 254, 239, 0.96)'
  const containerBorder = isDark ? '1px solid #6D6E63' : '1px solid #878571'
  const containerShadow = isDark
    ? (isDragging ? '0 12px 36px rgba(0, 0, 0, 0.65)' : '0 8px 24px rgba(0, 0, 0, 0.45)')
    : (isDragging ? '0 12px 32px rgba(25, 25, 25, 0.16)' : '0 6px 20px rgba(25, 25, 25, 0.08)')
  const iconColor = isDark ? '#A6A49B' : '#56564E'
  const iconHoverColor = isDark ? '#F5F1E7' : '#191919'
  const iconHoverBg = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)'

  return (
    <>
      <style>{`
        @keyframes pentonePulseCrimson {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(225, 29, 72, 0.6), 0 0 12px rgba(225, 29, 72, 0.4);
          }
          50% {
            box-shadow: 0 0 0 6px rgba(225, 29, 72, 0), 0 0 18px rgba(225, 29, 72, 0.7);
          }
        }
      `}</style>
      <div
        className="pentone-floating-pill"
        style={{
          position: 'fixed',
          left: `${position.x}px`,
          top: `${position.y}px`,
          zIndex: 2147483640,
          pointerEvents: 'auto',
          background: containerBg,
          borderRadius: '9999px',
          border: containerBorder,
          boxShadow: containerShadow,
          padding: '4px 6px',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: '3px',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          userSelect: 'none',
          fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
          transition: isDragging ? 'none' : 'background 0.2s ease, border 0.2s ease, box-shadow 0.2s ease'
        }}
      >
        {/* Drag handle */}
        <div
          onMouseDown={handleDragStart}
          style={{
            cursor: isDragging ? 'grabbing' : 'grab',
            padding: '4px 3px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: iconColor,
            transition: 'color 0.15s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = iconHoverColor
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = iconColor
          }}
          title="Drag to reposition"
        >
          <GripVertical size={13} strokeWidth={2} />
        </div>
        
        {/* Screenshot button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onScreenshot()
          }}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            background: 'transparent',
            border: 'none',
            borderRadius: '9999px',
            width: '28px',
            height: '28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            padding: '0',
            color: iconColor
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = iconHoverBg
            e.currentTarget.style.color = iconHoverColor
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = iconColor
          }}
          title="Capture screenshot (Cmd/Ctrl+Shift+S)"
        >
          <Camera size={14} strokeWidth={2} />
        </button>

        {/* Audio recording button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (isCapturingAudio && audioCountdown === 0) {
              cancelAudioCapture()
            } else if (!isCapturingAudio) {
              onAudio()
            }
          }}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            background: isCapturingAudio ? '#E11D48' : 'transparent',
            border: 'none',
            borderRadius: '9999px',
            width: isCapturingAudio && audioCountdown > 0 ? '42px' : '28px',
            height: '28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            padding: '0',
            color: isCapturingAudio ? '#FFFFFF' : iconColor,
            fontSize: isCapturingAudio && audioCountdown > 0 ? '11px' : 'inherit',
            fontWeight: isCapturingAudio && audioCountdown > 0 ? '700' : '500',
            animation: isCapturingAudio && audioCountdown === 0 ? 'pentonePulseCrimson 1.5s infinite' : 'none',
            boxShadow: isCapturingAudio && audioCountdown > 0 ? '0 0 10px rgba(225, 29, 72, 0.5)' : 'none'
          }}
          onMouseEnter={(e) => {
            if (!isCapturingAudio) {
              e.currentTarget.style.background = iconHoverBg
              e.currentTarget.style.color = iconHoverColor
            }
          }}
          onMouseLeave={(e) => {
            if (!isCapturingAudio) {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = iconColor
            }
          }}
          title={isCapturingAudio && audioCountdown === 0 ? 'Stop Recording' : 'Record Audio (Cmd/Ctrl+Shift+A)'}
        >
          {isCapturingAudio ? (
            audioCountdown > 0 ? (
              <span style={{ letterSpacing: '-0.02em' }}>{audioCountdown}s</span>
            ) : (
              <Square size={12} strokeWidth={2} fill="white" />
            )
          ) : (
            <Mic size={14} strokeWidth={2} />
          )}
        </button>
      </div>
    </>
  )
}

// Global callbacks
let globalOnScreenshot: (() => void) | null = null
let globalOnAudio: (() => void) | null = null

const CaptureOverlayWrapper = () => {
  return (
    <CaptureOverlayButtons
      onScreenshot={() => globalOnScreenshot?.()}
      onAudio={() => globalOnAudio?.()}
    />
  )
}

// Initialize the capture overlay buttons
export const initCaptureOverlayButtons = (onScreenshot: () => void, onAudio: () => void) => {
  globalOnScreenshot = onScreenshot
  globalOnAudio = onAudio

  const container = document.createElement('div')
  container.id = 'pentone-capture-overlay-root'
  container.style.position = 'fixed'
  container.style.top = '0'
  container.style.left = '0'
  container.style.width = '0'
  container.style.height = '0'
  container.style.zIndex = '2147483640'
  container.style.pointerEvents = 'none'
  
  document.body.appendChild(container)
  
  const root = createRoot(container)
  root.render(<CaptureOverlayWrapper />)
  
  console.log('Pentone: Capture overlay buttons initialized')
}
