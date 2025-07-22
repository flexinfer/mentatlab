import { Handle, Position } from 'react-flow-renderer';

export default function ChatNode() {
  return (
    <div className="p-2 bg-white rounded shadow">
      <Handle type="target" position={Position.Top} />
      <div className="text-xs font-bold">Chat</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
