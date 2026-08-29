import { createRoot } from 'react-dom/client';
import App from './App';
import { ChromeEngineHost } from '@/engine/chrome-engine-host';
import { initI18n } from './i18n';
import './app.css';

async function bootstrap() {
  await initI18n();
  const host = new ChromeEngineHost();
  const root = createRoot(document.getElementById('app')!);
  root.render(<App host={host} />);
}

void bootstrap();
