import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../Card';

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Card content</Card>);
    expect(screen.getByText('Card content')).toBeInTheDocument();
  });

  it('applies className', () => {
    render(<Card className="my-card">Content</Card>);
    const card = screen.getByText('Content').closest('div');
    expect(card?.className).toContain('my-card');
    expect(card?.className).toContain('rounded-xl');
  });

  it('forwards ref', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<Card ref={ref}>Ref card</Card>);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current?.textContent).toBe('Ref card');
  });
});

describe('CardHeader', () => {
  it('renders with border-b', () => {
    render(<CardHeader data-testid="header">Header</CardHeader>);
    const header = screen.getByTestId('header');
    expect(header).toBeInTheDocument();
    expect(header.className).toContain('border-b');
    expect(header.className).toContain('p-4');
  });
});

describe('CardTitle', () => {
  it('renders as h3', () => {
    render(<CardTitle>Title Text</CardTitle>);
    const title = screen.getByRole('heading', { level: 3 });
    expect(title).toBeInTheDocument();
    expect(title.textContent).toBe('Title Text');
    expect(title.className).toContain('font-semibold');
  });
});

describe('CardDescription', () => {
  it('renders description text', () => {
    render(<CardDescription>Some description</CardDescription>);
    const desc = screen.getByText('Some description');
    expect(desc).toBeInTheDocument();
    expect(desc.tagName).toBe('P');
    expect(desc.className).toContain('text-sm');
  });
});

describe('CardContent', () => {
  it('renders with padding', () => {
    render(<CardContent data-testid="content">Body</CardContent>);
    const content = screen.getByTestId('content');
    expect(content).toBeInTheDocument();
    expect(content.className).toContain('p-4');
  });
});

describe('CardFooter', () => {
  it('renders with border-t', () => {
    render(<CardFooter data-testid="footer">Footer</CardFooter>);
    const footer = screen.getByTestId('footer');
    expect(footer).toBeInTheDocument();
    expect(footer.className).toContain('border-t');
    expect(footer.className).toContain('p-4');
  });
});
