import React from 'react';

export type PixiUnderlayHandle = {
  emitTransmit: (fromId: string, toId: string, size?: number) => void;
  pulseNode: (nodeId: string) => void;
  setViewport: (vp: { x: number; y: number; zoom: number }) => void;
  setSize: (w: number, h: number) => void;
};

type NodeLike = { id: string; position: { x: number; y: number } };

type Props = {
  nodes: NodeLike[];
  viewport: { x: number; y: number; zoom: number };
  width: number;
  height: number;
  throughput?: number;
  className?: string;
};

/**
 * Stub PixiUnderlay
 * - Intentionally does NOT import 'pixi.js'
 * - Exports the same handle and a component that renders null
 * - Guarantees no WebGL/shader code paths are used, even if imported
 */
const PixiUnderlay = React.forwardRef(function PixiUnderlay(
  _props: Props,
  ref: React.Ref<PixiUnderlayHandle>
) {
  React.useImperativeHandle(ref, () => ({
    emitTransmit: () => {},
    pulseNode: () => {},
    setViewport: () => {},
    setSize: () => {},
  }));
  return null;
});

export default PixiUnderlay;