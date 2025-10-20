import React from 'react';
import { cn } from '../../lib/cn';

export type ScrollOrientation = 'vertical' | 'horizontal' | 'both';

export interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: ScrollOrientation;
  className?: string;
  children?: React.ReactNode;
}

export const ScrollArea: React.FC<ScrollAreaProps> = ({ orientation = 'vertical', className, children, ...props }) => {
  const viewportClass =
    orientation === 'vertical'
      ? 'max-h-full overflow-y-auto'
      : orientation === 'horizontal'
      ? 'max-w-full overflow-x-auto'
      : 'overflow-auto';

  return (
    <div className={cn('relative', className)} {...props}>
      <div className={viewportClass}>
        {children}
      </div>
    </div>
  );
};
ScrollArea.displayName = 'ScrollArea';