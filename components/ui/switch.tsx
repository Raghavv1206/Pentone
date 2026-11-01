import React from 'react'

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label?: string
  description?: string
  id?: string
}

export const Switch: React.FC<SwitchProps> = ({
  checked,
  onChange,
  disabled = false,
  label,
  description,
  id
}) => {
  const switchId = id || `switch-${Math.random().toString(36).substring(2, 9)}`

  return (
    <div className="flex items-center justify-between gap-3 py-1">
      {(label || description) && (
        <label htmlFor={switchId} className="flex flex-col cursor-pointer select-none">
          {label && <span className="text-sm font-medium text-[#191919] dark:text-[#F5F1E7]">{label}</span>}
          {description && <span className="text-xs text-[#77776E] dark:text-[#A6A49B] mt-0.5 leading-relaxed">{description}</span>}
        </label>
      )}
      <button
        type="button"
        role="switch"
        id={switchId}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
          checked ? 'bg-[#005447] dark:bg-[#07584B]' : 'bg-[#DDDCCB] dark:bg-[#373832]'
        }`}
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[#FFFEEF] dark:bg-[#F5F1E7] shadow-sm ring-0 transition duration-200 ease-in-out ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  )
}
