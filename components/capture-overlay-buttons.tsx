import { useState, useEffect, useCallback } from 'react'
import { createRoot, Root } from 'react-dom/client'
import { Camera, Mic, GripVertical, Square, Sparkles } from 'lucide-react'
import { getAudioCountdown, getIsCapturingAudio, cancelAudioCapture } from './custom-text-selection'
import { loadSettings } from '../lib/settings'

interface CaptureOverlayButtonsProps {
  onScreenshot: () => void
  onAudio: () => void
}

let setGlobalVisibility: ((visible: boolean) => void) | null = null

const CaptureOverlayButtons = ({ onScreenshot, onAudio }: CaptureOverlayButtonsProps) => {
  const [visible, setVisible] = useState(true)
  const [position, setPosition] = useState({ 
    x: Math.max(20, window.innerWidth - 148), 
    y: 24 
  })
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [audioCountdown, setAudioCountdown] = useState(5)
  const [isCapturingAudio, setIsCapturingAudio] = useState(false)
  const [hoveredButton, setHoveredButton] = useState<'camera' | 'audio' | 'grip' | null>(null)

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

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    })
  }

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const maxX = Math.max(10, window.innerWidth - 130)
      const maxY = Math.max(10, window.innerHeight - 50)
      const newX = Math.min(Math.max(10, e.clientX - dragOffset.x), maxX)
      const newY = Math.min(Math.max(10, e.clientY - dragOffset.y), maxY)

      setPosition({ x: newX, y: newY })
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

  if (!visible) return null

  return (
    <div
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        zIndex: 2147483640,
        pointerEvents: 'auto',
        background: 'rgba(23, 24, 22, 0.94)',
        borderRadius: '9999px',
        border: '1px solid rgba(55, 56, 50, 0.85)',
        boxShadow: isDragging 
          ? '0 16px 40px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(103, 226, 200, 0.35)' 
          : '0 10px 30px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
        padding: '3px 5px',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: '4px',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        userSelect: 'none',
        transition: isDragging ? 'none' : 'box-shadow 0.2s ease, transform 0.15s ease',
        transform: isDragging ? 'scale(1.03)' : 'scale(1)'
      }}
    >
      {/* Drag handle */}
      <div
        onMouseDown={handleDragStart}
        onMouseEnter={() => setHoveredButton('grip')}
        onMouseLeave={() => setHoveredButton(null)}
        style={{
          cursor: isDragging ? 'grabbing' : 'grab',
          padding: '4px 3px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: hoveredButton === 'grip' || isDragging ? '#67E2C8' : '#77776E',
          transition: 'color 0.15s ease'
        }}
        title="Drag to reposition"
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
          onScreenshot()
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseEnter={() => setHoveredButton('camera')}
        onMouseLeave={() => setHoveredButton(null)}
        style={{
          background: hoveredButton === 'camera' ? 'rgba(0, 84, 71, 0.38)' : 'transparent',
          border: 'none',
          borderRadius: '9999px',
          width: '28px',
          height: '28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: 'all 0.18s ease',
          padding: '0',
          color: hoveredButton === 'camera' ? '#67E2C8' : '#DDDCCB'
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
    
    document.body.appendChild(container)
    
    overlayRoot = createRoot(container)
    overlayRoot.render(<CaptureOverlayWrapper />)
    
    console.log('[Pentone] Capture overlay buttons initialized successfully')
  }

  if (document.body) {
    mount()
  } else {
    document.addEventListener('DOMContentLoaded', mount)
  }
}
