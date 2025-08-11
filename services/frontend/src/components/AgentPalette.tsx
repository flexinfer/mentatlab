/**
 * @deprecated This component is deprecated. The new streaming UI provides
 * integrated agent management through StreamingControls and StreamingPage.
 * This component will be removed in a future version.
 *
 * Migration Guide:
 * - Use StreamingPage for the complete streaming workflow experience
 * - Agent management is now handled through the streaming interface
 * - StreamingControls provides better agent interaction capabilities
 */

import React, { useEffect, useState } from 'react';
// import { Card, CardContent, CardHeader, CardTitle } from './ui/card'; // Temporarily commented out due to import error

interface Agent {
  id?: string;
  name: string;
  description: string;
  type: string; // e.g., flexinfer.echo
  // Optional UI metadata (populated by /api/v1/agents)
  ui?: {
    remoteEntry?: string;
    title?: string;
    description?: string;
    icon?: string;
  };
  // Other optional metadata may be present from the manifest listing
  [key: string]: any;
}

/**
 * @deprecated Use StreamingPage and StreamingControls instead
 */
const AgentPalette: React.FC = () => {
  // Add deprecation warning
  React.useEffect(() => {
    console.warn(
      'AgentPalette is deprecated. Use StreamingPage and StreamingControls instead. ' +
      'This component will be removed in a future version.'
    );
  }, []);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const response = await fetch('/api/v1/agents');
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        setAgents(data);
      } catch (e: any) {
        setError(e.message);
        console.error("Failed to fetch agents:", e);
      }
    };

    fetchAgents();
  }, []);

  const onDragStart = (event: React.DragEvent<HTMLDivElement>, agent: Agent) => {
    event.dataTransfer.setData('application/reactflow', agent.type);
    event.dataTransfer.setData('agent', JSON.stringify(agent));
    event.dataTransfer.effectAllowed = 'move';
  };

  if (error) {
    return <div className="p-4 text-red-500">Error: {error}</div>;
  }

  return (
    <div className="p-4 border-r bg-gray-50 h-full overflow-y-auto" data-testid="agent-palette">
      <h2 className="text-lg font-semibold mb-4">Agent Palette</h2>
      {agents.length === 0 ? (
        <p>No agents available.</p>
      ) : (
        <div className="grid gap-4">
          {agents.map((agent) => (
            <div
              key={agent.name}
              className="p-4 border rounded-md shadow-sm cursor-grab bg-white"
              draggable
              onDragStart={(event) => onDragStart(event, agent)}
              data-testid={`agent-card-${agent.name}`}
            >
              <h3 className="text-md font-semibold">{agent.name}</h3>
              <p className="text-sm text-gray-600">{agent.description}</p>

              {/* New: If agent provides a UI remoteEntry, show an Open UI button that loads it in a popup */}
              {(agent as any).ui?.remoteEntry ? (
                <div style={{ marginTop: 8 }}>
                  <button
                    className="px-3 py-1 bg-blue-600 text-white rounded"
                    onClick={() => {
                      try {
                        const popup = window.open("", `${agent.name}-ui`, "width=800,height=600");
                        if (!popup) {
                          alert("Popup blocked - allow popups for this site.");
                          return;
                        }
                        // Build a minimal HTML document that loads the remoteEntry script and attempts to mount it
                        const remoteUrl = (agent as any).ui.remoteEntry;
                        const html = `
                          <!doctype html>
                          <html>
                            <head>
                              <meta charset="utf-8" />
                              <title>${agent.name} UI</title>
                              <style>body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial; margin: 12px; }</style>
                            </head>
                            <body>
                              <div id="agent-root"></div>
                              <script>
                                (function(){
                                  // Load script
                                  const s = document.createElement('script');
                                  s.src = '${remoteUrl}';
                                  s.onload = function() {
                                    try {
                                      // Attempt common globals that remoteEntry might expose
                                      if (window.PsycheSimRemote && typeof window.PsycheSimRemote.mount === 'function') {
                                        const container = document.getElementById('agent-root');
                                        const rem = window.PsycheSimRemote;
                                        rem.mount(container, null);
                                        return;
                                      }
                                      // Try to find any global object with mount function (best-effort)
                                      for (const k in window) {
                                        try {
                                          const v = window[k];
                                          if (v && typeof v.mount === 'function') {
                                            v.mount(document.getElementById('agent-root'), null);
                                            return;
                                          }
                                        } catch(e) { /* ignore */ }
                                      }
                                      const p = document.createElement('pre');
                                      p.textContent = 'Loaded remoteEntry but could not find a mount() function. Check remoteEntry exposes mount().';
                                      document.getElementById('agent-root').appendChild(p);
                                    } catch (err) {
                                      const p = document.createElement('pre');
                                      p.textContent = 'Error mounting remoteEntry: ' + err;
                                      document.getElementById('agent-root').appendChild(p);
                                    }
                                  };
                                  s.onerror = function(e) {
                                    const p = document.createElement('pre');
                                    p.textContent = 'Failed to load remoteEntry: ' + ${JSON.stringify(remoteUrl)};
                                    document.getElementById('agent-root').appendChild(p);
                                  };
                                  document.body.appendChild(s);
                                })();
                              </script>
                            </body>
                          </html>
                        `;
                        popup.document.open();
                        popup.document.write(html);
                        popup.document.close();
                      } catch (err) {
                        console.error("Failed to open agent UI:", err);
                        alert("Failed to open agent UI: " + err);
                      }
                    }}
                  >
                    Open UI
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AgentPalette;