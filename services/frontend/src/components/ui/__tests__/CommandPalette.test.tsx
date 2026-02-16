import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandPalette, type Command } from '../CommandPalette';

const makeCommands = (): Command[] => [
  {
    id: 'run',
    label: 'Run Flow',
    description: 'Execute the current flow',
    category: 'Flow',
    shortcut: 'Cmd+R',
    action: vi.fn(),
  },
  {
    id: 'save',
    label: 'Save Flow',
    description: 'Save the current flow',
    category: 'Flow',
    action: vi.fn(),
  },
  {
    id: 'toggle-dark',
    label: 'Toggle Dark Mode',
    description: 'Switch color theme',
    category: 'Settings',
    shortcut: 'Cmd+T',
    action: vi.fn(),
  },
  {
    id: 'disabled-cmd',
    label: 'Disabled Command',
    category: 'Settings',
    action: vi.fn(),
    disabled: true,
  },
];

describe('CommandPalette', () => {
  let commands: Command[];
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    commands = makeCommands();
    onClose = vi.fn();
  });

  it('returns null when isOpen=false', () => {
    const { container } = render(
      <CommandPalette commands={commands} isOpen={false} onClose={onClose} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders when isOpen=true', () => {
    render(<CommandPalette commands={commands} isOpen={true} onClose={onClose} />);
    expect(screen.getByPlaceholderText('Type a command or search...')).toBeInTheDocument();
    expect(screen.getByText('Run Flow')).toBeInTheDocument();
    expect(screen.getByText('Save Flow')).toBeInTheDocument();
    expect(screen.getByText('Toggle Dark Mode')).toBeInTheDocument();
  });

  it('filters commands based on search query', () => {
    render(<CommandPalette commands={commands} isOpen={true} onClose={onClose} />);
    const input = screen.getByPlaceholderText('Type a command or search...');
    fireEvent.change(input, { target: { value: 'Run' } });
    expect(screen.getByText('Run Flow')).toBeInTheDocument();
    expect(screen.queryByText('Toggle Dark Mode')).not.toBeInTheDocument();
  });

  it('shows "No commands found" when no match', () => {
    render(<CommandPalette commands={commands} isOpen={true} onClose={onClose} />);
    const input = screen.getByPlaceholderText('Type a command or search...');
    fireEvent.change(input, { target: { value: 'zzzzzzz' } });
    expect(screen.getByText('No commands found')).toBeInTheDocument();
  });

  it('navigates with ArrowDown and ArrowUp', () => {
    render(<CommandPalette commands={commands} isOpen={true} onClose={onClose} />);
    const input = screen.getByPlaceholderText('Type a command or search...');

    // First item should be selected by default
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    // ArrowDown moves to next item
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const updatedOptions = screen.getAllByRole('option');
    expect(updatedOptions[1]).toHaveAttribute('aria-selected', 'true');

    // ArrowUp moves back
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    const revertedOptions = screen.getAllByRole('option');
    expect(revertedOptions[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('executes command on Enter', () => {
    vi.useFakeTimers();
    render(<CommandPalette commands={commands} isOpen={true} onClose={onClose} />);
    const input = screen.getByPlaceholderText('Type a command or search...');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onClose).toHaveBeenCalledTimes(1);
    // Action is executed after a 50ms delay
    vi.advanceTimersByTime(50);
    expect(commands[0].action).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('closes on Escape', () => {
    render(<CommandPalette commands={commands} isOpen={true} onClose={onClose} />);
    const input = screen.getByPlaceholderText('Type a command or search...');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('groups commands by category', () => {
    render(<CommandPalette commands={commands} isOpen={true} onClose={onClose} />);
    expect(screen.getByText('Flow')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('calls onClose when backdrop clicked', () => {
    const { container } = render(
      <CommandPalette commands={commands} isOpen={true} onClose={onClose} />
    );
    // Click the outermost fixed overlay
    const backdrop = container.querySelector('.fixed');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows shortcut badges', () => {
    render(<CommandPalette commands={commands} isOpen={true} onClose={onClose} />);
    expect(screen.getByText('Cmd+R')).toBeInTheDocument();
    expect(screen.getByText('Cmd+T')).toBeInTheDocument();
  });

  it('handles disabled commands (filters them out)', () => {
    render(<CommandPalette commands={commands} isOpen={true} onClose={onClose} />);
    expect(screen.queryByText('Disabled Command')).not.toBeInTheDocument();
  });
});
