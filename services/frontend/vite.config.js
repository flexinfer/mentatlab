import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: './',
  server: {
    // Proxy API calls to the local orchestrator so Vite doesn't serve index.html
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8081',
        changeOrigin: true,
        secure: false,
        // keep path unchanged; backend expects /api/v1/agents etc.
        rewrite: (p) => p,
      },
    },
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