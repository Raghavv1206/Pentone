import { useEffect, useState, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { Send, Sparkles } from 'lucide-react'
import { useInjectedTheme } from '~lib/theme-context'

interface TooltipPosition {
  x: number
  y: number
}

interface SelectionInfo {
  text: string
  element: string
}

export const TextSelectionTooltip = () => {
  const [position, setPosition] = useState<TooltipPosition | null>(null)
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(null)
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const { effectiveTheme } = useInjectedTheme()
  const isDark = effectiveTheme === 'dark'

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
      if (target.closest('.pentone-selection-tooltip, .marionette-selection-tooltip')) {
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

  const handlePlusClick = () => {
    console.log('Plus clicked with:', { selectionInfo, inputValue })
  }

  const handleSendClick = () => {
    if (!selectionInfo) return
    const referenceData = {
      text: selectionInfo.text,
      explanation: inputValue ? `Question: ${inputValue}` : 'Analyze selection',
      timestamp: Date.now()
    }
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ chat_reference: referenceData }, () => {
        chrome.runtime.sendMessage({ type: 'open_popup' }).catch(() => {})
      })
    }
    setPosition(null)
    setSelectionInfo(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSendClick()
    }
  }

  if (!position || !selectionInfo) {
    return null
  }

  const bg = isDark ? 'rgba(23, 24, 22, 0.95)' : 'rgba(255, 254, 239, 0.96)'
  const border = isDark ? '1px solid #6D6E63' : '1px solid #878571'
  const textPrimary = isDark ? '#F5F1E7' : '#191919'
  const textSecondary = isDark ? '#A6A49B' : '#56564E'
  const accent = isDark ? '#67E2C8' : '#005447'
  const shadow = isDark ? '0 8px 30px rgba(0, 0, 0, 0.45)' : '0 8px 24px rgba(25, 25, 25, 0.1)'

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
        fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif"
      }}
    >
      <div
        style={{
          background: bg,
          borderRadius: '9999px',
          border,
          boxShadow: shadow,
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 8px',
          minWidth: '280px',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)'
        }}
      >
        <button
          onClick={handlePlusClick}
          style={{
            background: 'transparent',
            border: 'none',
            color: textSecondary,
            cursor: 'pointer',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '9999px',
            transition: 'all 0.15s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = textPrimary
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = textSecondary
          }}
          title="Add context"
        >
          <Sparkles size={13} color={accent} />
        </button>
        
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask Pentone about selection..."
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            color: textPrimary,
            fontSize: '12px',
            outline: 'none',
            padding: '4px 2px',
            fontFamily: 'inherit'
          }}
        />
        
        <button
          onClick={handleSendClick}
          style={{
            background: accent,
            border: 'none',
            color: isDark ? '#171816' : '#FFFFFF',
            cursor: 'pointer',
            padding: '5px 8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '9999px',
            transition: 'opacity 0.15s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '0.9'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '1'
          }}
          title="Send query"
        >
          <Send size={11} />
        </button>
      </div>
    </div>
  )
}

export const initTextSelectionTooltip = () => {
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
  
  console.log('Pentone: Text selection tooltip initialized')
}
