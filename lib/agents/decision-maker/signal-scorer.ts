import type { DecisionAgentConfig } from '@/lib/agents/decision-maker/config';
import { clampScore } from '@/lib/agents/decision-maker/strategies/helpers';
import type {
  SentimentSignal,
  SignalContribution,
} from '@/lib/agents/decision-maker/types';

export type SignalScore = {
  contributions: SignalContribution[];
  finalScore: number;
  conflicting: boolean;
};

export function combineSignals(
  technicalContributions: SignalContribution[],
  sentiment: SentimentSignal,
  config: DecisionAgentConfig,
): SignalScore {
  const contributions = [...technicalContributions];
  if (
    sentiment.status === 'available' &&
    sentiment.score !== null &&
    config.strategyWeights.sentiment > 0
  ) {
    const score = clampScore(sentiment.score * (sentiment.confidence ?? 1));
    contributions.push({
      strategy: 'sentiment',
      direction: score > 0.05 ? 'bullish' : score < -0.05 ? 'bearish' : 'neutral',
      score,
      weight: config.strategyWeights.sentiment,
      weightedScore: score * config.strategyWeights.sentiment,
      evidence: sentiment.explanation ? [sentiment.explanation] : [],
    });
  }

  const totalWeight = contributions.reduce((total, item) => total + item.weight, 0);
  const finalScore = clampScore(
    totalWeight > 0
      ? contributions.reduce((total, item) => total + item.weightedScore, 0) / totalWeight
      : 0,
  );
  const bullishWeight = contributions.reduce(
    (total, item) => total + Math.max(0, item.weightedScore),
    0,
  );
  const bearishWeight = contributions.reduce(
    (total, item) => total + Math.max(0, -item.weightedScore),
    0,
  );
  const conflicting =
    bullishWeight >= 0.1 &&
    bearishWeight >= 0.1 &&
    Math.abs(bullishWeight - bearishWeight) <= config.thresholds.conflictingSignalGap;

  return { contributions, finalScore, conflicting };
}
