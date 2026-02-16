import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PanelShell } from '../PanelShell';

describe('PanelShell', () => {
  it('renders title and toolbar', () => {
    render(
      <PanelShell
        title={<span>Panel Title</span>}
        toolbar={<button>Action</button>}
      >
        Body
      </PanelShell>
    );
    expect(screen.getByText('Panel Title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
  });

  it('renders children', () => {
    render(
      <PanelShell>
        <div data-testid="child">Child content</div>
      </PanelShell>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('hides header when no title or toolbar', () => {
    const { container } = render(
      <PanelShell>Content only</PanelShell>
    );
    // The header div with border-b should not be present
    const headerDiv = container.querySelector('.border-b');
    expect(headerDiv).toBeNull();
  });

  it('shows header when title is provided', () => {
    const { container } = render(
      <PanelShell title={<span>Title</span>}>Content</PanelShell>
    );
    const headerDiv = container.querySelector('.border-b');
    expect(headerDiv).toBeTruthy();
  });

  it('shows header when toolbar is provided', () => {
    const { container } = render(
      <PanelShell toolbar={<button>Tool</button>}>Content</PanelShell>
    );
    const headerDiv = container.querySelector('.border-b');
    expect(headerDiv).toBeTruthy();
  });

  it('applies className', () => {
    const { container } = render(
      <PanelShell className="custom-panel">Content</PanelShell>
    );
    const panel = container.firstElementChild;
    expect(panel?.className).toContain('custom-panel');
    expect(panel?.className).toContain('flex');
    expect(panel?.className).toContain('flex-col');
  });
});
