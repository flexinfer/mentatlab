import React, { useState, useEffect, useMemo } from 'react';
import { lineage, type ArtifactNode, type LineageGraph } from '@/services/mission-control/services';
import { cn } from '@/lib/cn';
import Badge from '@/components/ui/Badge';

interface LineageOverlayProps {
  runId: string | null;
  selectedArtifactId?: string | null;
  onClose: () => void;
}

/**
 * LineageOverlay - Display artifact provenance and lineage graph
 *
 * Shows:
 * - Full lineage graph for a run
 * - Artifact provenance (ancestors & descendants)
 * - Metadata (size, creation time, MIME type)
 * - Interactive selection and filtering
 */
export default function LineageOverlay({ runId, selectedArtifactId, onClose }: LineageOverlayProps) {
  const [graph, setGraph] = useState<LineageGraph | null>(null);
  const [selectedArtifact, setSelectedArtifact] = useState<string | null>(selectedArtifactId || null);
  const [view, setView] = useState<'graph' | 'provenance'>('graph');

  // Load lineage graph
  useEffect(() => {
    if (!runId) {
      setGraph(null);
      return;
    }

    const loadedGraph = lineage.buildGraph(runId);
    setGraph(loadedGraph);

    // Auto-select first artifact if available
    if (!selectedArtifact && loadedGraph.nodes.length > 0) {
      setSelectedArtifact(loadedGraph.nodes[0].id);
    }
  }, [runId]);

  // Update selected artifact when prop changes
  useEffect(() => {
    if (selectedArtifactId) {
      setSelectedArtifact(selectedArtifactId);
      setView('provenance');
    }
  }, [selectedArtifactId]);

  // Get provenance for selected artifact
  const provenance = useMemo(() => {
    if (!runId || !selectedArtifact) return null;
    return lineage.getProvenance(runId, selectedArtifact);
  }, [runId, selectedArtifact]);

  if (!runId || !graph) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-sm z-50">
        <div className="bg-card rounded-lg shadow-xl p-6 max-w-md">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            No lineage data available for this run.
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
            <h2 className="text-lg font-semibold">Artifact Lineage</h2>
            <div className="flex items-center gap-2 text-xs">
              <button
                onClick={() => setView('graph')}
                className={cn(
                  'px-3 py-1 rounded border transition-colors',
                  view === 'graph'
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-300 dark:border-indigo-900/40'
                    : 'bg-card hover:bg-muted'
                )}
              >
                Full Graph
              </button>
              <button
                onClick={() => setView('provenance')}
                className={cn(
                  'px-3 py-1 rounded border transition-colors',
                  view === 'provenance'
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-300 dark:border-indigo-900/40'
                    : 'bg-card hover:bg-muted'
                )}
                disabled={!selectedArtifact}
              >
                Provenance
              </button>
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
        <div className="flex-1 overflow-auto">
          {view === 'graph' ? (
            <GraphView graph={graph} selectedArtifact={selectedArtifact} onSelectArtifact={setSelectedArtifact} />
          ) : (
            <ProvenanceView
              artifact={provenance?.artifact}
              ancestors={provenance?.ancestors || []}
              descendants={provenance?.descendants || []}
              onSelectArtifact={setSelectedArtifact}
            />
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t bg-muted/30 text-xs text-gray-600 dark:text-gray-400 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span>
              <strong>{graph.nodes.length}</strong> artifacts
            </span>
            <span>•</span>
            <span>
              <strong>{graph.edges.length}</strong> transformations
            </span>
            <span>•</span>
            <span>
              <strong>{graph.roots.length}</strong> inputs
            </span>
            <span>•</span>
            <span>
              <strong>{graph.leaves.length}</strong> outputs
            </span>
          </div>
          <span>Run ID: {runId.slice(0, 8)}...</span>
        </div>
      </div>
    </div>
  );
}

/**
 * GraphView - Display full lineage graph
 */
function GraphView({
  graph,
  selectedArtifact,
  onSelectArtifact,
}: {
  graph: LineageGraph;
  selectedArtifact: string | null;
  onSelectArtifact: (id: string) => void;
}) {
  // Group artifacts by type
  const artifactsByType = useMemo(() => {
    const groups: Record<string, ArtifactNode[]> = {
      input: [],
      intermediate: [],
      output: [],
    };

    graph.nodes.forEach((node) => {
      groups[node.type].push(node);
    });

    return groups;
  }, [graph]);

  return (
    <div className="p-6 space-y-6">
      <div className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Click on an artifact to view its provenance chain →
      </div>

      {/* Inputs */}
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Badge variant="info">Input</Badge>
          <span className="text-gray-600 dark:text-gray-400">({artifactsByType.input.length})</span>
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {artifactsByType.input.map((artifact) => (
            <ArtifactCard
              key={artifact.id}
              artifact={artifact}
              selected={selectedArtifact === artifact.id}
              onClick={() => onSelectArtifact(artifact.id)}
            />
          ))}
        </div>
      </div>

      {/* Intermediate */}
      {artifactsByType.intermediate.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Badge variant="warning">Intermediate</Badge>
            <span className="text-gray-600 dark:text-gray-400">({artifactsByType.intermediate.length})</span>
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {artifactsByType.intermediate.map((artifact) => (
              <ArtifactCard
                key={artifact.id}
                artifact={artifact}
                selected={selectedArtifact === artifact.id}
                onClick={() => onSelectArtifact(artifact.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Outputs */}
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Badge variant="success">Output</Badge>
          <span className="text-gray-600 dark:text-gray-400">({artifactsByType.output.length})</span>
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {artifactsByType.output.map((artifact) => (
            <ArtifactCard
              key={artifact.id}
              artifact={artifact}
              selected={selectedArtifact === artifact.id}
              onClick={() => onSelectArtifact(artifact.id)}
            />
          ))}
        </div>
      </div>

      {/* Transformations */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Transformations</h3>
        <div className="space-y-2">
          {graph.edges.map((edge, idx) => (
            <div
              key={idx}
              className="p-3 bg-muted/30 rounded border text-xs font-mono flex items-center justify-between"
            >
              <span className="text-gray-700 dark:text-gray-300">{edge.from}</span>
              <span className="text-gray-400 mx-2">→</span>
              <span className="text-gray-700 dark:text-gray-300">{edge.to}</span>
              {edge.meta?.bytes && (
                <span className="ml-auto text-gray-500">{formatBytes(edge.meta.bytes)}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * ProvenanceView - Display provenance chain for a single artifact
 */
function ProvenanceView({
  artifact,
  ancestors,
  descendants,
  onSelectArtifact,
}: {
  artifact?: ArtifactNode;
  ancestors: ArtifactNode[];
  descendants: ArtifactNode[];
  onSelectArtifact: (id: string) => void;
}) {
  if (!artifact) {
    return (
      <div className="p-6 text-center text-gray-600 dark:text-gray-400">
        Select an artifact to view its provenance chain
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Selected Artifact */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Selected Artifact</h3>
        <ArtifactCard artifact={artifact} selected={true} showDetails />
      </div>

      {/* Ancestors */}
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <span>Ancestors (Parents)</span>
          <Badge variant="info">{ancestors.length}</Badge>
        </h3>
        {ancestors.length === 0 ? (
          <div className="p-4 bg-muted/30 rounded text-sm text-gray-600 dark:text-gray-400 text-center">
            This artifact has no parent artifacts (it's a root)
          </div>
        ) : (
          <div className="space-y-2">
            {ancestors.map((ancestor) => (
              <ArtifactCard
                key={ancestor.id}
                artifact={ancestor}
                onClick={() => onSelectArtifact(ancestor.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Descendants */}
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <span>Descendants (Children)</span>
          <Badge variant="success">{descendants.length}</Badge>
        </h3>
        {descendants.length === 0 ? (
          <div className="p-4 bg-muted/30 rounded text-sm text-gray-600 dark:text-gray-400 text-center">
            This artifact has no child artifacts (it's a leaf)
          </div>
        ) : (
          <div className="space-y-2">
            {descendants.map((descendant) => (
              <ArtifactCard
                key={descendant.id}
                artifact={descendant}
                onClick={() => onSelectArtifact(descendant.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * ArtifactCard - Display a single artifact
 */
function ArtifactCard({
  artifact,
  selected = false,
  onClick,
  showDetails = false,
}: {
  artifact: ArtifactNode;
  selected?: boolean;
  onClick?: () => void;
  showDetails?: boolean;
}) {
  const typeColors = {
    input: 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:border-blue-900/40 dark:text-blue-300',
    output: 'bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-900/40 dark:text-green-300',
    intermediate: 'bg-yellow-50 border-yellow-200 text-yellow-700 dark:bg-yellow-900/20 dark:border-yellow-900/40 dark:text-yellow-300',
  };

  return (
    <div
      className={cn(
        'p-3 rounded border transition-all cursor-pointer',
        selected
          ? 'bg-indigo-50 border-indigo-300 ring-2 ring-indigo-200 dark:bg-indigo-900/30 dark:border-indigo-800 dark:ring-indigo-900/50'
          : 'bg-card hover:bg-muted',
        onClick && 'cursor-pointer'
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-mono font-semibold text-gray-900 dark:text-gray-100 truncate" title={artifact.id}>
            {artifact.id.slice(0, 16)}...
          </div>
          <div className="text-[11px] text-gray-600 dark:text-gray-400 mt-1">{artifact.nodePin}</div>
        </div>
        <Badge variant={artifact.type === 'input' ? 'info' : artifact.type === 'output' ? 'success' : 'warning'}>
          {artifact.type}
        </Badge>
      </div>

      {showDetails && artifact.meta && (
        <div className="mt-2 pt-2 border-t space-y-1 text-[11px] text-gray-600 dark:text-gray-400">
          {artifact.meta.bytes !== undefined && (
            <div className="flex justify-between">
              <span>Size:</span>
              <span className="font-mono">{formatBytes(artifact.meta.bytes)}</span>
            </div>
          )}
          {artifact.meta.mimeType && (
            <div className="flex justify-between">
              <span>Type:</span>
              <span className="font-mono">{artifact.meta.mimeType}</span>
            </div>
          )}
          {artifact.meta.createdAt && (
            <div className="flex justify-between">
              <span>Created:</span>
              <span className="font-mono">{new Date(artifact.meta.createdAt).toLocaleTimeString()}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
