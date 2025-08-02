/**
 * @deprecated This component is deprecated. Property inspection is now handled
 * through the streaming UI components (StreamingConsole and StreamingControls).
 * This component will be removed in a future version.
 *
 * Migration Guide:
 * - Use StreamingConsole for real-time property monitoring
 * - Use StreamingControls for property configuration
 * - The streaming interface provides better real-time property inspection
 */

import React from 'react';
import useStore from '../store';
import { Node } from 'reactflow';

/**
 * @deprecated Use StreamingConsole and StreamingControls instead
 */
const PropertyInspector: React.FC = () => {
  // Add deprecation warning
  React.useEffect(() => {
    console.warn(
      'PropertyInspector is deprecated. Use StreamingConsole and StreamingControls instead. ' +
      'This component will be removed in a future version.'
    );
  }, []);
  const selectedNodeId = useStore((state) => state.selectedNodeId);
  const nodes = useStore((state) => state.nodes);
  const updateNodeConfig = useStore((state) => state.updateNodeConfig);

  const selectedNode: Node | undefined = selectedNodeId
    ? nodes.find((node) => node.id === selectedNodeId)
    : undefined;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (selectedNodeId) {
      updateNodeConfig(selectedNodeId, { [e.target.name]: e.target.value });
    }
  };

  if (!selectedNode) {
    return (
      <div className="p-4 text-center text-gray-500">
        Select a node to configure its properties.
      </div>
    );
  }

  return (
    <div className="p-4 border-l h-full overflow-y-auto">
      <h2 className="text-lg font-semibold mb-4">Node Properties</h2>
      <div className="mb-2">
        <strong>ID:</strong> {selectedNode.id}
      </div>
      <div className="mb-2">
        <strong>Type:</strong> {selectedNode.type}
      </div>
      <div className="mb-4">
        <strong>Label:</strong>
        <input
          type="text"
          name="label"
          value={(selectedNode.data?.label as string) || ''}
          onChange={handleInputChange}
          className="w-full p-2 border rounded mt-1"
        />
      </div>
      {/* Placeholder for dynamic fields based on node type */}
      <p className="text-sm text-gray-600">
        Additional properties will appear here based on the node type.
      </p>
    </div>
  );
};

export default PropertyInspector;