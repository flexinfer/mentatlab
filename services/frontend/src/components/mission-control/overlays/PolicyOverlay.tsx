import React, { useState, useEffect, useMemo } from 'react';
import { policies, type PolicyViolation, type BudgetEnvelope } from '@/services/mission-control/services';
import { cn } from '@/lib/cn';
import Badge from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';

interface PolicyOverlayProps {
  runId: string | null;
  onClose: () => void;
}

/**
 * PolicyOverlay - Display policy violations, budget tracking, and guardrails
 *
 * Shows:
 * - Active budget envelopes
 * - Cost tracking and projections
 * - Policy violations
 * - Safety and compliance issues
 * - Remediation suggestions
 */
export default function PolicyOverlay({ runId, onClose }: PolicyOverlayProps) {
  const [violations, setViolations] = useState<PolicyViolation[]>([]);
  const [cost, setCost] = useState<number>(0);
  const [selectedViolation, setSelectedViolation] = useState<PolicyViolation | null>(null);

  // Load violations and cost
  useEffect(() => {
    if (!runId) {
      setViolations([]);
      setCost(0);
      return;
    }

    const loadedViolations = policies.getViolations(runId);
    const loadedCost = policies.getCost(runId);

    setViolations(loadedViolations);
    setCost(loadedCost);
  }, [runId]);

  // Group violations by type
  const violationsByType = useMemo(() => {
    const groups: Record<string, PolicyViolation[]> = {};

    violations.forEach((violation) => {
      if (!groups[violation.type]) {
        groups[violation.type] = [];
      }
      groups[violation.type].push(violation);
    });

    return groups;
  }, [violations]);

  // Count by severity
  const severityCounts = useMemo(() => {
    const counts: Record<string, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };

    violations.forEach((v) => {
      counts[v.severity]++;
    });

    return counts;
  }, [violations]);

  if (!runId) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-sm z-50">
        <div className="bg-card rounded-lg shadow-xl p-6 max-w-md">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            No policy data available for this run.
          </p>
          <button
            onClick={onClose}
            className="mt-4 px-4 py-2 text-sm bg-gray-100 dark:bg-gray-800 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-50" onClick={onClose}>
      <div
        className="w-full max-w-6xl max-h-[85vh] bg-card rounded-lg shadow-2xl border overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/50">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold">Policy Guardrails</h2>
            <div className="flex items-center gap-2">
              {severityCounts.critical > 0 && (
                <Badge variant="error">
                  {severityCounts.critical} Critical
                </Badge>
              )}
              {severityCounts.high > 0 && (
                <Badge variant="warning">
                  {severityCounts.high} High
                </Badge>
              )}
              {violations.length === 0 && (
                <Badge variant="success">
                  All Clear
                </Badge>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 space-y-6">
          {/* Budget Overview */}
          <BudgetSection runId={runId} currentCost={cost} />

          {/* Violations by Type */}
          {Object.keys(violationsByType).length > 0 ? (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Policy Violations</h3>
              {Object.entries(violationsByType).map(([type, typeViolations]) => (
                <ViolationTypeSection
                  key={type}
                  type={type}
                  violations={typeViolations}
                  onSelectViolation={setSelectedViolation}
                  selectedViolation={selectedViolation}
                />
              ))}
            </div>
          ) : (
            <div className="p-8 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-900/40 text-center">
              <div className="text-4xl mb-2">✓</div>
              <div className="text-sm font-semibold text-green-700 dark:text-green-300 mb-1">
                No Policy Violations
              </div>
              <div className="text-xs text-green-600 dark:text-green-400">
                This run is compliant with all configured policies
              </div>
            </div>
          )}

          {/* Remediation Suggestions */}
          {violations.length > 0 && (
            <RemediationSection violations={violations} />
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t bg-muted/30 text-xs text-gray-600 dark:text-gray-400 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span>
              <strong>{violations.length}</strong> violations
            </span>
            <span>•</span>
            <span>
              Cost: <strong>${cost.toFixed(4)}</strong>
            </span>
          </div>
          <span>Run ID: {runId.slice(0, 8)}...</span>
        </div>
      </div>
    </div>
  );
}

/**
 * BudgetSection - Display budget envelope and cost tracking
 */
function BudgetSection({ runId, currentCost }: { runId: string; currentCost: number }) {
  const [budgetId, setBudgetId] = useState<string>('default');
  const [budget, setBudget] = useState<BudgetEnvelope | null>(null);

  useEffect(() => {
    const loadedBudget = policies.getBudget(budgetId);
    setBudget(loadedBudget || null);
  }, [budgetId]);

  const budgetCheck = useMemo(() => {
    if (!budget) return null;
    return policies.checkBudget(runId, budgetId);
  }, [runId, budgetId, budget]);

  const usagePercentage = budgetCheck ? (budgetCheck.usage / budgetCheck.limit) * 100 : 0;
  const isWarning = usagePercentage > 75;
  const isError = usagePercentage > 90;

  return (
    <div>
      <h3 className="text-sm font-semibold mb-3">Budget Envelope</h3>
      <div className="p-4 bg-muted/30 rounded-lg border space-y-3">
        {budget ? (
          <>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-sm">{budget.name}</div>
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  Max Cost: ${budget.maxCost.toFixed(2)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold">${currentCost.toFixed(4)}</div>
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  {usagePercentage.toFixed(1)}% used
                </div>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
              <div
                className={cn(
                  'h-full transition-all',
                  isError
                    ? 'bg-red-500'
                    : isWarning
                    ? 'bg-yellow-500'
                    : 'bg-green-500'
                )}
                style={{ width: `${Math.min(usagePercentage, 100)}%` }}
              />
            </div>

            {budgetCheck?.exceeded && (
              <div className="text-xs text-red-600 dark:text-red-400 font-semibold">
                ⚠️ Budget exceeded!
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-gray-600 dark:text-gray-400">
            No budget envelope configured
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * ViolationTypeSection - Display violations grouped by type
 */
function ViolationTypeSection({
  type,
  violations,
  onSelectViolation,
  selectedViolation,
}: {
  type: string;
  violations: PolicyViolation[];
  onSelectViolation: (v: PolicyViolation) => void;
  selectedViolation: PolicyViolation | null;
}) {
  const typeLabels: Record<string, string> = {
    cost_exceeded: 'Cost Exceeded',
    pii_detected: 'PII Detected',
    unsafe_content: 'Unsafe Content',
    rate_limit: 'Rate Limit',
    duration_exceeded: 'Duration Exceeded',
  };

  const typeIcons: Record<string, string> = {
    cost_exceeded: '💰',
    pii_detected: '🔒',
    unsafe_content: '⚠️',
    rate_limit: '⏱️',
    duration_exceeded: '⏰',
  };

  return (
    <div>
      <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
        <span>{typeIcons[type] || '📋'}</span>
        <span>{typeLabels[type] || type}</span>
        <Badge variant="info">{violations.length}</Badge>
      </h4>
      <div className="space-y-2">
        {violations.map((violation) => (
          <ViolationCard
            key={violation.id}
            violation={violation}
            selected={selectedViolation?.id === violation.id}
            onClick={() => onSelectViolation(violation)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * ViolationCard - Display a single violation
 */
function ViolationCard({
  violation,
  selected,
  onClick,
}: {
  violation: PolicyViolation;
  selected: boolean;
  onClick: () => void;
}) {
  const severityColors = {
    low: 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:border-blue-900/40 dark:text-blue-300',
    medium: 'bg-yellow-50 border-yellow-200 text-yellow-700 dark:bg-yellow-900/20 dark:border-yellow-900/40 dark:text-yellow-300',
    high: 'bg-orange-50 border-orange-200 text-orange-700 dark:bg-orange-900/20 dark:border-orange-900/40 dark:text-orange-300',
    critical: 'bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-900/40 dark:text-red-300',
  };

  return (
    <div
      className={cn(
        'p-3 rounded border transition-all cursor-pointer',
        selected
          ? 'bg-indigo-50 border-indigo-300 ring-2 ring-indigo-200 dark:bg-indigo-900/30 dark:border-indigo-800 dark:ring-indigo-900/50'
          : 'bg-card hover:bg-muted'
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {violation.message}
          </div>
          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            Node: {violation.nodeId} • {new Date(violation.timestamp).toLocaleTimeString()}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant={violation.severity === 'critical' || violation.severity === 'high' ? 'error' : 'warning'}>
            {violation.severity}
          </Badge>
          <div className="text-xs px-2 py-0.5 rounded border bg-gray-50 dark:bg-gray-800">
            {violation.action}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * RemediationSection - Suggest remediation actions
 */
function RemediationSection({ violations }: { violations: PolicyViolation[] }) {
  const suggestions = useMemo(() => {
    const sugg: string[] = [];

    violations.forEach((v) => {
      switch (v.type) {
        case 'cost_exceeded':
          sugg.push('Consider optimizing model selection or reducing token limits');
          break;
        case 'pii_detected':
          sugg.push('Enable PII redaction in preprocessing or add scrubbing filters');
          break;
        case 'unsafe_content':
          sugg.push('Review content moderation settings and add safety classifiers');
          break;
        case 'rate_limit':
          sugg.push('Implement exponential backoff or add request queuing');
          break;
        case 'duration_exceeded':
          sugg.push('Add timeouts or break long-running tasks into smaller chunks');
          break;
      }
    });

    return Array.from(new Set(sugg)); // Deduplicate
  }, [violations]);

  if (suggestions.length === 0) return null;

  return (
    <div>
      <h3 className="text-sm font-semibold mb-3">Remediation Suggestions</h3>
      <div className="space-y-2">
        {suggestions.map((suggestion, idx) => (
          <div
            key={idx}
            className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-900/40 text-sm"
          >
            <div className="flex items-start gap-2">
              <span className="text-blue-600 dark:text-blue-400">💡</span>
              <span className="text-blue-700 dark:text-blue-300">{suggestion}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
