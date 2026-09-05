import { defineConfig, defaultExclude } from 'vitest/config';
import path from 'path';
import { transformWithOxc } from 'vite';

export default defineConfig({
  // Match Next's support for JSX in existing .js components, so flow tests
  // exercise the real loading and form components rather than replacing them.
  plugins: [{
    name: 'application-jsx',
    enforce: 'pre',
    transform(code, id) {
      if (id.includes('/src/') && id.endsWith('.js')) {
        return transformWithOxc(code, `${id}.jsx`, { jsx: { runtime: 'automatic' } });
      }
    },
  }],
  oxc: { jsx: { runtime: 'automatic' } },
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
