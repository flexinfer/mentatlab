import React, { useState, useEffect, useCallback } from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import AgentPalette from './components/AgentPalette';
import FlowCanvas from './components/FlowCanvas';
import PropertyInspector from './components/PropertyInspector';
import CommandPalette from './components/CommandPalette'; // Import CommandPalette
import { ReactFlowProvider } from 'reactflow';
import './globals.css';
import 'reactflow/dist/style.css';
import { Button } from './components/ui/button';
import useStore from './store';
import { Flow, Node as GraphNode, Edge as GraphEdge, FlowMeta, FlowGraph, Position } from './types/graph';
import { v4 as uuidv4 } from 'uuid';

function App() {
  const { nodes, edges } = useStore();
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  const handleRunFlow = async () => {
    const flowNodes: GraphNode[] = nodes.map(node => ({
      id: node.id,
      type: node.type || 'default',
      position: node.position,
      outputs: node.data?.outputs,
      params: node.data?.params,
    }));

    const flowEdges: GraphEdge[] = edges.map(edge => ({
      from: edge.source + '.' + edge.sourceHandle,
      to: edge.target + '.' + edge.targetHandle,
    }));

    const flowMeta: FlowMeta = {
      id: uuidv4(),
      name: "My Workflow",
      version: "1.0.0",
      createdAt: new Date().toISOString(),
      description: "A workflow created from the UI",
    };

    const flowGraph: FlowGraph = {
      nodes: flowNodes,
      edges: flowEdges,
    };

    const flowPayload: Flow = {
      apiVersion: "v1",
      kind: "Flow",
      meta: flowMeta,
      graph: flowGraph,
    };

    console.log('Flow Payload:', JSON.stringify(flowPayload, null, 2));

    try {
      const response = await fetch('http://localhost:8000/flows', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(flowPayload),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log('Flow execution initiated:', result);
    } catch (error) {
      console.error('Error initiating flow execution:', error);
    }
  };

  const toggleCommandPalette = useCallback(() => {
    setIsCommandPaletteOpen((prev) => !prev);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        toggleCommandPalette();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [toggleCommandPalette]);

  return (
    <div className="h-screen w-screen flex flex-col">
      <header className="flex items-center justify-between p-4 border-b">
        <h1 className="text-xl font-bold">Workflow Builder</h1>
        <Button onClick={handleRunFlow}>Run</Button>
      </header>
      <div className="flex-grow">
        <ReactFlowProvider>
          <PanelGroup direction="horizontal">
            <Panel defaultSize={20} minSize={15}>
              <AgentPalette />
            </Panel>
            <PanelResizeHandle className="w-2 bg-gray-200 hover:bg-gray-300 transition-colors duration-200" />
            <Panel defaultSize={60} minSize={30}>
              <FlowCanvas />
            </Panel>
            <PanelResizeHandle className="w-2 bg-gray-200 hover:bg-gray-300 transition-colors duration-200" />
            <Panel defaultSize={20} minSize={15}>
              <PropertyInspector />
            </Panel>
          </PanelGroup>
        </ReactFlowProvider>
      </div>
      <CommandPalette isOpen={isCommandPaletteOpen} onClose={toggleCommandPalette} />
    </div>
  );
}

export default App;