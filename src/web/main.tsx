import { createRoot } from 'react-dom/client';
import App from '@/entrypoints/dashboard/App';
import { BrowserEngineHost } from '@/engine/browser-engine-host';
import { initI18n } from '@/entrypoints/dashboard/i18n';
import '@/entrypoints/dashboard/app.css';

function showBootstrapError(error: unknown) {
  const host = document.getElementById('app');
  if (!host) return;
  host.innerHTML = '<main style="min-height:100vh;padding:32px 20px;font:16px/1.6 system-ui,sans-serif;color:#1d1d1f;background:#f5f5f7"><h1 style="font-size:20px;margin:0 0 12px">Loadix could not start</h1><p style="margin:0;color:#6e6e73">Please reload the page. The viewer failed before the application mounted.</p></main>';
  console.error('[loadix] bootstrap failed:', error);
}

async function bootstrap() {
  try {
    await initI18n();
    const host = new BrowserEngineHost();
    const mount = document.getElementById('app');
    if (!mount) throw new Error('Application mount point is missing');
    createRoot(mount).render(<App host={host} />);
  } catch (error) {
    showBootstrapError(error);
  }
}

void bootstrap();
