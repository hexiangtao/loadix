import { create } from 'zustand';
import type { EngineState, MetricsSnapshot, RequestResult, TestConfig } from '@/shared/types';

export type Theme = 'light' | 'dark';

interface UiState {
  activeSection: 'request' | 'load' | 'assertions' | 'variables' | 'history';
  engineState: EngineState;
  resultMessage: string;
  metrics: MetricsSnapshot | null;
  config: TestConfig | null;
  theme: Theme;
  /** Request currently shown in the detail drawer. Cleared on close. */
  selectedRequest: RequestResult | null;
  setActiveSection: (section: UiState['activeSection']) => void;
  setEngineState: (state: EngineState, message?: string) => void;
  setMetrics: (metrics: MetricsSnapshot) => void;
  setConfig: (config: TestConfig) => void;
  setTheme: (theme: Theme) => void;
  setSelectedRequest: (request: RequestResult | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeSection: 'request',
  engineState: 'idle',
  resultMessage: '',
  metrics: null,
  config: null,
  theme: 'light',
  selectedRequest: null,
  setActiveSection: (activeSection) => set({ activeSection }),
  setEngineState: (engineState, message) => set({ engineState, resultMessage: message ?? '' }),
  setMetrics: (metrics) => set({ metrics }),
  setConfig: (config) => set({ config }),
  setTheme: (theme) => set({ theme }),
  setSelectedRequest: (selectedRequest) => set({ selectedRequest }),
}));
