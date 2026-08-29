import { createRoot } from 'react-dom/client';
import App from './App';
import { initI18n } from './i18n';
import './app.css';

async function bootstrap() {
  await initI18n();
  const root = createRoot(document.getElementById('app')!);
  root.render(<App />);
}

void bootstrap();
