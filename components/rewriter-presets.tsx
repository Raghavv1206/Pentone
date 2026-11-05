import React, { useState } from 'react'
import { 
  Minimize2, 
  Maximize2, 
  Sparkles, 
  Smile, 
  Briefcase, 
  Zap,
  MessageCircle,
  ThumbsUp
} from 'lucide-react'

export interface PresetAction {
  id: string
  label: string
  icon: React.ReactNode
  prompt: string
  color: string
}

export const REWRITER_PRESETS: PresetAction[] = [
  {
    id: 'shorter',
    label: 'Shorter',
    icon: <Minimize2 size={13} />,
    prompt: 'make this shorter and more concise',
    color: '#67E2C8' // mint
  },
  {
    id: 'longer',
    label: 'Expand',
    icon: <Maximize2 size={13} />,
    prompt: 'make this longer and more detailed',
    color: '#93C5FD' // soft blue
  },
  {
    id: 'professional',
    label: 'Professional',
    icon: <Briefcase size={13} />,
    prompt: 'make this more professional and formal',
    color: '#6EE7B7' // emerald
  },
  {
    id: 'friendly',
    label: 'Friendly',
    icon: <Smile size={13} />,
    prompt: 'make this more friendly and casual',
    color: '#FDE047' // warm amber
  },
  {
    id: 'improve',
    label: 'Improve',
    icon: <Sparkles size={13} />,
    prompt: 'improve this text and fix any grammar issues',
    color: '#67E2C8' // mint
  },
  {
    id: 'simplify',
    label: 'Simplify',
    icon: <Zap size={13} />,
    prompt: 'simplify this and make it easier to understand',
    color: '#FCA5A5' // coral
  },
  {
    id: 'enthusiastic',
    label: 'Enthusiastic',
    icon: <ThumbsUp size={13} />,
    prompt: 'make this more enthusiastic and positive',
    color: '#F472B6' // rose
  },
  {
    id: 'conversational',
    label: 'Natural',
    icon: <MessageCircle size={13} />,
    prompt: 'make this more conversational and natural',
    color: '#5EEAD4' // teal
  }
]

interface RewriterPresetsProps {
  onPresetClick: (preset: PresetAction) => void
  disabled?: boolean
}

export const RewriterPresets: React.FC<RewriterPresetsProps> = ({ 
  onPresetClick, 
  disabled = false 
}) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '6px',
      padding: '4px 0'
    }}>
      {REWRITER_PRESETS.map((preset) => {
        const isHovered = hoveredId === preset.id
        return (
          <button
            key={preset.id}
            onClick={() => onPresetClick(preset)}
            onMouseEnter={() => setHoveredId(preset.id)}
            onMouseLeave={() => setHoveredId(null)}
            disabled={disabled}
            style={{
              background: isHovered ? 'rgba(0, 84, 71, 0.38)' : 'rgba(34, 35, 31, 0.75)',
              border: isHovered ? '1px solid #67E2C8' : '1px solid rgba(55, 56, 50, 0.75)',
              borderRadius: '8px',
              padding: '6px 4px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.4 : 1,
              transition: 'all 0.18s ease',
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              fontSize: '10.5px',
              fontWeight: 500,
              color: isHovered ? '#F5F1E7' : '#DDDCCB'
            }}
          >
            <div style={{ 
              color: isHovered ? '#67E2C8' : preset.color,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.18s'
            }}>
              {preset.icon}
            </div>
            <span style={{ 
              textAlign: 'center',
              lineHeight: '1.2',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '100%'
            }}>
              {preset.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
