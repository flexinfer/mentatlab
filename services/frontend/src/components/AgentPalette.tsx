import React, { useEffect, useState } from 'react';
// import { Card, CardContent, CardHeader, CardTitle } from './ui/card'; // Temporarily commented out due to import error

interface Agent {
  name: string;
  description: string;
  type: string; // e.g., flexinfer.echo
}

const AgentPalette: React.FC = () => {
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
    <div className="p-4 border-r bg-gray-50 h-full overflow-y-auto">
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
            >
              <h3 className="text-md font-semibold">{agent.name}</h3>
              <p className="text-sm text-gray-600">{agent.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AgentPalette;