import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Same `@` convention as wxt and the standalone web build.
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'functions/**/*.test.mjs'],
  },
});