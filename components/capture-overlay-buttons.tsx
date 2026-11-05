import { useState, useEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Camera, Mic, GripVertical, Square } from 'lucide-react'
import { getAudioCountdown, getIsCapturingAudio, cancelAudioCapture } from './custom-text-selection'
import { loadSettings } from '../lib/settings'

interface CaptureOverlayButtonsProps {
  onScreenshot: () => void
  onAudio: () => void
}

interface OverlayPosition {
  side: 'right' | 'left'
  offset: number
  top: number
}

const DEFAULT_POSITION: OverlayPosition = {
  side: 'right',
  offset: 20,
  top: 24
}

let setGlobalVisibility: ((visible: boolean) => void) | null = null

const CaptureOverlayButtons = ({ onScreenshot, onAudio }: CaptureOverlayButtonsProps) => {
  const [visible, setVisible] = useState(true)
  const [position, setPosition] = useState<OverlayPosition>(DEFAULT_POSITION)
  const [isDragging, setIsDragging] = useState(false)
  const [dragCoords, setDragCoords] = useState<{ x: number; y: number } | null>(null)
  const [audioCountdown, setAudioCountdown] = useState(5)
  const [isCapturingAudio, setIsCapturingAudio] = useState(false)
  const [hoveredButton, setHoveredButton] = useState<'camera' | 'audio' | 'grip' | null>(null)
  const [cameraPressed, setCameraPressed] = useState(false)

  const pillRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{
    mouseX: number
    mouseY: number
    rectLeft: number
    rectTop: number
    width: number
    height: number
  } | null>(null)

  // Register external visibility controller
  useEffect(() => {
    setGlobalVisibility = setVisible
    return () => {
      setGlobalVisibility = null
    }
  }, [])

  // Sync with settings
  useEffect(() => {
    loadSettings().then(settings => {
      setVisible(settings.captureOverlayEnabled)
    })

    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName === 'local' && (changes.pentone_settings || changes.pentone_legacy_settings)) {
        const newSettings = changes.pentone_settings?.newValue || changes.pentone_legacy_settings?.newValue
        if (newSettings && typeof newSettings.captureOverlayEnabled === 'boolean') {
          setVisible(newSettings.captureOverlayEnabled)
        }
      }
    }

    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(handleStorageChange)
      return () => {
        chrome.storage.onChanged.removeListener(handleStorageChange)
      }
    }
  }, [])

  // Load saved position preference if exists
  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get(['pentone_overlay_position'], (res) => {
        const saved = res?.pentone_overlay_position as OverlayPosition | undefined
        if (
          saved &&
          (saved.side === 'right' || saved.side === 'left') &&
          typeof saved.offset === 'number' &&
          typeof saved.top === 'number'
        ) {
          const pillWidth = 105
          const pillHeight = 36
          const maxOffset = Math.max(12, window.innerWidth - pillWidth - 12)
          const maxTop = Math.max(12, window.innerHeight - pillHeight - 12)

          setPosition({
            side: saved.side,
            offset: Math.min(Math.max(12, saved.offset), maxOffset),
            top: Math.min(Math.max(12, saved.top), maxTop)
          })
        }
      })
    }
  }, [])

  // Responsive window resize and DOM observation
  // Automatically clamps position and keeps floating pill inside the active viewport
  useEffect(() => {
    const handleResize = () => {
      setPosition((prev) => {
        const pillWidth = pillRef.current?.offsetWidth || 105
        const pillHeight = pillRef.current?.offsetHeight || 36

        const maxOffset = Math.max(12, window.innerWidth - pillWidth - 12)
        const maxTop = Math.max(12, window.innerHeight - pillHeight - 12)

        const clampedOffset = Math.min(Math.max(12, prev.offset), maxOffset)
        const clampedTop = Math.min(Math.max(12, prev.top), maxTop)

        if (clampedOffset !== prev.offset || clampedTop !== prev.top) {
          return {
            ...prev,
            offset: clampedOffset,
            top: clampedTop
          }
        }
        return prev
      })
    }

    window.addEventListener('resize', handleResize)

    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined' && document.documentElement) {
      ro = new ResizeObserver(() => {
        handleResize()
      })
      ro.observe(document.documentElement)
    }

    return () => {
      window.removeEventListener('resize', handleResize)
      ro?.disconnect()
    }
  }, [])

  // Drag start handler (supports mouse and touch)
  const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY

    const rect = pillRef.current?.getBoundingClientRect()
    if (!rect) return

    dragStartRef.current = {
      mouseX: clientX,
      mouseY: clientY,
      rectLeft: rect.left,
      rectTop: rect.top,
      width: rect.width,
      height: rect.height
    }

    setDragCoords({ x: rect.left, y: rect.top })
    setIsDragging(true)
  }

  // Dragging event listeners
  useEffect(() => {
    if (!isDragging) return

    const handlePointerMove = (clientX: number, clientY: number) => {
      if (!dragStartRef.current) return
      const { mouseX, mouseY, rectLeft, rectTop, width, height } = dragStartRef.current
      const deltaX = clientX - mouseX
      const deltaY = clientY - mouseY

      const maxX = Math.max(10, window.innerWidth - width - 10)
      const maxY = Math.max(10, window.innerHeight - height - 10)

      const newX = Math.min(Math.max(10, rectLeft + deltaX), maxX)
      const newY = Math.min(Math.max(10, rectTop + deltaY), maxY)

      setDragCoords({ x: newX, y: newY })
    }

    const onMouseMove = (e: MouseEvent) => {
      handlePointerMove(e.clientX, e.clientY)
    }

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        handlePointerMove(e.touches[0].clientX, e.touches[0].clientY)
      }
    }

    const onPointerUp = () => {
      setIsDragging(false)
      setDragCoords((coords) => {
        if (coords) {
          const width = dragStartRef.current?.width || pillRef.current?.offsetWidth || 105
          const height = dragStartRef.current?.height || pillRef.current?.offsetHeight || 36
          const centerX = coords.x + width / 2
          const isRightSide = centerX >= window.innerWidth / 2

          let newPos: OverlayPosition
          if (isRightSide) {
            // Anchor to right edge so it remains responsive to sidebar width changes
            const rightOffset = Math.max(12, Math.min(window.innerWidth - (coords.x + width), window.innerWidth - width - 12))
            const topOffset = Math.max(12, Math.min(coords.y, window.innerHeight - height - 12))
            newPos = { side: 'right', offset: rightOffset, top: topOffset }
          } else {
            // Anchor to left edge
            const leftOffset = Math.max(12, Math.min(coords.x, window.innerWidth - width - 12))
            const topOffset = Math.max(12, Math.min(coords.y, window.innerHeight - height - 12))
            newPos = { side: 'left', offset: leftOffset, top: topOffset }
          }

          setPosition(newPos)

          // Persist position preference
          if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            chrome.storage.local.set({ pentone_overlay_position: newPos }).catch(() => {})
          }
        }
        return null
      })
      dragStartRef.current = null
    }

    window.addEventListener('mousemove', onMouseMove, { passive: true })
    window.addEventListener('mouseup', onPointerUp, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onPointerUp, { passive: true })

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onPointerUp)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onPointerUp)
    }
  }, [isDragging])

  // Poll for audio state
  useEffect(() => {
    const interval = setInterval(() => {
      setAudioCountdown(getAudioCountdown())
      setIsCapturingAudio(getIsCapturingAudio())
    }, 100)

    return () => clearInterval(interval)
  }, [])

  if (!visible) return null

  const isAtRight = position.side === 'right'

  const containerStyle: React.CSSProperties = isDragging && dragCoords
    ? {
        position: 'fixed',
        left: `${dragCoords.x}px`,
        top: `${dragCoords.y}px`,
        right: 'auto',
        zIndex: 2147483640,
        pointerEvents: 'auto',
        background: 'rgba(23, 24, 22, 0.94)',
        borderRadius: '9999px',
        border: '1px solid rgba(55, 56, 50, 0.85)',
        boxShadow: '0 16px 40px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(103, 226, 200, 0.35)',
        padding: '3px 5px',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: '4px',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        userSelect: 'none',
        transition: 'none',
        transform: 'scale(1.04)'
      }
    : {
        position: 'fixed',
        top: `${position.top}px`,
        ...(isAtRight
          ? { right: `${position.offset}px`, left: 'auto' }
          : { left: `${position.offset}px`, right: 'auto' }),
        zIndex: 2147483640,
        pointerEvents: 'auto',
        background: 'rgba(23, 24, 22, 0.94)',
        borderRadius: '9999px',
        border: '1px solid rgba(55, 56, 50, 0.85)',
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
        padding: '3px 5px',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: '4px',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        userSelect: 'none',
        transition: 'box-shadow 0.2s ease, transform 0.15s ease, right 0.25s cubic-bezier(0.16, 1, 0.3, 1), left 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        transform: 'scale(1)'
      }

  return (
    <div
      ref={pillRef}
      style={containerStyle}
    >
      {/* Drag handle */}
      <div
        onMouseDown={handleDragStart}
        onTouchStart={handleDragStart}
        onMouseEnter={() => setHoveredButton('grip')}
        onMouseLeave={() => setHoveredButton(null)}
        style={{
          cursor: isDragging ? 'grabbing' : 'grab',
          padding: '4px 3px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: hoveredButton === 'grip' || isDragging ? '#67E2C8' : '#77776E',
          transition: 'color 0.15s ease',
          touchAction: 'none'
        }}
        title="Drag to reposition (responsive to sidebar)"
      >
        <GripVertical size={14} strokeWidth={2.2} />
      </div>

      {/* Subtle vertical divider */}
      <div 
        style={{
          width: '1px',
          height: '16px',
          background: 'rgba(55, 56, 50, 0.7)',
          margin: '0 1px'
        }}
      />

      {/* Screenshot button */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          setCameraPressed(true)
          setTimeout(() => setCameraPressed(false), 200)
          onScreenshot()
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onMouseEnter={() => setHoveredButton('camera')}
        onMouseLeave={() => setHoveredButton(null)}
        style={{
          background: cameraPressed 
            ? 'rgba(103, 226, 200, 0.45)' 
            : (hoveredButton === 'camera' ? 'rgba(0, 84, 71, 0.38)' : 'transparent'),
          border: 'none',
          borderRadius: '9999px',
          width: '28px',
          height: '28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
          padding: '0',
          color: cameraPressed || hoveredButton === 'camera' ? '#67E2C8' : '#DDDCCB',
          transform: cameraPressed ? 'scale(0.88)' : (hoveredButton === 'camera' ? 'scale(1.08)' : 'scale(1)'),
          boxShadow: cameraPressed ? '0 0 12px rgba(103, 226, 200, 0.65)' : 'none'
        }}
        title="Capture Screenshot (Ctrl+Shift+S)"
      >
        <Camera size={14} strokeWidth={2} />
      </button>

      {/* Audio button */}
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
        onTouchStart={(e) => e.stopPropagation()}
        onMouseEnter={() => setHoveredButton('audio')}
        onMouseLeave={() => setHoveredButton(null)}
        style={{
          background: isCapturingAudio 
            ? 'linear-gradient(135deg, #EF4444, #DC2626)' 
            : (hoveredButton === 'audio' ? 'rgba(0, 84, 71, 0.38)' : 'transparent'),
          border: isCapturingAudio ? '1px solid rgba(255, 255, 255, 0.3)' : 'none',
          borderRadius: '9999px',
          width: '28px',
          height: '28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: 'all 0.18s ease',
          padding: '0',
          color: isCapturingAudio ? '#FFFFFF' : (hoveredButton === 'audio' ? '#67E2C8' : '#DDDCCB'),
          fontSize: isCapturingAudio && audioCountdown > 0 ? '12px' : 'inherit',
          fontWeight: isCapturingAudio && audioCountdown > 0 ? 700 : 'normal',
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
          boxShadow: isCapturingAudio ? '0 0 12px rgba(239, 68, 68, 0.6)' : 'none'
        }}
        title={isCapturingAudio && audioCountdown === 0 ? 'Stop Recording' : 'Record Tab Audio (Ctrl+Shift+A)'}
      >
        {isCapturingAudio ? (
          audioCountdown > 0 ? audioCountdown : <Square size={11} strokeWidth={2.4} fill="white" />
        ) : (
          <Mic size={14} strokeWidth={2} />
        )}
      </button>
    </div>
  )
}

// Global callbacks
let globalOnScreenshot: (() => void) | null = null
let globalOnAudio: (() => void) | null = null
let overlayRoot: Root | null = null

const CaptureOverlayWrapper = () => {
  return (
    <CaptureOverlayButtons
      onScreenshot={() => globalOnScreenshot?.()}
      onAudio={() => globalOnAudio?.()}
    />
  )
}

export const setCaptureOverlayVisible = (visible: boolean) => {
  if (setGlobalVisibility) {
    setGlobalVisibility(visible)
  }
}

// Initialize the capture overlay buttons
export const initCaptureOverlayButtons = (onScreenshot: () => void, onAudio: () => void) => {
  globalOnScreenshot = onScreenshot
  globalOnAudio = onAudio

  const mount = () => {
    if (document.getElementById('pentone-capture-overlay-root')) {
      return
    }

    const container = document.createElement('div')
    container.id = 'pentone-capture-overlay-root'
    container.style.position = 'fixed'
    container.style.top = '0'
    container.style.left = '0'
    container.style.width = '0'
    container.style.height = '0'
    container.style.zIndex = '2147483640'
    container.style.pointerEvents = 'none'
    
    const rootEl = document.documentElement || document.body
    rootEl.appendChild(container)
    
    overlayRoot = createRoot(container)
    overlayRoot.render(<CaptureOverlayWrapper />)
    
    console.log('[Pentone] Capture overlay buttons initialized successfully')
  }

  if (document.body || document.documentElement) {
    mount()
  } else {
    document.addEventListener('DOMContentLoaded', mount)
  }
}
