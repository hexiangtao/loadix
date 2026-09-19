import { create } from 'zustand';
import type { EngineState, MetricsSnapshot } from '@/shared/types';

export type LoadTestSection = 'request' | 'load' | 'assertions' | 'variables' | 'history';

interface LoadTestState {
  activeSection: LoadTestSection;
  engineState: EngineState;
  resultMessage: string;
  metrics: MetricsSnapshot | null;
  setActiveSection: (section: LoadTestSection) => void;
  setEngineState: (state: EngineState, message?: string) => void;
  setMetrics: (metrics: MetricsSnapshot) => void;
}

export const useLoadTestStore = create<LoadTestState>((set) => ({
  activeSection: 'request',
  engineState: 'idle',
  resultMessage: '',
  metrics: null,
  setActiveSection: (activeSection) => set({ activeSection }),
  setEngineState: (engineState, message) => set({ engineState, resultMessage: message ?? '' }),
  setMetrics: (metrics) => set({ metrics }),
}));
