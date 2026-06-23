import React from 'react';
import { cn } from '../../lib/cn';

export interface PanelShellProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  toolbar?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

export const PanelShell: React.FC<PanelShellProps> = ({ title, toolbar, className, children, ...props }) => {
  return (
    <div
      className={cn(
        'mc-shell flex flex-col rounded-md',
        className
      )}
      {...props}
    >
      {(title || toolbar) && (
        <div className="mc-shell-header flex items-center justify-between gap-2 border-b px-3 py-2">
          <div className="flex items-center gap-2">
            {title}
          </div>
          <div className="flex items-center gap-2">
            {toolbar}
          </div>
        </div>
      )}

      <div className="relative flex-1 min-h-0 min-w-0">
        {children}
      </div>
    </div>
  );
};
PanelShell.displayName = 'PanelShell';
