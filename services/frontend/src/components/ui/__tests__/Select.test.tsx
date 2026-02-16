import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Select } from '../Select';

describe('Select', () => {
  it('renders with options', () => {
    render(
      <Select data-testid="select">
        <option value="a">Option A</option>
        <option value="b">Option B</option>
        <option value="c">Option C</option>
      </Select>
    );
    const select = screen.getByTestId('select');
    expect(select).toBeInTheDocument();
    expect(screen.getByText('Option A')).toBeInTheDocument();
    expect(screen.getByText('Option B')).toBeInTheDocument();
    expect(screen.getByText('Option C')).toBeInTheDocument();
  });

  it('renders with sm size', () => {
    render(
      <Select size="sm" data-testid="select">
        <option>A</option>
      </Select>
    );
    const select = screen.getByTestId('select');
    expect(select.className).toContain('h-8');
  });

  it('renders with md size (default)', () => {
    render(
      <Select data-testid="select">
        <option>A</option>
      </Select>
    );
    const select = screen.getByTestId('select');
    expect(select.className).toContain('h-10');
  });

  it('renders with lg size', () => {
    render(
      <Select size="lg" data-testid="select">
        <option>A</option>
      </Select>
    );
    const select = screen.getByTestId('select');
    expect(select.className).toContain('h-11');
    expect(select.className).toContain('text-base');
  });

  it('forwards ref', () => {
    const ref = React.createRef<HTMLSelectElement>();
    render(
      <Select ref={ref}>
        <option>A</option>
      </Select>
    );
    expect(ref.current).toBeInstanceOf(HTMLSelectElement);
  });

  it('handles onChange', () => {
    const handleChange = vi.fn();
    render(
      <Select data-testid="select" onChange={handleChange}>
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>
    );
    fireEvent.change(screen.getByTestId('select'), { target: { value: 'b' } });
    expect(handleChange).toHaveBeenCalledTimes(1);
  });

  it('applies className', () => {
    render(
      <Select className="my-select" data-testid="select">
        <option>A</option>
      </Select>
    );
    const select = screen.getByTestId('select');
    expect(select.className).toContain('my-select');
  });
});
