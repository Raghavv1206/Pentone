import React from 'react'

export interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'forest' | 'lavender' | 'success' | 'warning' | 'danger' | 'outline'
  size?: 'xs' | 'sm' | 'md'
  icon?: React.ReactNode
  className?: string
  title?: string
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'sm',
  icon,
  className = '',
  title
}) => {
  const baseStyles = 'inline-flex items-center gap-1.5 font-sans font-medium rounded-full select-none transition-colors'

  const sizeStyles = {
    xs: 'px-2 py-0.5 text-[10px]',
    sm: 'px-2.5 py-0.5 text-xs',
    md: 'px-3 py-1 text-xs'
  }[size]

  const variantStyles = {
    default: 'bg-[#F3F1DF] text-[#191919] border border-[#DDDCCB] dark:bg-[#22231F] dark:text-[#F5F1E7] dark:border-[#373832]',
    forest: 'bg-[#005447]/10 text-[#005447] border border-[#005447]/20 dark:bg-[#07584B]/20 dark:text-[#67E2C8] dark:border-[#07584B]/40',
    lavender: 'bg-[#E9D2FF]/60 text-[#4E2A7A] border border-[#E9D2FF] dark:bg-[#CDB0F3]/20 dark:text-[#DBC3FA] dark:border-[#CDB0F3]/40',
    success: 'bg-emerald-100 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/40',
    warning: 'bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/40',
    danger: 'bg-rose-100 text-rose-800 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/40',
    outline: 'bg-transparent text-[#56564E] border border-[#878571] dark:text-[#A6A49B] dark:border-[#6D6E63]'
  }[variant]

  return (
    <span className={`${baseStyles} ${sizeStyles} ${variantStyles} ${className}`} title={title}>
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{children}</span>
    </span>
  )
}
