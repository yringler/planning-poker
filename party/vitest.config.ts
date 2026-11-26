import { defineConfig } from 'vitest/config';

// Node tests for the Durable Object. The Angular app's specs run through `ng test` instead.
export default defineConfig({
  // Keep Vite's cache in the root node_modules instead of creating party/node_modules
  cacheDir: '../node_modules/.vite-party',
  test: {
    root: __dirname,
    environment: 'node',
    include: ['**/*.spec.ts'],
    setupFiles: ['./test/setup.ts'],
    restoreMocks: true,
    server: {
      // Load y-partyserver through Vite so `vi.mock('partyserver')` also applies to its import
      deps: { inline: ['y-partyserver'] },
    },
  },
});
