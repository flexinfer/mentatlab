import React, { useState, useEffect, useMemo } from 'react';
import { flightRecorder, policies, type RecorderRunSummary } from '@/services/mission-control/services';
import { cn } from '@/lib/cn';
import Badge from '@/components/ui/Badge';
import { PanelShell } from '@/components/ui/PanelShell';

interface MetricsPanelProps {
  runId: string | null;
}

interface Metrics {
  duration: number; // ms
  events: number;
  errors: number;
  warnings: number;
  cost: number; // USD
  throughput: number; // events/sec
  nodeMetrics: Map<string, NodeMetrics>;
}

interface NodeMetrics {
  nodeId: string;
  executions: number;
  avgDuration: number;
  errors: number;
  cost: number;
}

/**
 * MetricsPanel - Comprehensive metrics dashboard
 *
 * Shows:
 * - Run duration and status
 * - Event counts and throughput
 * - Error rates
 * - Cost tracking
 * - Per-node performance metrics
 * - Historical trends
 */
export default function MetricsPanel({ runId }: MetricsPanelProps) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [run, setRun] = useState<RecorderRunSummary | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Load metrics
  useEffect(() => {
    if (!runId) {
      setMetrics(null);
      setRun(null);
      return;
    }

    const loadMetrics = () => {
      const runData = flightRecorder.getRun(runId);
      if (!runData) {
        setMetrics(null);
        setRun(null);
        return;
      }

      setRun(runData);

      const checkpoints = flightRecorder.listCheckpoints(runId);
      const cost = policies.getCost(runId);

      // Calculate metrics
      const duration = runData.metrics?.durationMs ?? 0;
      const events = checkpoints.length;
      const errors = checkpoints.filter((c) => c.data?.level === 'error').length;
      const warnings = checkpoints.filter((c) => c.data?.level === 'warn').length;
      const throughput = duration > 0 ? (events / duration) * 1000 : 0;

      // Per-node metrics
      const nodeMetrics = new Map<string, NodeMetrics>();
      checkpoints.forEach((checkpoint) => {
        const nodeId = checkpoint.data?.nodeId || checkpoint.data?.node || 'unknown';
        if (!nodeMetrics.has(nodeId)) {
          nodeMetrics.set(nodeId, {
            nodeId,
            executions: 0,
            avgDuration: 0,
            errors: 0,
            cost: 0,
          });
        }

        const node = nodeMetrics.get(nodeId)!;
        node.executions += 1;

        if (checkpoint.data?.level === 'error') {
          node.errors += 1;
        }

        if (checkpoint.data?.duration) {
          const oldAvg = node.avgDuration;
          node.avgDuration = (oldAvg * (node.executions - 1) + checkpoint.data.duration) / node.executions;
        }
      });

      setMetrics({
        duration,
        events,
        errors,
        warnings,
        cost,
        throughput,
        nodeMetrics,
      });
    };

    loadMetrics();

    // Refresh every 2 seconds for live runs
    if (run?.status === 'running') {
      const interval = setInterval(() => {
        loadMetrics();
        setRefreshKey((k) => k + 1);
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [runId, run?.status, refreshKey]);

  if (!runId || !metrics) {
    return (
      <PanelShell
        title={<span className="uppercase tracking-wide text-gray-500">Metrics</span>}
        className="h-full w-full"
      >
        <div className="p-4 text-sm text-gray-600 dark:text-gray-400 text-center">
          No metrics available. Start a run to see metrics.
        </div>
      </PanelShell>
    );
  }

  return (
    <PanelShell
      title={<span className="uppercase tracking-wide text-gray-500">Metrics</span>}
      className="h-full w-full"
    >
      <div className="p-4 space-y-4 overflow-auto">
        {/* Overview Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            label="Duration"
            value={formatDuration(metrics.duration)}
            icon="⏱️"
            color="blue"
          />
          <MetricCard
            label="Events"
            value={metrics.events.toString()}
            subValue={`${metrics.throughput.toFixed(1)}/s`}
            icon="📊"
            color="indigo"
          />
          <MetricCard
            label="Errors"
            value={metrics.errors.toString()}
            subValue={metrics.warnings > 0 ? `${metrics.warnings} warnings` : undefined}
            icon="⚠️"
            color={metrics.errors > 0 ? 'red' : 'green'}
          />
          <MetricCard
            label="Cost"
            value={`$${metrics.cost.toFixed(4)}`}
            icon="💰"
            color="yellow"
          />
        </div>

        {/* Run Status */}
        <div className="p-3 bg-muted/30 rounded-lg border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold">Run Status</span>
            <RunStatusBadge status={run?.status || 'unknown'} />
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-gray-600 dark:text-gray-400">ID:</span>{' '}
              <span className="font-mono">{runId.slice(0, 12)}...</span>
            </div>
            <div>
              <span className="text-gray-600 dark:text-gray-400">Started:</span>{' '}
              <span>{run?.startedAt ? new Date(run.startedAt).toLocaleTimeString() : 'N/A'}</span>
            </div>
            {run?.endedAt && (
              <div className="col-span-2">
                <span className="text-gray-600 dark:text-gray-400">Ended:</span>{' '}
                <span>{new Date(run.endedAt).toLocaleTimeString()}</span>
              </div>
            )}
          </div>
        </div>

        {/* Per-Node Metrics */}
        {metrics.nodeMetrics.size > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-3">Per-Node Performance</h3>
            <div className="space-y-2">
              {Array.from(metrics.nodeMetrics.values())
                .sort((a, b) => b.executions - a.executions)
                .map((node) => (
                  <NodeMetricRow key={node.nodeId} node={node} />
                ))}
            </div>
          </div>
        )}

        {/* Performance Distribution */}
        <PerformanceChart metrics={metrics} />
      </div>
    </PanelShell>
  );
}

/**
 * MetricCard - Display a single metric with icon
 */
function MetricCard({
  label,
  value,
  subValue,
  icon,
  color = 'gray',
}: {
  label: string;
  value: string;
  subValue?: string;
  icon: string;
  color?: 'gray' | 'blue' | 'indigo' | 'green' | 'yellow' | 'red';
}) {
  const colorClasses = {
    gray: 'bg-gray-50 border-gray-200 dark:bg-gray-900/20 dark:border-gray-800',
    blue: 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-900/40',
    indigo: 'bg-indigo-50 border-indigo-200 dark:bg-indigo-900/20 dark:border-indigo-900/40',
    green: 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-900/40',
    yellow: 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-900/40',
    red: 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-900/40',
  };

  return (
    <div className={cn('p-3 rounded-lg border', colorClasses[color])}>
      <div className="flex items-start justify-between mb-1">
        <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
        <span className="text-lg">{icon}</span>
      </div>
      <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{value}</div>
      {subValue && <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">{subValue}</div>}
    </div>
  );
}

/**
 * RunStatusBadge - Display run status with color
 */
function RunStatusBadge({ status }: { status: string }) {
  const statusConfig: Record<string, { variant: any; label: string }> = {
    running: { variant: 'info', label: 'Running' },
    completed: { variant: 'success', label: 'Completed' },
    failed: { variant: 'error', label: 'Failed' },
    cancelled: { variant: 'default', label: 'Cancelled' },
    unknown: { variant: 'default', label: 'Unknown' },
  };

  const config = statusConfig[status] || statusConfig.unknown;

  return <Badge variant={config.variant}>{config.label}</Badge>;
}

/**
 * NodeMetricRow - Display metrics for a single node
 */
function NodeMetricRow({ node }: { node: NodeMetrics }) {
  const hasErrors = node.errors > 0;
  const isSlow = node.avgDuration > 1000; // >1s is slow

  return (
    <div
      className={cn(
        'p-3 rounded border',
        hasErrors
          ? 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-900/40'
          : isSlow
          ? 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-900/40'
          : 'bg-card'
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold truncate">{node.nodeId}</span>
          {hasErrors && <Badge variant="error">{node.errors} errors</Badge>}
          {isSlow && !hasErrors && <Badge variant="warning">Slow</Badge>}
        </div>
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {node.executions} exec{node.executions !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-400">
        <div>
          <span>Avg Duration:</span>{' '}
          <span className="font-mono">{node.avgDuration.toFixed(0)}ms</span>
        </div>
        {node.cost > 0 && (
          <div>
            <span>Cost:</span> <span className="font-mono">${node.cost.toFixed(4)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * PerformanceChart - Simple ASCII-style performance visualization
 */
function PerformanceChart({ metrics }: { metrics: Metrics }) {
  const nodes = Array.from(metrics.nodeMetrics.values()).sort((a, b) => b.avgDuration - a.avgDuration);

  if (nodes.length === 0) return null;

  const maxDuration = Math.max(...nodes.map((n) => n.avgDuration), 1);

  return (
    <div>
      <h3 className="text-sm font-semibold mb-3">Response Time Distribution</h3>
      <div className="space-y-2">
        {nodes.map((node) => {
          const width = (node.avgDuration / maxDuration) * 100;
          const color =
            node.errors > 0
              ? 'bg-red-500'
              : node.avgDuration > 1000
              ? 'bg-yellow-500'
              : 'bg-green-500';

          return (
            <div key={node.nodeId} className="text-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="text-gray-700 dark:text-gray-300 truncate flex-1">{node.nodeId}</span>
                <span className="font-mono text-gray-600 dark:text-gray-400 ml-2">
                  {node.avgDuration.toFixed(0)}ms
                </span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                <div
                  className={cn('h-full transition-all duration-300', color)}
                  style={{ width: `${width}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Format duration in ms to human-readable string
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}
