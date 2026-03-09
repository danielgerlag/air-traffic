import { cn } from '../../lib/utils'
import { type ReactNode } from 'react'

interface BadgeProps {
  variant?: 'default' | 'success' | 'warning' | 'destructive'
  children: ReactNode
  className?: string
}

export function Badge({ variant = 'default', children, className }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
      {
        'bg-zinc-800 text-zinc-400': variant === 'default',
        'bg-emerald-900/50 text-emerald-400': variant === 'success',
        'bg-yellow-900/50 text-yellow-400': variant === 'warning',
        'bg-red-900/50 text-red-400': variant === 'destructive',
      },
      className
    )}>
      {children}
    </span>
  )
}
