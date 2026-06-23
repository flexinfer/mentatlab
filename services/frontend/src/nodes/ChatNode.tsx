import { Handle, Position, type NodeProps } from 'reactflow';

type ChatNodeData = {
  label?: string;
  prompt?: string;
};

export default function ChatNode({ data }: NodeProps<ChatNodeData>) {
  return (
    <div className="min-w-[150px] rounded-lg border border-sky-300 bg-sky-50 p-2 text-sky-950 shadow-sm dark:border-sky-700 dark:bg-sky-900/20 dark:text-sky-100">
      <Handle type="target" position={Position.Top} />
      <div className="text-xs font-bold">{data.label ?? 'Chat'}</div>
      {data.prompt && (
        <div className="mt-1 max-w-[190px] truncate text-[10px] text-sky-700 dark:text-sky-300">
          {data.prompt}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
