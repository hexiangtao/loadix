import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const resolve = (p: string) => path.resolve(__dirname, p);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Standalone Vite build for the web (non-extension) version of Loadix.
// The web app reuses the shared dashboard UI + engine, but runs the engine
// in-page via BrowserEngineHost (no Chrome API, subject to CORS).
export default defineConfig({
  root: path.resolve(__dirname, 'src/web'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/web'),
    emptyOutDir: true,
    // Multi-page: the workbench (index.html) plus the lean read-only viewer
    // (share.html) that renders shared markdown documents at /s/<id>.
    rollupOptions: {
      input: {
        'index.html': resolve('src/web/index.html'),
        'share.html': resolve('src/web/share.html'),
      },
    },
  },
});
