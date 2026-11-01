import React from "react"
import { ThumbsUp, ThumbsDown } from "lucide-react"

interface RatingButtonsProps {
  messageId: string
  currentRating?: 'up' | 'down' | null
  onRate: (messageId: string, rating: 'up' | 'down') => void
  size?: 'sm' | 'md'
}

export const RatingButtons = ({ messageId, currentRating, onRate, size = 'sm' }: RatingButtonsProps) => {
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'
  const padding = size === 'sm' ? 'p-1' : 'p-2'
  const rounded = size === 'sm' ? 'rounded' : 'rounded-full'

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => onRate(messageId, 'up')}
        className={`${padding} hover:bg-[#E8E5CE] dark:hover:bg-[#2D2E29] ${rounded} transition-colors`}
        title="Good response"
      >
        <ThumbsUp 
          className={`${iconSize} ${currentRating === 'up' ? 'text-emerald-600 dark:text-emerald-400 fill-emerald-600 dark:fill-emerald-400' : 'text-[#56564E] dark:text-[#A6A49B] hover:text-emerald-600 dark:hover:text-emerald-400'}`}
        />
      </button>
      <button
        onClick={() => onRate(messageId, 'down')}
        className={`${padding} hover:bg-[#E8E5CE] dark:hover:bg-[#2D2E29] ${rounded} transition-colors`}
        title="Bad response"
      >
        <ThumbsDown 
          className={`${iconSize} ${currentRating === 'down' ? 'text-rose-600 dark:text-rose-400 fill-rose-600 dark:fill-rose-400' : 'text-[#56564E] dark:text-[#A6A49B] hover:text-rose-600 dark:hover:text-rose-400'}`}
        />
      </button>
    </div>
  )
}
