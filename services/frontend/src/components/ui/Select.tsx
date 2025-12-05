import React from 'react';
import { cn } from '../../lib/cn';

export type SelectSize = 'sm' | 'md' | 'lg';

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: SelectSize;
  className?: string;
}

const sizeMap: Record<SelectSize, string> = {
  sm: 'h-8 text-sm',
  md: 'h-10 text-sm',
  lg: 'h-11 text-base',
};

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ size = 'md', className, children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={cn(
          'w-full rounded-md border bg-transparent pr-8 pl-3 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 appearance-none',
          sizeMap[size],
          className
        )}
        {...props}
      >
        {children}
      </select>
    );
  }
);
Select.displayName = 'Select';