import type { SentimentSignal } from '@/lib/agents/decision-maker/types';

export type SentimentRequest = {
  underlying: string;
  asOf: string;
  lookbackHours: number;
};

export interface SentimentProvider {
  analyze(request: SentimentRequest): Promise<SentimentSignal>;
}

export const unavailableSentiment: SentimentSignal = {
  status: 'unavailable',
  observedAt: null,
  score: null,
  confidence: null,
  sources: [],
  explanation: null,
};
