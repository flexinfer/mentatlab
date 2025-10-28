import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const debugBuild = (process.env.VITE_DEBUG_BUILD === 'true' || process.env.DEBUG_BUILD === 'true');

export default defineConfig({
  plugins: [react()],
  root: './',
  server: {
    // Allow external hostnames in dev (useful if testing via tunnels)
    allowedHosts: ['mentatlab.lan', 'mentatlab.flexinfer.ai'],
    // Proxy API calls (only used in local dev, not in production preview mode)
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:7070',
        changeOrigin: true,
        secure: false,
        // keep path unchanged; backend expects /api/v1/agents etc.
        rewrite: (p) => p,
      },
      // Ensure agent UIs (remoteEntry.js) under /agents/* resolve to the Orchestrator in dev
      '/agents': {
        target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:7070',
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p,
      },
    },
  },
  preview: {
    // In preview mode, don't proxy - let frontend use VITE_GATEWAY_BASE_URL
    proxy: {},
    // IMPORTANT: allow published hostnames (Ingress/Cloudflare)
    allowedHosts: ['mentatlab.lan', 'mentatlab.flexinfer.ai'],
  },
  optimizeDeps: {
    // Do not prebundle pixi.js; we alias it to a stub below
    exclude: ['pixi.js'],
  },
  build: {
    outDir: 'dist',
    sourcemap: debugBuild,
    minify: debugBuild ? false : 'esbuild',
  },
  publicDir: 'public',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Force any accidental imports of pixi.js to resolve to a no-op stub
      'pixi.js': path.resolve(__dirname, './src/vendor/pixi-stub.js'),
    },
  },
});
