export interface CursorPosition {
  x: number;
  y: number;
  userId: string;
  userName: string;
}

export interface WorkflowChange {
  type: 'add' | 'remove' | 'update';
  payload: any; // This can be more specific later, e.g., NodeChange | EdgeChange
}

export interface CollaborationEvent {
  type: 'user_cursor_updated' | 'workflow_state_changed';
  payload: CursorPosition | WorkflowChange[];
}

export interface CollaborationFeatures {
  sendCursorPosition: (position: { x: number; y: number }) => void;
  sendWorkflowChanges: (changes: WorkflowChange[]) => void;
  onCursorUpdate: (callback: (position: CursorPosition) => void) => void;
  onWorkflowStateChange: (callback: (changes: WorkflowChange[]) => void) => void;
}