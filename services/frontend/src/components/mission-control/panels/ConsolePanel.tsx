import React from 'react';
import { flightRecorder } from '../../../services/mission-control/services';

type ConsolePanelProps = {
  runId: string | null;
  maxItems?: number;
};

type Entry = {
  id: string;
  runId: string;
  at: string;
  label: string;
  data?: Record<string, unknown>;
};

export default function ConsolePanel({ runId, maxItems = 200 }: ConsolePanelProps) {
  const [showAll, setShowAll] = React.useState(() => runId == null);
  const [entries, setEntries] = React.useState<Entry[]>([]);
  const [lastUpdated, setLastUpdated] = React.useState<number>(Date.now());

  // Filter state (debounced)
  const [filterText, setFilterText] = React.useState<string>('');
  const [debouncedFilter, setDebouncedFilter] = React.useState<string>('');
  const filterTimer = React.useRef<number | null>(null);

  const refresh = React.useCallback(() => {
    try {
      const collectForRun = (id: string) => {
        const cps = flightRecorder.listCheckpoints(id) as any[];
        return cps.map((c) => ({
          id: c.id as string,
          runId: c.runId as string,
          at: c.at as string,
          label: String(c.label ?? 'event'),
          data: c.data as Record<string, unknown> | undefined,
        })) as Entry[];
      };

      let all: Entry[] = [];
      if (showAll || !runId) {
        const runs = flightRecorder.listRuns();
        for (const r of runs) {
          all = all.concat(collectForRun(r.runId));
        }
      } else {
        all = collectForRun(runId);
      }

      // Apply client-side filter (case-insensitive against label + serialized data)
      const filter = String(debouncedFilter ?? '').trim().toLowerCase();
      if (filter.length > 0) {
        all = all.filter((e) => {
          try {
            const hay = `${e.label} ${JSON.stringify(e.data ?? {})}`.toLowerCase();
            return hay.includes(filter);
          } catch {
            return String(e.label ?? '').toLowerCase().includes(filter);
          }
        });
      }

      // Sort by time desc
      all.sort((a, b) => (a.at < b.at ? 1 : -1));
      // Enforce maxItems after filtering
      if (all.length > maxItems) all = all.slice(0, maxItems);

      setEntries(all);
      setLastUpdated(Date.now());
    } catch {
      // ignore
    }
  }, [runId, showAll, maxItems, debouncedFilter]);

  // Debounce filter input (150ms)
  React.useEffect(() => {
    if (filterTimer.current) window.clearTimeout(filterTimer.current);
    // @ts-ignore - window.setTimeout returns number in browser env
    filterTimer.current = window.setTimeout(() => {
      setDebouncedFilter(filterText);
    }, 150);
    return () => {
      if (filterTimer.current) window.clearTimeout(filterTimer.current);
    };
  }, [filterText]);

  React.useEffect(() => {
    // initial
    refresh();
    // poll
    const t = window.setInterval(refresh, 1000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const fmtTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString();
    } catch {
      return iso;
    }
  };

  return (
    <div className="h-full w-full flex flex-col">
      <div className="px-2 py-1 border-b bg-card/60 backdrop-blur flex items-center justify-between">
        <div className="text-[11px] text-gray-600 dark:text-gray-300">
          <span className="font-medium">Console</span>
          <span className="mx-1 text-gray-300">|</span>
          <span>{entries.length} events</span>
          <span className="mx-1 text-gray-300">|</span>
          <span>Updated: {new Date(lastUpdated).toLocaleTimeString()}</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Filter (label + data)"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="text-xs px-2 py-1 border rounded bg-background dark:bg-card"
            style={{ width: 220 }}
            aria-label="Console filter"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-1 text-[11px]">
            <input
              type="checkbox"
              className="h-3 w-3"
              checked={showAll || !runId}
              onChange={() => setShowAll((v) => !v)}
              disabled={!runId}
            />
            <span>Show all runs</span>
          </label>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {entries.length === 0 ? (
          <div className="p-3 text-[11px] text-gray-500">No events yet.</div>
        ) : (
          <ul className="divide-y">
            {entries.map((e) => (
              <li key={e.id} id={`console-${e.id}`} className="px-3 py-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-1.5 w-1.5 rounded-full bg-slate-400" />
                    <span className="text-gray-400 font-mono">{fmtTime(e.at)}</span>
                    <span className="text-gray-500">[{e.runId}]</span>
                    <span className="font-medium text-gray-700 dark:text-gray-200">{e.label}</span>
                  </div>
                </div>
                {e.data && (
                  <pre className="mt-1 text-[10px] bg-muted/50 dark:bg-muted/20 border rounded p-2 overflow-auto max-h-24">
                    {JSON.stringify(e.data, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}