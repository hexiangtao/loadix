import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: 'src',
  // WXT resolves `publicDir` relative to `srcDir`, so the default would
  // land on `<root>/src/public`. Step up one level so the icons, SVG and
  // any future static asset at `<root>/public/*` are picked up by the
  // build (and copied into `.output/chrome-mv3/`).
  publicDir: '../public',
  vite: () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plugins: [tailwindcss() as any],
  }),
  manifest: {
    name: 'Loadix',
    description: 'Loadix — a browser-based HTTP API load & stress testing workbench.',
    icons: {
      16: 'icon-16.png',
      32: 'icon-32.png',
      48: 'icon-48.png',
      128: 'icon-128.png',
    },
    permissions: ['storage', 'tabs', 'scripting', 'activeTab'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'Loadix',
    },
    // The area-selector content script is injected on-demand by the SW. The
    // file path is `content-scripts/area-selector.js` after WXT builds the
    // extension, so we expose it via web_accessible_resources.
    web_accessible_resources: [
      {
        resources: ['content-scripts/area-selector.js'],
        matches: ['<all_urls>'],
      },
    ],
    commands: {
      'capture-region': {
        suggested_key: {
          default: 'Alt+Shift+S',
          mac: 'Alt+Shift+S',
        },
        description: 'Capture a region of the active tab',
      },
    },
  },
});
