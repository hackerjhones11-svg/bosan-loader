import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    // The lazily loaded 3D chunk (three.js + React Three Fiber + cannon-es, ~280 kB gzip)
    // is the only large one; R3F references the whole THREE namespace, so it cannot shrink further.
    chunkSizeWarningLimit: 1100,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
