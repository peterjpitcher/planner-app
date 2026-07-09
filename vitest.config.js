import { defineConfig, defaultExclude } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/lib/__tests__/setup.js'],
    // Ignore git worktrees created under .claude/ (e.g. background-task sessions)
    // so their duplicate copies of the test files are not discovered.
    exclude: [...defaultExclude, '**/.claude/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(new URL('.', import.meta.url).pathname, './src'),
    },
  },
});
