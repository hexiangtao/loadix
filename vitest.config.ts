import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Same `@` convention as wxt and the standalone web build.
      '@': path.resolve(__dirname, 'src'),
      // functions/ backend cores are plain ESM (.mjs); they import the
      // dashboard's TS resolver with an explicit .js that must map to .ts.
      // Alias matches the bare specifier (esbuild resolves .js → .ts the
      // same way when bundling the Pages Functions).
      '../../src/entrypoints/dashboard/media/mediaResolver.js': path.resolve(
        __dirname,
        'src/entrypoints/dashboard/media/mediaResolver.ts',
      ),
      // …and the failure taxonomy it reports through, so the backend core can
      // classify a network error itself instead of shipping a bare string the
      // client would have to guess at.
      '../../src/entrypoints/dashboard/media/resolveFailure.js': path.resolve(
        __dirname,
        'src/entrypoints/dashboard/media/resolveFailure.ts',
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'functions/**/*.test.mjs'],
  },
});