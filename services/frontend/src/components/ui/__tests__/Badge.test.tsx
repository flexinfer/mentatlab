import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Badge } from '../Badge';

describe('Badge', () => {
  it('renders with default variant', () => {
    render(<Badge>Default</Badge>);
    const badge = screen.getByText('Default');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-white/5');
    expect(badge.className).toContain('text-gray-300');
  });

  it('renders info variant with correct classes', () => {
    render(<Badge variant="info">Info</Badge>);
    const badge = screen.getByText('Info');
    expect(badge.className).toContain('bg-blue-500/10');
    expect(badge.className).toContain('text-blue-400');
  });

  it('renders success variant with correct classes', () => {
    render(<Badge variant="success">Success</Badge>);
    const badge = screen.getByText('Success');
    expect(badge.className).toContain('bg-emerald-500/10');
    expect(badge.className).toContain('text-emerald-400');
  });

  it('renders warning variant with correct classes', () => {
    render(<Badge variant="warning">Warning</Badge>);
    const badge = screen.getByText('Warning');
    expect(badge.className).toContain('bg-amber-500/10');
    expect(badge.className).toContain('text-amber-400');
  });

  it('renders danger variant with correct classes', () => {
    render(<Badge variant="danger">Danger</Badge>);
    const badge = screen.getByText('Danger');
    expect(badge.className).toContain('bg-red-500/10');
    expect(badge.className).toContain('text-red-400');
  });

  it('renders children', () => {
    render(
      <Badge>
        <span data-testid="child">Child content</span>
      </Badge>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByText('Child content')).toBeInTheDocument();
  });

  it('passes title prop', () => {
    render(<Badge title="Badge tooltip">Hoverable</Badge>);
    const badge = screen.getByText('Hoverable');
    expect(badge).toHaveAttribute('title', 'Badge tooltip');
  });
});
