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
        'flex flex-col rounded-md border border-border/70 bg-card/90 shadow-sm backdrop-blur',
        className
      )}
      {...props}
    >
      {(title || toolbar) && (
        <div className="flex items-center justify-between gap-2 border-b border-border/70 bg-muted/20 px-3 py-2">
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
