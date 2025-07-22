import { Handle, Position } from 'react-flow-renderer';

export default function PythonCodeNode() {
  return (
    <div className="p-2 bg-white rounded shadow">
      <Handle type="target" position={Position.Top} />
      <div className="text-xs font-bold">Python Code</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
