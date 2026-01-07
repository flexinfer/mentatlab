import React from 'react';
import { cn } from '../../lib/cn';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: string;
  size?: 'sm' | 'md';
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, size = 'sm', className, id, ...props }, ref) => {
    const checkboxId = id ?? React.useId();
    const sizeClasses = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';

    return (
      <label
        htmlFor={checkboxId}
        className={cn(
          'inline-flex items-center gap-1.5 cursor-pointer select-none',
          props.disabled && 'opacity-50 cursor-not-allowed',
          className
        )}
      >
        <input
          ref={ref}
          id={checkboxId}
          type="checkbox"
          className={cn(
            sizeClasses,
            'rounded border border-input bg-background',
            'checked:bg-primary checked:border-primary',
            'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-1',
            'transition-colors duration-150',
            'cursor-pointer disabled:cursor-not-allowed',
            // Remove default appearance and use custom styling
            'appearance-none',
            // Custom checkmark via pseudo-element trick with tailwind
            'relative',
            'checked:after:content-[""] checked:after:absolute checked:after:inset-0',
            'checked:after:bg-[url("data:image/svg+xml,%3csvg viewBox=%270 0 16 16%27 fill=%27white%27 xmlns=%27http://www.w3.org/2000/svg%27%3e%3cpath d=%27M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z%27/%3e%3c/svg%3e")]',
            'checked:after:bg-center checked:after:bg-no-repeat'
          )}
          {...props}
        />
        {label && (
          <span className="text-[11px] text-foreground">{label}</span>
        )}
      </label>
    );
  }
);
Checkbox.displayName = 'Checkbox';

export default Checkbox;
