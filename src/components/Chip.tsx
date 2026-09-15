import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean
  children: ReactNode
}

/**
 * Section 9: Chip / Selector Component
 * Formalized selection chip matching the Femi9 Design System.
 */
export function Chip({ selected, children, className = '', ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`chip-opt${selected ? ' on' : ''}${className ? ` ${className}` : ''}`}
      {...props}
    >
      {children}
    </button>
  )
}
