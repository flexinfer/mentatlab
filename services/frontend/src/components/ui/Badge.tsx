import React from 'react';

export type BadgeVariant = 'default' | 'info' | 'success' | 'warning' | 'danger';

export function Badge({ variant = 'default', children, title }: { variant?: BadgeVariant; children: React.ReactNode; title?: string }) {
  const cls = (() => {
    switch (variant) {
      case 'info':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20 shadow-[0_0_10px_rgba(59,130,246,0.1)]';
      case 'success':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.1)]';
      case 'warning':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/20 shadow-[0_0_10px_rgba(245,158,11,0.1)]';
      case 'danger':
        return 'bg-red-500/10 text-red-400 border-red-500/20 shadow-[0_0_10px_rgba(239,68,68,0.1)]';
      default:
        return 'bg-white/5 text-gray-300 border-white/10';
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