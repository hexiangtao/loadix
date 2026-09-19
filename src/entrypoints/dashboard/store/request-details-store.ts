import { create } from 'zustand';
import type { RequestResult } from '@/shared/types';

interface RequestDetailsState {
  selectedRequest: RequestResult | null;
  setSelectedRequest: (request: RequestResult | null) => void;
}

export const useRequestDetailsStore = create<RequestDetailsState>((set) => ({
  selectedRequest: null,
  setSelectedRequest: (selectedRequest) => set({ selectedRequest }),
}));
