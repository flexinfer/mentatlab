import { Handle, Position, type NodeProps } from 'reactflow';

type PythonCodeNodeData = {
  label?: string;
};

export default function PythonCodeNode({ data }: NodeProps<PythonCodeNodeData>) {
  return (
    <div className="min-w-[150px] rounded-lg border border-emerald-300 bg-emerald-50 p-2 text-emerald-950 shadow-sm dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-100">
      <Handle type="target" position={Position.Top} />
      <div className="text-xs font-bold">{data.label ?? 'Python Code'}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
