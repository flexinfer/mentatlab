import React from 'react';
import { CursorPosition } from '../types/collaboration';

interface CollaboratorCursorProps {
  cursor: CursorPosition;
}

const CollaboratorCursor: React.FC<CollaboratorCursorProps> = ({ cursor }) => {
  return (
    <div
      style={{
        position: 'absolute',
        left: cursor.x,
        top: cursor.y,
        pointerEvents: 'none',
        zIndex: 1000,
      }}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-blue-500" // You can make this dynamic based on user ID for different colors
      >
        <polygon points="4 4 12 20 20 4 4 4" fill="currentColor" />
      </svg>
      <div
        style={{
          position: 'absolute',
          top: -20,
          left: 0,
          background: 'rgba(0,0,0,0.7)',
          color: 'white',
          padding: '2px 6px',
          borderRadius: '4px',
          fontSize: '0.75rem',
          whiteSpace: 'nowrap',
        }}
      >
        {cursor.userName}
      </div>
    </div>
  );
};

export default CollaboratorCursor;