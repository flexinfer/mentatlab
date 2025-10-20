import React from 'react';
import { cn } from '../../lib/cn';

export interface PanelShellProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: React.ReactNode;
  toolbar?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

export const PanelShell: React.FC<PanelShellProps> = ({ title, toolbar, className, children, ...props }) => {
  return (
    <div
      className={cn(
        'flex flex-col rounded-md border bg-white/50 dark:bg-zinc-900/50 backdrop-blur',
        className
      )}
      {...props}
    >
      {(title || toolbar) && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b">
          <div className="flex items-center gap-2">
            {title}
          </div>
          <div className="flex items-center gap-2">
            {toolbar}
          </div>
        </div>
      )}

      <div className="relative min-h-[200px]">
        {children}
      </div>
    </div>
  );
};
PanelShell.displayName = 'PanelShell';