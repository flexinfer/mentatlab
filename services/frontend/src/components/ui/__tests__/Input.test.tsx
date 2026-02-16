import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Input } from '../Input';

describe('Input', () => {
  it('renders with default size (md)', () => {
    render(<Input data-testid="input" />);
    const input = screen.getByTestId('input');
    expect(input).toBeInTheDocument();
    expect(input.className).toContain('h-10');
  });

  it('renders with sm size', () => {
    render(<Input size="sm" data-testid="input" />);
    const input = screen.getByTestId('input');
    expect(input.className).toContain('h-8');
  });

  it('renders with md size', () => {
    render(<Input size="md" data-testid="input" />);
    const input = screen.getByTestId('input');
    expect(input.className).toContain('h-10');
  });

  it('renders with lg size', () => {
    render(<Input size="lg" data-testid="input" />);
    const input = screen.getByTestId('input');
    expect(input.className).toContain('h-11');
    expect(input.className).toContain('text-base');
  });

  it('forwards ref', () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<Input ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it('handles onChange events', () => {
    const handleChange = vi.fn();
    render(<Input data-testid="input" onChange={handleChange} />);
    fireEvent.change(screen.getByTestId('input'), { target: { value: 'hello' } });
    expect(handleChange).toHaveBeenCalledTimes(1);
  });

  it('applies custom className', () => {
    render(<Input className="my-input" data-testid="input" />);
    const input = screen.getByTestId('input');
    expect(input.className).toContain('my-input');
  });

  it('supports disabled state', () => {
    render(<Input disabled data-testid="input" />);
    const input = screen.getByTestId('input');
    expect(input).toBeDisabled();
  });

  it('supports placeholder', () => {
    render(<Input placeholder="Enter text..." />);
    expect(screen.getByPlaceholderText('Enter text...')).toBeInTheDocument();
  });
});
