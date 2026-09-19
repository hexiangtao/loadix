import type { EngineHost } from '@/engine/engine-host';
import { DashboardShell } from './shell/DashboardShell';

/** Dashboard entry point. All navigation and feature orchestration lives in the shell. */
export default function App({ host }: { host: EngineHost }) {
  return <DashboardShell host={host} />;
}
