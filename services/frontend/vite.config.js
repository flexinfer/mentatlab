import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: './',
  server: {
    // Proxy API calls (only used in local dev, not in production preview mode)
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:7070',
        changeOrigin: true,
        secure: false,
        // keep path unchanged; backend expects /api/v1/agents etc.
        rewrite: (p) => p,
      },
    },
  },
  preview: {
    // In preview mode, don't proxy - let frontend use VITE_GATEWAY_BASE_URL
    proxy: {},
  },
  optimizeDeps: {
    // Do not prebundle pixi.js; we alias it to a stub below
    exclude: ['pixi.js'],
  },
  build: {
    outDir: 'dist',
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
