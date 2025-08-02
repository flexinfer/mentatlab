import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import AgentPalette from './components/AgentPalette';
import FlowCanvas from './components/FlowCanvas';
import PropertyInspector from './components/PropertyInspector';
import CommandPalette from './components/CommandPalette';
import StreamingPage from './components/StreamingPage';
import { ReactFlowProvider } from 'reactflow';
import './globals.css';
import 'reactflow/dist/style.css';
import { Button } from './components/ui/button';
import useStore from './store';
import { Flow, Node as GraphNode, Edge as GraphEdge, FlowMeta, FlowGraph, Position } from './types/graph';
import { v4 as uuidv4 } from 'uuid';

/**
 * @deprecated The FlowBuilder interface is deprecated. Use StreamingPage for the new
 * streaming workflow experience instead. This interface will be removed in a future version.
 */
const FlowBuilder = () => {
  const { nodes, edges } = useStore();
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  
  // Add deprecation warning
  React.useEffect(() => {
    console.warn(
      'FlowBuilder interface is deprecated. Use the Streaming View (/streaming) for the new workflow experience. ' +
      'This interface will be removed in a future version.'
    );
  }, []);

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
      const response = await fetch('http://localhost:8001/flows', {
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
      {/* Deprecation Notice */}
      <div className="bg-orange-100 border-l-4 border-orange-500 text-orange-700 p-3 text-sm">
        <div className="flex items-center">
          <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <strong>Deprecated Interface:</strong> This workflow builder is deprecated.
          <Link to="/streaming" className="text-orange-800 underline ml-1">
            Switch to the new Streaming View
          </Link> for better performance and real-time features.
        </div>
      </div>
      <header className="flex items-center justify-between p-4 border-b">
        <h1 className="text-xl font-bold">Workflow Builder (Deprecated)</h1>
        <div>
          <Link to="/streaming">
            <Button variant="outline" className="mr-2">Streaming View</Button>
          </Link>
          <Button onClick={handleRunFlow}>Run</Button>
          <Link to="/streaming">
            <Button onClick={handleRunFlow} className="ml-2">Run in Streaming Mode</Button>
          </Link>
        </div>
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
};

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<FlowBuilder />} />
        <Route path="/streaming" element={<StreamingPage />} />
      </Routes>
    </Router>
  );
}

export default App;
