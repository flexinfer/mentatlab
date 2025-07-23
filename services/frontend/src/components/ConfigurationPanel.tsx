import React, { useState, useEffect } from 'react';
import useStore from '../store'; // Import the Zustand store
// import { Label } from '@/components/ui/label'; // Commented out as Shadcn/ui components not found
// import { Input } from '@/components/ui/input'; // Commented out as Shadcn/ui components not found

const ConfigurationPanel: React.FC = () => {
  const [schema, setSchema] = useState<any>(null);
  const [formData, setFormData] = useState<{ [key: string]: any }>({});

  const selectedNodeId = useStore((state) => state.selectedNodeId);
  const nodes = useStore((state) => state.nodes);
  const updateNodeConfig = useStore((state) => state.updateNodeConfig);

  const selectedNode = selectedNodeId
    ? nodes.find((node) => node.id === selectedNodeId)
    : null;
  const selectedNodeType = selectedNode?.type || null;

  useEffect(() => {
    if (selectedNodeType) {
      // Fetch schema
      const fetchSchema = async () => {
        try {
          const response = await fetch(`/api/v1/agents/${selectedNodeType}/schema`);
          if (response.ok) {
            const data = await response.json();
            setSchema(data);
            // Initialize form data with existing node data or empty strings
            const initialFormData: { [key: string]: any } = {};
            if (data.properties) {
              Object.keys(data.properties).forEach(key => {
                initialFormData[key] = selectedNode?.data?.[key] || '';
              });
            }
            setFormData(initialFormData);
          } else {
            console.error('Failed to fetch schema:', response.statusText);
            setSchema(null);
            setFormData({});
          }
        } catch (error) {
          console.error('Error fetching schema:', error);
          setSchema(null);
          setFormData({});
        }
      };
      fetchSchema();
    } else {
      setSchema(null);
      setFormData({});
    }
  }, [selectedNodeType, selectedNode]); // Add selectedNode to dependency array

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prevData => ({
      ...prevData,
      [name]: value,
    }));
    if (selectedNodeId) {
      updateNodeConfig(selectedNodeId, { [name]: value });
    }
  };

  if (!selectedNodeId || !selectedNodeType) {
    return (
      <div className="p-4 text-center text-gray-500">
        Select a node to configure.
      </div>
    );
  }

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-4">Configure {selectedNodeType} Node</h2>
      {schema && schema.properties ? (
        <form className="space-y-4">
          {Object.keys(schema.properties).map(key => {
            const property = schema.properties[key];
            if (property.type === 'string') {
              return (
                <div key={key}>
                  <label htmlFor={key} className="block text-sm font-medium text-gray-700">
                    {property.title || key}
                  </label>
                  <input
                    id={key}
                    name={key}
                    type="text"
                    value={formData[key] || ''}
                    onChange={handleInputChange}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  />
                </div>
              );
            }
            return null;
          })}
        </form>
      ) : (
        <p>No configurable parameters for this node type.</p>
      )}
    </div>
  );
};

export default ConfigurationPanel;