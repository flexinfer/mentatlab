import React from 'react';

export type BadgeVariant = 'default' | 'info' | 'success' | 'warning' | 'danger';

export function Badge({ variant = 'default', children, title }: { variant?: BadgeVariant; children: React.ReactNode; title?: string }) {
  const cls = (() => {
    switch (variant) {
      case 'info':
        return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-900/50';
      case 'success':
        return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-900/50';
      case 'warning':
        return 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-900/50';
      case 'danger':
        return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-900/50';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700';
    }
  })();

  return (
    <span
      className={['inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] leading-none', cls].join(' ')}
      title={title}
    >
      {children}
    </span>
  );
}

export default Badge;