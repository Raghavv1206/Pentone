import React from 'react'
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
    color: '#005447'
  },
  {
    id: 'longer',
    label: 'Expand',
    icon: <Maximize2 size={13} />,
    prompt: 'make this longer and more detailed',
    color: '#8b5cf6'
  },
  {
    id: 'professional',
    label: 'Professional',
    icon: <Briefcase size={13} />,
    prompt: 'make this more professional and formal',
    color: '#0284c7'
  },
  {
    id: 'friendly',
    label: 'Friendly',
    icon: <Smile size={13} />,
    prompt: 'make this more friendly and casual',
    color: '#d97706'
  },
  {
    id: 'improve',
    label: 'Improve',
    icon: <Sparkles size={13} />,
    prompt: 'improve this text and fix any grammar issues',
    color: '#10b981'
  },
  {
    id: 'simplify',
    label: 'Simplify',
    icon: <Zap size={13} />,
    prompt: 'simplify this and make it easier to understand',
    color: '#e11d48'
  },
  {
    id: 'enthusiastic',
    label: 'Enthusiastic',
    icon: <ThumbsUp size={13} />,
    prompt: 'make this more enthusiastic and positive',
    color: '#ec4899'
  },
  {
    id: 'conversational',
    label: 'Conversational',
    icon: <MessageCircle size={13} />,
    prompt: 'make this more conversational and natural',
    color: '#0d9488'
  }
]

interface RewriterPresetsProps {
  onPresetClick: (preset: PresetAction) => void
  disabled?: boolean
  isDark?: boolean
}

export const RewriterPresets: React.FC<RewriterPresetsProps> = ({ 
  onPresetClick, 
  disabled = false,
  isDark = false
}) => {
  const borderSubtle = isDark ? '#373832' : '#DDDCCB'
  const borderControl = isDark ? '#6D6E63' : '#878571'
  const textSecondary = isDark ? '#A6A49B' : '#56564E'
  const textPrimary = isDark ? '#F5F1E7' : '#191919'
  const surfaceInput = isDark ? '#1E1F1B' : '#FAF8E8'
  const surfaceElevated = isDark ? '#2D2E29' : '#E8E5CE'
  const accent = isDark ? '#67E2C8' : '#005447'

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '5px',
      padding: '4px 0'
    }}>
      {REWRITER_PRESETS.map((preset) => (
        <button
          key={preset.id}
          onClick={() => onPresetClick(preset)}
          disabled={disabled}
          style={{
            background: surfaceInput,
            border: `1px solid ${borderControl}`,
            borderRadius: '8px',
            padding: '6px 4px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '3px',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.45 : 1,
            transition: 'all 0.15s ease',
            fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
            fontSize: '10px',
            fontWeight: 600,
            color: textSecondary
          }}
          onMouseEnter={(e) => {
            if (!disabled) {
              e.currentTarget.style.background = surfaceElevated
              e.currentTarget.style.borderColor = accent
              e.currentTarget.style.color = textPrimary
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = surfaceInput
            e.currentTarget.style.borderColor = borderSubtle
            e.currentTarget.style.color = textSecondary
          }}
        >
          <div style={{ 
            color: accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
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
      ))}
    </div>
  )
}
