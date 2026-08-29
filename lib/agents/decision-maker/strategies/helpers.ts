import type {
  SignalContribution,
  SignalDirection,
  ThesisType,
} from '@/lib/agents/decision-maker/types';

export function clampScore(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

export function contribution(
  strategy: ThesisType,
  score: number,
  weight: number,
  evidence: string[],
): SignalContribution {
  const normalized = clampScore(score);
  const direction: SignalDirection =
    normalized > 0.05 ? 'bullish' : normalized < -0.05 ? 'bearish' : 'neutral';
  return {
    strategy,
    direction,
    score: normalized,
    weight,
    weightedScore: normalized * weight,
    evidence,
  };
}
