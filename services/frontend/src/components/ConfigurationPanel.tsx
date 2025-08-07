import React, { useState, useEffect, ChangeEvent } from 'react'; // Explicitly import ChangeEvent
import DOMPurify from 'dompurify';
import useStore from '../store'; // Import the Zustand store
// import { Label } from '@/components/ui/label'; // Commented out as Shadcn/ui components not found
// import { Input } from '@/components/ui/input'; // Commented out as Shadcn/ui components not found

// Input validation utilities
const validateInput = (value: string, type: string): { isValid: boolean; error?: string } => {
  // Sanitize input first
  const sanitized = DOMPurify.sanitize(value);
  
  // Basic length validation
  if (sanitized.length > 1000) {
    return { isValid: false, error: 'Input too long (max 1000 characters)' };
  }
  
  // Type-specific validation
  switch (type) {
    case 'email':
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(sanitized)) {
        return { isValid: false, error: 'Invalid email format' };
      }
      break;
    case 'url':
      try {
        new URL(sanitized);
      } catch {
        return { isValid: false, error: 'Invalid URL format' };
      }
      break;
    case 'number':
      if (isNaN(Number(sanitized))) {
        return { isValid: false, error: 'Must be a valid number' };
      }
      break;
  }
  
  // Check for potentially dangerous patterns
  const dangerousPatterns = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /data:text\/html/gi
  ];
  
  for (const pattern of dangerousPatterns) {
    if (pattern.test(sanitized)) {
      return { isValid: false, error: 'Input contains potentially dangerous content' };
    }
  }
  
  return { isValid: true };
};

const ConfigurationPanel: React.FC = (): React.JSX.Element => { // Explicitly define return type
  const [schema, setSchema] = useState<any>(null);
  const [formData, setFormData] = useState<{ [key: string]: any }>({});
  const [validationErrors, setValidationErrors] = useState<{ [key: string]: string }>({});

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

  const handleInputChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    const type = (e.target as HTMLInputElement).type || (e.target as HTMLSelectElement).type || (e.target as HTMLTextAreaElement).type; // Get type from appropriate element
    const checked = (e.target as HTMLInputElement).checked; // Only for checkboxes
    
    let processedValue: any = value;
    if (type === 'number') {
      processedValue = parseFloat(value);
      if (isNaN(processedValue)) {
        processedValue = undefined; // Or handle as an error
      }
    } else if (type === 'checkbox') {
      processedValue = checked;
    }

    // Validate input (only for string and number types that are not checkboxes)
    const validation = (type === 'text' || type === 'email' || type === 'url' || type === 'number')
      ? validateInput(value, type)
      : { isValid: true };
    
    // Update validation errors
    setValidationErrors(prev => ({
      ...prev,
      [name]: validation.isValid ? '' : validation.error || 'Invalid input'
    }));
    
    // Only update if validation passes or if it's a non-validated type (like boolean)
    if (validation.isValid) {
      const sanitizedValue = (typeof processedValue === 'string')
        ? DOMPurify.sanitize(processedValue)
        : processedValue;

      setFormData(prevData => ({
        ...prevData,
        [name]: sanitizedValue,
      }));
      
      if (selectedNodeId) {
        updateNodeConfig(selectedNodeId, { [name]: sanitizedValue });
      }
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
            const commonProps = {
              id: key,
              name: key,
              onChange: handleInputChange,
              className: `mt-1 block w-full rounded-md shadow-sm sm:text-sm ${
                validationErrors[key]
                  ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                  : 'border-gray-300 focus:border-indigo-500 focus:ring-indigo-500'
              }`
            };

            let inputElement: JSX.Element | null = null;

            if (property.enum) {
              // Render select dropdown for enum types
              inputElement = (
                <select {...commonProps} value={formData[key] || ''}>
                  {property.enum.map((option: any) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              );
            } else if (property.type === 'string') {
              inputElement = (
                <input
                  type={property.format || "text"}
                  value={formData[key] || ''}
                  {...commonProps}
                />
              );
            } else if (property.type === 'number') {
              inputElement = (
                <input
                  type="number"
                  value={formData[key] || ''}
                  {...commonProps}
                />
              );
            } else if (property.type === 'boolean') {
              inputElement = (
                <input
                  type="checkbox"
                  checked={formData[key] || false}
                  {...commonProps}
                  className="mt-1" // Override full width for checkbox
                />
              );
            } else if (property.type === 'array' || property.type === 'object') {
              // For complex types, display as JSON string for now
              inputElement = (
                <textarea
                  value={JSON.stringify(formData[key] || {}, null, 2)}
                  {...commonProps}
                  rows={5}
                  readOnly // Make it read-only for now
                />
              );
            }

            return (
              <div key={key}>
                <label htmlFor={key} className="block text-sm font-medium text-gray-700">
                  {property.title || key}
                </label>
                {inputElement}
                {validationErrors[key] && (
                  <p className="mt-1 text-sm text-red-600">
                    {validationErrors[key]}
                  </p>
                )}
              </div>
            );
          })}
        </form>
      ) : (
        <p>No configurable parameters for this node type.</p>
      )}
    </div>
  );
};

export default ConfigurationPanel;