import React from 'react';
import { cn } from '../../lib/cn';

export type InputSize = 'sm' | 'md' | 'lg';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: InputSize;
  className?: string;
}

const sizeMap: Record<InputSize, string> = {
  sm: 'h-8 text-sm',
  md: 'h-10 text-sm',
  lg: 'h-11 text-base',
};

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ size = 'md', className, ...props }, ref) => {
  return (
    <input
      ref={ref}
      className={cn(
        'w-full rounded-lg border border-white/10 bg-white/5 px-3 outline-none ring-0 focus-visible:ring-2 focus-visible:ring-primary/50 text-foreground placeholder:text-muted-foreground transition-all duration-200',
        sizeMap[size],
        className
      )}
      {...props}
    />
  );
});
Input.displayName = 'Input';