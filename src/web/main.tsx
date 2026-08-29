import { createRoot } from 'react-dom/client';
import App from '@/entrypoints/dashboard/App';
import { BrowserEngineHost } from '@/engine/browser-engine-host';
import { initI18n } from '@/entrypoints/dashboard/i18n';
import '@/entrypoints/dashboard/app.css';

async function bootstrap() {
  await initI18n();
  const host = new BrowserEngineHost();
  const root = createRoot(document.getElementById('app')!);
  root.render(<App host={host} />);
}

void bootstrap();
