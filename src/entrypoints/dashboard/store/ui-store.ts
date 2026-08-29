import { create } from 'zustand';
import type { EngineState, MetricsSnapshot, TestConfig } from '@/shared/types';

interface UiState {
  activeSection: 'request' | 'load' | 'assertions' | 'variables' | 'history';
  engineState: EngineState;
  resultMessage: string;
  metrics: MetricsSnapshot | null;
  config: TestConfig | null;
  setActiveSection: (section: UiState['activeSection']) => void;
  setEngineState: (state: EngineState, message?: string) => void;
  setMetrics: (metrics: MetricsSnapshot) => void;
  setConfig: (config: TestConfig) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeSection: 'request',
  engineState: 'idle',
  resultMessage: '',
  metrics: null,
  config: null,
  setActiveSection: (activeSection) => set({ activeSection }),
  setEngineState: (engineState, message) => set({ engineState, resultMessage: message ?? '' }),
  setMetrics: (metrics) => set({ metrics }),
  setConfig: (config) => set({ config }),
}));
