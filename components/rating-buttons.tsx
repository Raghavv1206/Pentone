import React from "react"
import { ThumbsUp, ThumbsDown } from "lucide-react"

interface RatingButtonsProps {
  messageId: string
  currentRating?: 'up' | 'down' | null
  onRate: (messageId: string, rating: 'up' | 'down') => void
  size?: 'sm' | 'md'
}

export const RatingButtons: React.FC<RatingButtonsProps> = ({ 
  messageId, 
  currentRating, 
  onRate, 
  size = 'sm' 
}) => {
  const iconSize = size === 'sm' ? 'w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0' : 'w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0'
  const padding = size === 'sm' ? 'p-1' : 'p-1.5'

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onRate(messageId, 'up')}
        className={`${padding} rounded-lg hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] transition-colors`}
        title="Helpful response"
      >
        <ThumbsUp 
          className={`${iconSize} transition-colors ${
            currentRating === 'up' 
              ? 'text-emerald-600 dark:text-emerald-400 fill-current' 
              : 'text-[#77776E] dark:text-[#A6A49B] hover:text-emerald-600 dark:hover:text-emerald-400'
          }`}
        />
      </button>
      <button
        onClick={() => onRate(messageId, 'down')}
        className={`${padding} rounded-lg hover:bg-[#EBE7D0] dark:hover:bg-[#2A2B26] transition-colors`}
        title="Unhelpful response"
      >
        <ThumbsDown 
          className={`${iconSize} transition-colors ${
            currentRating === 'down' 
              ? 'text-rose-600 dark:text-rose-400 fill-current' 
              : 'text-[#77776E] dark:text-[#A6A49B] hover:text-rose-600 dark:hover:text-rose-400'
          }`}
        />
      </button>
    </div>
  )
}
