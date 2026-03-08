/**
 * ManifestValidatorOverlay – visual agent manifest validation.
 *
 * Users paste or edit manifest JSON in a code textarea, press Validate,
 * and see inline pass/fail results from POST /api/v1/agents/validate.
 */

import React, { useState, useCallback } from 'react';
import { getAgentService } from '@/services/api/agentService';
import { httpClient } from '@/services/api/httpClient';

/* ── Example manifest template ──────────────────────────────────── */

const TEMPLATE_MANIFEST = JSON.stringify(
  {
    id: 'my-agent',
    name: 'My Agent',
    version: '0.1.0',
    image: 'registry.example.com/my-agent:latest',
    command: ['python', 'main.py'],
    inputs: [{ name: 'prompt', type: 'string', description: 'User prompt' }],
    outputs: [{ name: 'result', type: 'string', description: 'Agent output' }],
  },
  null,
  2,
);

/* ── Types ──────────────────────────────────────────────────────── */

interface ValidationError {
  path: string;
  message: string;
}

interface ManifestValidatorOverlayProps {
  open: boolean;
  onClose: () => void;
}

/* ── Component ──────────────────────────────────────────────────── */

export function ManifestValidatorOverlay({ open, onClose }: ManifestValidatorOverlayProps) {
  const [source, setSource] = useState('');
  const [validating, setValidating] = useState(false);
  const [result, setResult] = useState<{ valid: boolean; errors?: ValidationError[] } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  /* ── handlers ──────────────────────────────────────────────────── */

  const handleValidate = useCallback(async () => {
    setParseError(null);
    setResult(null);

    // Parse JSON first
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(source);
    } catch {
      setParseError('Invalid JSON — please check your syntax.');
      return;
    }

    setValidating(true);
    try {
      const service = getAgentService(httpClient, null);
      const res = await service.validateManifest(manifest);
      setResult(res);
    } catch (err: any) {
      setParseError(err?.message ?? 'Validation request failed.');
    } finally {
      setValidating(false);
    }
  }, [source]);

  const handleLoadTemplate = useCallback(() => {
    setSource(TEMPLATE_MANIFEST);
    setResult(null);
    setParseError(null);
  }, []);

  const handleClose = useCallback(() => {
    setSource('');
    setResult(null);
    setParseError(null);
    onClose();
  }, [onClose]);

  /* ── render ─────────────────────────────────────────────────────── */

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      data-testid="manifest-validator-overlay"
    >
      <div className="bg-popover border border-border rounded-xl shadow-2xl w-full max-w-xl flex flex-col max-h-[80vh]">
        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-sm font-semibold">Manifest Validator</h2>
          <button
            onClick={handleClose}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            data-testid="validator-close-btn"
          >
            ✕
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {/* Action row */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleValidate}
              disabled={validating || source.trim().length === 0}
              className="text-[11px] px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity"
              data-testid="validate-btn"
            >
              {validating ? 'Validating…' : 'Validate'}
            </button>
            <button
              onClick={handleLoadTemplate}
              className="text-[11px] px-3 py-1.5 rounded-md bg-muted hover:bg-muted/70 transition-colors"
              data-testid="load-template-btn"
            >
              Load Template
            </button>
          </div>

          {/* Textarea */}
          <textarea
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setResult(null);
              setParseError(null);
            }}
            placeholder="Paste agent manifest JSON here…"
            spellCheck={false}
            rows={14}
            className="w-full font-mono text-[11px] rounded-md border bg-muted/30 p-3 resize-y focus:outline-none focus:ring-1 focus:ring-primary/50"
            data-testid="manifest-textarea"
          />

          {/* ── Results ──────────────────────────────────────── */}
          {parseError && (
            <div
              className="text-[11px] text-red-500 bg-red-500/10 rounded-md p-3"
              data-testid="parse-error"
            >
              {parseError}
            </div>
          )}

          {result?.valid && (
            <div
              className="text-[11px] text-green-600 bg-green-500/10 rounded-md p-3 flex items-center gap-2"
              data-testid="valid-banner"
            >
              <span>✓</span> Manifest is valid.
            </div>
          )}

          {result && !result.valid && result.errors && result.errors.length > 0 && (
            <div className="space-y-1" data-testid="error-list">
              <div className="text-[11px] font-medium text-red-500">
                {result.errors.length} validation error{result.errors.length !== 1 ? 's' : ''}
              </div>
              <ul className="list-disc list-inside space-y-0.5">
                {result.errors.map((err, i) => (
                  <li key={i} className="text-[10px] text-red-500">
                    <span className="font-mono text-red-400">{err.path || '/'}</span>
                    <span className="mx-1">—</span>
                    {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ManifestValidatorOverlay;
