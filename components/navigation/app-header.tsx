import React from 'react'
import { 
  Mic, MessageSquare, Clock, Wrench, Brain, Settings, 
  Activity, Volume2, VolumeX, Maximize2, Sun, Moon, Sparkles 
} from 'lucide-react'
import { type Screen } from '../../lib/config'
import { useTheme } from '../../lib/theme-context'
import { MAX_CONTEXT_SIZE } from '../../lib/summarizer'

export interface AppHeaderProps {
  currentScreen: Screen
  onNavigate: (screen: Screen) => void
  contextCount?: number
  audioEnabled?: boolean
  onToggleAudio?: () => void
  onOpenSidePanel?: () => void
  statusDot?: 'ready' | 'listening' | 'processing' | 'error'
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  currentScreen,
  onNavigate,
  contextCount = 0,
  audioEnabled = true,
  onToggleAudio,
  onOpenSidePanel,
  statusDot = 'ready'
}) => {
  const { effectiveTheme, setTheme } = useTheme()

  const navItems = [
    { screen: 'main' as Screen, label: 'Voice', icon: <Mic className="w-3.5 h-3.5" /> },
    { screen: 'chat' as Screen, label: 'Chat', icon: <MessageSquare className="w-3.5 h-3.5" /> },
    { screen: 'history' as Screen, label: 'History', icon: <Clock className="w-3.5 h-3.5" /> },
    { screen: 'tools' as Screen, label: 'Tools', icon: <Wrench className="w-3.5 h-3.5" /> },
    { screen: 'memory' as Screen, label: 'Memory', icon: <Brain className="w-3.5 h-3.5" /> },
    { screen: 'settings' as Screen, label: 'Settings', icon: <Settings className="w-3.5 h-3.5" /> },
    { screen: 'diagnostics' as Screen, label: 'Diagnostics', icon: <Activity className="w-3.5 h-3.5" /> }
  ]

  const statusDotColor = {
    ready: 'bg-emerald-500 shadow-emerald-500/50',
    listening: 'bg-rose-500 shadow-rose-500/50 animate-pulse',
    processing: 'bg-amber-500 shadow-amber-500/50 animate-spin',
    error: 'bg-red-500'
  }[statusDot]

  return (
    <header className="flex-shrink-0 border-b border-[#DDDCCB] dark:border-[#373832] bg-[#FFFEEF]/90 dark:bg-[#171816]/90 backdrop-blur-md z-30 select-none">
      {/* Brand row */}
      <div className="px-3.5 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => onNavigate('main')}>
          <div className="flex items-center">
            <span className="font-display text-lg font-bold tracking-tight text-[#191919] dark:text-[#F5F1E7]">
              Pentone
            </span>
          </div>

          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#F3F1DF] dark:bg-[#22231F] border border-[#DDDCCB] dark:border-[#373832] text-[10px] text-[#56564E] dark:text-[#A6A49B]">
            <span className={`w-1.5 h-1.5 rounded-full ${statusDotColor}`} />
            <span className="font-sans font-medium uppercase tracking-wider text-[9px]">
              {statusDot}
            </span>
          </div>
        </div>

        {/* Right utility actions */}
        <div className="flex items-center gap-1">
          {/* Context gauge */}
          <div 
            className="relative group p-1.5 text-[#56564E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] cursor-help"
            title={`Context Budget: ${contextCount}/${MAX_CONTEXT_SIZE} tokens`}
          >
            <svg width="18" height="18" viewBox="0 0 20 20" className="transform -rotate-90">
              <circle
                cx="10"
                cy="10"
                r="7"
                fill="none"
                stroke="currentColor"
                strokeOpacity="0.2"
                strokeWidth="2.5"
              />
              {contextCount > 0 && (
                <circle
                  cx="10"
                  cy="10"
                  r="7"
                  fill="none"
                  stroke={contextCount > 7000 ? "#EF4444" : contextCount > 5000 ? "#F59E0B" : "#005447"}
                  strokeWidth="2.5"
                  strokeDasharray={`${(contextCount / MAX_CONTEXT_SIZE) * 43.98} 43.98`}
                  strokeLinecap="round"
                  className="transition-all duration-300"
                />
              )}
            </svg>
            <div className="absolute right-0 top-full mt-1 px-2 py-1 bg-[#191919] text-[#FFFEEF] dark:bg-[#F5F1E7] dark:text-[#191919] rounded text-[10px] font-mono whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-md">
              {contextCount} / {MAX_CONTEXT_SIZE} tokens
            </div>
          </div>

          {/* Theme switcher */}
          <button
            onClick={() => setTheme(effectiveTheme === 'dark' ? 'light' : 'dark')}
            className="p-1.5 rounded-md hover:bg-[#F3F1DF] dark:hover:bg-[#22231F] text-[#56564E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] transition-colors"
            title={`Switch to ${effectiveTheme === 'dark' ? 'Light' : 'Dark'} theme`}
          >
            {effectiveTheme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Audio toggle */}
          {onToggleAudio && (
            <button
              onClick={onToggleAudio}
              className="p-1.5 rounded-md hover:bg-[#F3F1DF] dark:hover:bg-[#22231F] text-[#56564E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] transition-colors"
              title={audioEnabled ? "Mute speech audio" : "Unmute speech audio"}
            >
              {audioEnabled ? <Volume2 className="w-4 h-4 text-[#005447] dark:text-[#67E2C8]" /> : <VolumeX className="w-4 h-4" />}
            </button>
          )}

          {/* Side panel popout */}
          {onOpenSidePanel && (
            <button
              onClick={onOpenSidePanel}
              className="p-1.5 rounded-md hover:bg-[#F3F1DF] dark:hover:bg-[#22231F] text-[#56564E] hover:text-[#191919] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] transition-colors"
              title="Open full Side Panel"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Navigation tabs row */}
      <nav className="px-2 pb-1.5 flex items-center gap-1 overflow-x-auto no-scrollbar">
        {navItems.map((item) => {
          const isActive = currentScreen === item.screen || (item.screen === 'diagnostics' && currentScreen === 'debug')
          return (
            <button
              key={item.screen}
              onClick={() => onNavigate(item.screen)}
              className={`px-2.5 py-1 rounded-md text-xs font-sans font-medium flex items-center gap-1.5 transition-all shrink-0 ${
                isActive
                  ? 'bg-[#E9D2FF] text-[#191919] font-semibold border border-[#D5B5F5] dark:bg-[#CDB0F3] dark:text-[#171816] dark:border-[#BFA0E6] shadow-xs'
                  : 'text-[#56564E] hover:text-[#191919] hover:bg-[#F3F1DF] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7] dark:hover:bg-[#22231F]'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>
    </header>
  )
}
