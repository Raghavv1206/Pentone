import { useEffect, useState, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { SendHorizontal, Sparkles, MessageSquare, Wand2, X } from 'lucide-react'
import { PentoneLogo } from './pentone-logo'

interface TooltipPosition {
  x: number
  y: number
}

interface SelectionInfo {
  text: string
  element: string
}

const TextSelectionTooltip = () => {
  const [position, setPosition] = useState<TooltipPosition | null>(null)
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [isHoveredSend, setIsHoveredSend] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleSelection = () => {
      const selection = window.getSelection()
      
      if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        setPosition(null)
        setSelectionInfo(null)
        return
      }

      const selectedText = selection.toString().trim()
      const range = selection.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      
      const container = range.commonAncestorContainer
      const element = container.nodeType === Node.TEXT_NODE 
        ? container.parentElement 
        : container as Element
      
      const tagName = element?.tagName?.toLowerCase() || 'unknown'
      
      setPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + window.scrollY - 10
      })
      
      setSelectionInfo({
        text: selectedText,
        element: tagName
      })
      
      setInputValue('')
    }

    document.addEventListener('mouseup', handleSelection)
    document.addEventListener('keyup', handleSelection)
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('.pentone-selection-tooltip')) {
        return
      }
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) {
        setPosition(null)
        setSelectionInfo(null)
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside)

    return () => {
      document.removeEventListener('mouseup', handleSelection)
      document.removeEventListener('keyup', handleSelection)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  useEffect(() => {
    if (position && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [position])

  const handleSendClick = () => {
    if (!selectionInfo || !inputValue.trim()) return
    console.log('[Pentone Tooltip] Sending query with selection:', { selectionInfo, inputValue })
    
    // Save as chat reference and trigger extension sidepanel
    chrome.storage?.local?.set({
      chat_reference: {
        text: selectionInfo.text,
        explanation: inputValue.trim(),
        timestamp: Date.now()
      }
    }, () => {
      try {
        chrome.runtime?.sendMessage({ type: 'open_sidepanel' })
      } catch {}
    })
    
    setPosition(null)
    setSelectionInfo(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSendClick()
    } else if (e.key === 'Escape') {
      setPosition(null)
      setSelectionInfo(null)
    }
  }

  if (!position || !selectionInfo) {
    return null
  }

  return (
    <div
      className="pentone-selection-tooltip"
      style={{
        position: 'absolute',
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: 'translate(-50%, -100%)',
        zIndex: 2147483647,
        pointerEvents: 'auto',
        userSelect: 'none'
      }}
    >
      <div
        style={{
          background: 'rgba(23, 24, 22, 0.95)',
          borderRadius: '9999px',
          border: '1px solid rgba(55, 56, 50, 0.85)',
          boxShadow: '0 12px 36px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(103, 226, 200, 0.25)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '5px 8px 5px 10px',
          minWidth: '320px',
          maxWidth: '460px',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)'
        }}
      >
        {/* Pentone icon badge */}
        <PentoneLogo size={20} className="w-5 h-5 shrink-0" />
        
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask Pentone about this text..."
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            color: '#F5F1E7',
            fontSize: '12.5px',
            fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            outline: 'none',
            padding: '4px 2px'
          }}
        />
        
        <button
          onClick={handleSendClick}
          onMouseEnter={() => setIsHoveredSend(true)}
          onMouseLeave={() => setIsHoveredSend(false)}
          disabled={!inputValue.trim()}
          style={{
            background: inputValue.trim() 
              ? (isHoveredSend ? '#003F36' : '#005447') 
              : 'rgba(55, 56, 50, 0.4)',
            border: inputValue.trim() ? '1px solid rgba(103, 226, 200, 0.3)' : '1px solid transparent',
            color: inputValue.trim() ? '#67E2C8' : '#77776E',
            cursor: inputValue.trim() ? 'pointer' : 'default',
            padding: '5px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '9999px',
            width: '26px',
            height: '26px',
            transition: 'all 0.18s ease',
            flexShrink: 0
          }}
          title="Send to Pentone (Enter)"
        >
          <SendHorizontal size={13} strokeWidth={2.2} />
        </button>

        {/* Dismiss button */}
        <button
          onClick={() => {
            setPosition(null)
            setSelectionInfo(null)
          }}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#77776E',
            cursor: 'pointer',
            padding: '3px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '9999px',
            transition: 'color 0.15s ease',
            flexShrink: 0
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#F5F1E7')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#77776E')}
          title="Close (Esc)"
        >
          <X size={13} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}

// Initialize the tooltip
export const initTextSelectionTooltip = () => {
  const mount = () => {
    if (document.getElementById('pentone-selection-tooltip-root')) {
      return
    }

    const tooltipContainer = document.createElement('div')
    tooltipContainer.id = 'pentone-selection-tooltip-root'
    tooltipContainer.style.position = 'absolute'
    tooltipContainer.style.top = '0'
    tooltipContainer.style.left = '0'
    tooltipContainer.style.width = '0'
    tooltipContainer.style.height = '0'
    tooltipContainer.style.zIndex = '2147483647'
    tooltipContainer.style.pointerEvents = 'none'
    
    document.body.appendChild(tooltipContainer)
    
    const root = createRoot(tooltipContainer)
    root.render(<TextSelectionTooltip />)
    
    console.log('[Pentone] Text selection tooltip initialized')
  }

  if (document.body) {
    mount()
  } else {
    document.addEventListener('DOMContentLoaded', mount)
  }
}
