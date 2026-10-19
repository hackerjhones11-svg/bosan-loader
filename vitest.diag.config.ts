import { defineConfig } from 'vitest/config';

// Optional developer diagnostic, never part of `npm test`: prints an empirical
// symbol distribution from the real crypto-backed roller.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/**/*.diag.ts'],
  },
});
