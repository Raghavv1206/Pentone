import React from 'react'

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
  variant?: 'default' | 'elevated' | 'subtle' | 'forest'
  className?: string
}

export const Card: React.FC<CardProps> = ({
  children,
  variant = 'default',
  className = '',
  ...props
}) => {
  const baseStyles = 'rounded-xl transition-all duration-150'

  const variantStyles = {
    default: 'bg-[#F3F1DF] text-[#191919] border border-[#DDDCCB] dark:bg-[#22231F] dark:text-[#F5F1E7] dark:border-[#373832] shadow-sm',
    elevated: 'bg-[#FFFEEF] text-[#191919] border border-[#DDDCCB] dark:bg-[#1E1F1B] dark:text-[#F5F1E7] dark:border-[#373832] shadow-md',
    subtle: 'bg-[#F3F1DF]/50 text-[#191919] border border-[#DDDCCB]/60 dark:bg-[#22231F]/50 dark:text-[#F5F1E7] dark:border-[#373832]/60',
    forest: 'bg-[#005447] text-[#FFFEEF] border border-[#003F36] dark:bg-[#07584B] dark:text-[#F5F1E7] dark:border-[#064238] shadow-md'
  }[variant]

  return (
    <div className={`${baseStyles} ${variantStyles} ${className}`} {...props}>
      {children}
    </div>
  )
}
