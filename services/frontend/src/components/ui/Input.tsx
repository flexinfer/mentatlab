import React from 'react';
import { cn } from '../../lib/cn';

export type InputSize = 'sm' | 'md' | 'lg';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
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
        'w-full rounded-md border bg-transparent px-3 outline-none ring-0 focus-visible:ring-2 focus-visible:ring-blue-500',
        sizeMap[size],
        className
      )}
      {...props}
    />
  );
});
Input.displayName = 'Input';