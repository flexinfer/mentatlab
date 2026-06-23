/// <reference types="vitest" />

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'pixi.js': path.resolve(__dirname, './src/vendor/pixi-stub.js'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/e2e/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
      include: [
        'src/components/**',
        'src/stores/**',
        'src/hooks/**',
        'src/services/streaming/**',
        'src/transport/**',
      ],
      exclude: ['**/__tests__/**', '**/*.test.*', '**/*.spec.*', '**/e2e/**'],
      // Per-file floors for the critical streaming/transport modules, set just
      // below current coverage so they cannot silently regress. Only the keyed
      // files are gated; untested neighbors are reported but not enforced.
      // Ratchet up as coverage improves.
      thresholds: {
        'src/services/streaming/parse.ts': { statements: 55, branches: 80, functions: 50, lines: 55 },
        'src/services/streaming/orchestratorSSE.ts': { statements: 40, branches: 50, functions: 75, lines: 40 },
        'src/transport/event-pipeline.ts': { statements: 70, branches: 70, functions: 70, lines: 70 },
      },
    },
  },
});
