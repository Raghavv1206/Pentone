import React from 'react'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'lavender' | 'forest' | 'secondary' | 'ghost' | 'danger'
  size?: 'xs' | 'sm' | 'md' | 'lg'
  icon?: React.ReactNode
  loading?: boolean
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  className = '',
  disabled,
  ...props
}) => {
  const baseStyles = 'inline-flex items-center justify-center font-sans font-medium transition-all duration-150 rounded-lg select-none focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]'
  
  const sizeStyles = {
    xs: 'px-2 py-1 text-xs gap-1.5',
    sm: 'px-2.5 py-1.5 text-xs gap-1.5',
    md: 'px-3.5 py-2 text-sm gap-2',
    lg: 'px-4 py-2.5 text-base gap-2.5'
  }[size]

  const variantStyles = {
    lavender: 'bg-[#E9D2FF] hover:bg-[#DFC2FA] text-[#191919] border border-[#D5B5F5] dark:bg-[#CDB0F3] dark:hover:bg-[#C2A1E8] dark:text-[#171816] dark:border-[#BFA0E6] shadow-sm font-semibold',
    forest: 'bg-[#005447] hover:bg-[#003F36] text-[#FFFEEF] border border-[#003F36] dark:bg-[#07584B] dark:hover:bg-[#064238] dark:text-[#F5F1E7] dark:border-[#064238] shadow-sm',
    secondary: 'bg-[#F3F1DF] hover:bg-[#EBE7D0] text-[#191919] border border-[#878571] dark:bg-[#22231F] dark:hover:bg-[#2A2B26] dark:text-[#F5F1E7] dark:border-[#6D6E63] shadow-sm',
    ghost: 'bg-transparent hover:bg-[#F3F1DF] text-[#56564E] hover:text-[#191919] dark:hover:bg-[#22231F] dark:text-[#A6A49B] dark:hover:text-[#F5F1E7]',
    danger: 'bg-rose-100 hover:bg-rose-200 text-rose-900 border border-rose-300 dark:bg-rose-950/70 dark:hover:bg-rose-900/70 dark:text-rose-200 dark:border-rose-800'
  }[variant]

  return (
    <button
      className={`${baseStyles} ${sizeStyles} ${variantStyles} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />
      ) : icon ? (
        <span className="shrink-0">{icon}</span>
      ) : null}
      {children}
    </button>
  )
}
