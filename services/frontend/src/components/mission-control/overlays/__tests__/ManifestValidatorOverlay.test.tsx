import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockValidateManifest = vi.fn();

vi.mock('@/services/api/agentService', () => ({
  getAgentService: () => ({
    validateManifest: mockValidateManifest,
  }),
}));

vi.mock('@/services/api/httpClient', () => ({
  httpClient: {},
}));

// Import AFTER mocks
import { ManifestValidatorOverlay } from '../ManifestValidatorOverlay';

// ── Tests ─────────────────────────────────────────────────────────────────

describe('ManifestValidatorOverlay', () => {
  const defaultProps = { open: true, onClose: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when open is false', () => {
    render(<ManifestValidatorOverlay open={false} onClose={vi.fn()} />);
    expect(screen.queryByTestId('manifest-validator-overlay')).not.toBeInTheDocument();
  });

  it('renders textarea and Validate button', () => {
    render(<ManifestValidatorOverlay {...defaultProps} />);
    expect(screen.getByTestId('manifest-textarea')).toBeInTheDocument();
    expect(screen.getByTestId('validate-btn')).toBeInTheDocument();
    expect(screen.getByTestId('load-template-btn')).toBeInTheDocument();
  });

  it('shows parse error on invalid JSON', async () => {
    render(<ManifestValidatorOverlay {...defaultProps} />);
    fireEvent.change(screen.getByTestId('manifest-textarea'), {
      target: { value: 'not json' },
    });
    fireEvent.click(screen.getByTestId('validate-btn'));

    expect(screen.getByTestId('parse-error')).toHaveTextContent('Invalid JSON');
  });

  it('shows success banner on valid manifest', async () => {
    mockValidateManifest.mockResolvedValue({ valid: true, errors: [] });

    render(<ManifestValidatorOverlay {...defaultProps} />);
    fireEvent.change(screen.getByTestId('manifest-textarea'), {
      target: { value: '{"id":"test","name":"Test","version":"0.1.0"}' },
    });
    fireEvent.click(screen.getByTestId('validate-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('valid-banner')).toBeInTheDocument();
    });
    expect(screen.getByTestId('valid-banner')).toHaveTextContent('Manifest is valid');
  });

  it('shows error list on invalid manifest', async () => {
    mockValidateManifest.mockResolvedValue({
      valid: false,
      errors: [
        { path: '/id', message: 'pattern mismatch' },
        { path: '/name', message: 'required' },
      ],
    });

    render(<ManifestValidatorOverlay {...defaultProps} />);
    fireEvent.change(screen.getByTestId('manifest-textarea'), {
      target: { value: '{"id":"BAD"}' },
    });
    fireEvent.click(screen.getByTestId('validate-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('error-list')).toBeInTheDocument();
    });
    expect(screen.getByText('2 validation errors')).toBeInTheDocument();
    expect(screen.getByText('pattern mismatch')).toBeInTheDocument();
    expect(screen.getByText('required')).toBeInTheDocument();
  });

  it('loads template JSON when Load Template is clicked', () => {
    render(<ManifestValidatorOverlay {...defaultProps} />);
    fireEvent.click(screen.getByTestId('load-template-btn'));

    const textarea = screen.getByTestId('manifest-textarea') as HTMLTextAreaElement;
    expect(textarea.value).toContain('"my-agent"');
    expect(textarea.value).toContain('"version"');
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<ManifestValidatorOverlay open={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('validator-close-btn'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
