import React from 'react';

export function CodeInline({ value, maxLength = 160, title }: { value: unknown; maxLength?: number; title?: string }) {
  let text: string;
  try {
    if (typeof value === 'string') {
      text = value;
    } else {
      text = JSON.stringify(value);
    }
  } catch {
    text = String(value);
  }
  const truncated = text.length > maxLength ? text.slice(0, maxLength) + '…' : text;

  return (
    <code
      className="font-mono text-[11px] whitespace-pre-wrap break-words bg-muted/40 rounded px-1 py-0.5"
      title={title ?? (text.length > maxLength ? text : undefined)}
    >
      {truncated}
    </code>
  );
}

export default CodeInline;