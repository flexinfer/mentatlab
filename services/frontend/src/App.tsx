import React from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import AgentPalette from './components/AgentPalette';
import FlowCanvas from './components/FlowCanvas';
import ConfigurationPanel from './components/ConfigurationPanel';
import { ReactFlowProvider } from 'reactflow';
import './globals.css';
import 'reactflow/dist/style.css';
import { Button } from './components/ui/button';
import { useFlowStore, IFlow, IFlowNode, IFlowEdge, IFlowMeta, IFlowGraph, IFlowPosition } from './stores/flowStore';
import { v4 as uuidv4 } from 'uuid';

function App() {
  const { nodes, edges } = useFlowStore();

  const handleRunFlow = async () => {
    const flowNodes: IFlowNode[] = nodes.map(node => ({
      id: node.id,
      type: node.type || 'default',
      position: node.position,
      outputs: node.data?.outputs,
      params: node.data?.params,
    }));

    const flowEdges: IFlowEdge[] = edges.map(edge => ({
      from: edge.source + '.' + edge.sourceHandle,
      to: edge.target + '.' + edge.targetHandle,
    }));

    const flowMeta: IFlowMeta = {
      id: uuidv4(),
      name: "My Workflow",
      version: "1.0.0",
      createdAt: new Date().toISOString(),
      description: "A workflow created from the UI",
    };

    const flowGraph: IFlowGraph = {
      nodes: flowNodes,
      edges: flowEdges,
    };

    const flowPayload: IFlow = {
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
              <ConfigurationPanel />
            </Panel>
          </PanelGroup>
        </ReactFlowProvider>
      </div>
    </div>
  );
}

export default App;