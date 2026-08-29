import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: 'src',
  vite: () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plugins: [tailwindcss() as any],
  }),
  manifest: {
    name: 'LoadForge',
    description: 'LoadForge — a browser-based HTTP API load & stress testing workbench.',
    permissions: ['storage'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'LoadForge',
    },
  },
});
