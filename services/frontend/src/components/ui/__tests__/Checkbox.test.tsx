import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Checkbox } from '../checkbox';

describe('Checkbox', () => {
  it('renders checkbox input', () => {
    render(<Checkbox />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).toHaveAttribute('type', 'checkbox');
  });

  it('renders label when provided', () => {
    render(<Checkbox label="Accept terms" />);
    expect(screen.getByText('Accept terms')).toBeInTheDocument();
    // Label should be associated with checkbox
    const checkbox = screen.getByRole('checkbox');
    const label = checkbox.closest('label');
    expect(label).toBeInTheDocument();
  });

  it('does not render label span when label not provided', () => {
    const { container } = render(<Checkbox />);
    const spans = container.querySelectorAll('span');
    expect(spans.length).toBe(0);
  });

  it('handles checked/unchecked state', () => {
    const handleChange = vi.fn();
    render(<Checkbox onChange={handleChange} />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(handleChange).toHaveBeenCalledTimes(1);
  });

  it('supports controlled checked state', () => {
    render(<Checkbox checked onChange={() => {}} />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();
  });

  it('supports disabled state', () => {
    render(<Checkbox disabled label="Disabled" />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeDisabled();
    // Parent label should have opacity class
    const label = checkbox.closest('label');
    expect(label?.className).toContain('opacity-50');
    expect(label?.className).toContain('cursor-not-allowed');
  });

  it('generates unique id with useId when no id provided', () => {
    render(<Checkbox label="Auto ID" />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox.id).toBeTruthy();
    // The label htmlFor should match the checkbox id
    const label = checkbox.closest('label');
    expect(label).toHaveAttribute('for', checkbox.id);
  });

  it('uses provided id', () => {
    render(<Checkbox id="my-checkbox" label="Custom ID" />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox.id).toBe('my-checkbox');
  });

  it('renders with sm size (default)', () => {
    const { container } = render(<Checkbox />);
    const checkbox = container.querySelector('input[type="checkbox"]');
    expect(checkbox?.className).toContain('h-3.5');
    expect(checkbox?.className).toContain('w-3.5');
  });

  it('renders with md size', () => {
    const { container } = render(<Checkbox size="md" />);
    const checkbox = container.querySelector('input[type="checkbox"]');
    expect(checkbox?.className).toContain('h-4');
    expect(checkbox?.className).toContain('w-4');
  });
});
