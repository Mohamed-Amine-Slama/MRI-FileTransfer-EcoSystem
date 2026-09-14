import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The app's tsconfig preserves JSX for Next; tests run in Node and need it compiled.
  esbuild: { jsx: 'automatic' },
  test: {
    globals: true,
    environment: 'node',
    // `e2e/` belongs to Playwright. Vitest and Playwright both define a global
    // `test()`, so collecting the same files in both runners fails with an
    // error that points at Playwright versions rather than at the real cause.
    include: [
      'app/**/*.{test,spec}.{ts,tsx}',
      'src/**/*.{test,spec}.{ts,tsx}',
      'lib/**/*.{test,spec}.{ts,tsx}',
      'components/**/*.{test,spec}.{ts,tsx}',
    ],
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
  },
});
