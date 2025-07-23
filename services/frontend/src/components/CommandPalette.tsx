import React, { useState, useEffect, useCallback } from 'react';
import useStore from '../store';
import { Node } from 'reactflow';
import { NodeType } from '../types/NodeOperations';
import { Position } from '../types/graph';

interface Command {
  id: string;
  name: string;
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredCommands, setFilteredCommands] = useState<Command[]>([]);

  const {
    nodes,
    selectedNodeId,
    createNode,
    duplicateNode,
    deleteNodes,
  } = useStore();

  const commands: Command[] = [
    {
      id: 'create-node-default',
      name: 'Create Default Node',
      action: () => {
        const position: Position = { x: 100, y: 100 }; // Default position
        createNode('default', position);
        onClose();
      },
    },
    {
      id: 'create-node-input',
      name: 'Create Input Node',
      action: () => {
        const position: Position = { x: 100, y: 100 }; // Default position
        createNode('input', position);
        onClose();
      },
    },
    {
      id: 'create-node-output',
      name: 'Create Output Node',
      action: () => {
        const position: Position = { x: 100, y: 100 }; // Default position
        createNode('output', position);
        onClose();
      },
    },
    {
      id: 'duplicate-selected-node',
      name: 'Duplicate Selected Node',
      action: () => {
        if (selectedNodeId) {
          duplicateNode(selectedNodeId);
        } else {
          alert('No node selected to duplicate.');
        }
        onClose();
      },
    },
    {
      id: 'delete-selected-node',
      name: 'Delete Selected Node',
      action: () => {
        if (selectedNodeId) {
          deleteNodes([selectedNodeId]);
        } else {
          alert('No node selected to delete.');
        }
        onClose();
      },
    },
    // Add more commands here as needed
    {
      id: 'save-workflow',
      name: 'Save Workflow (Not Implemented)',
      action: () => {
        alert('Save Workflow functionality is not yet implemented.');
        onClose();
      },
    },
  ];

  useEffect(() => {
    if (searchTerm === '') {
      setFilteredCommands(commands);
    } else {
      // Simple fuzzy search for now
      const lowerCaseSearchTerm = searchTerm.toLowerCase();
      setFilteredCommands(
        commands.filter((cmd) =>
          cmd.name.toLowerCase().includes(lowerCaseSearchTerm)
        )
      );
    }
  }, [searchTerm, nodes, selectedNodeId]); // Added dependencies for commands

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    } else {
      document.removeEventListener('keydown', handleKeyDown);
      setSearchTerm(''); // Clear search term when closed
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-11/12 max-w-md p-4">
        <input
          type="text"
          placeholder="Search commands..."
          className="w-full p-2 border border-gray-300 rounded-md mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          autoFocus
        />
        <ul className="max-h-60 overflow-y-auto">
          {filteredCommands.length > 0 ? (
            filteredCommands.map((command) => (
              <li
                key={command.id}
                className="p-2 hover:bg-gray-100 cursor-pointer rounded-md"
                onClick={command.action}
              >
                {command.name}
              </li>
            ))
          ) : (
            <li className="p-2 text-gray-500">No commands found.</li>
          )}
        </ul>
      </div>
    </div>
  );
};

export default CommandPalette;