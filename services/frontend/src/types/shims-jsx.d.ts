/**
 * Temporary shims to satisfy TypeScript while we incrementally fix types.
 * - Provide a minimal global JSX namespace so older files that reference JSX.Element compile.
 * - Provide a compatibility module for the legacy 'react-flow-renderer' import to re-export from 'reactflow'.
 *
 * These are intentionally permissive to unblock a full compile; we can tighten types later.
 */

declare namespace JSX {
  interface Element {}
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}

declare module 'react-flow-renderer' {
  export * from 'reactflow';
}