import type { DecisionAgentConfig } from '@/lib/agents/decision-maker/config';
import { contribution } from '@/lib/agents/decision-maker/strategies/helpers';
import type {
  MarketRegime,
  SignalContribution,
  TechnicalFeatureSnapshot,
} from '@/lib/agents/decision-maker/types';

export function meanReversionSignal(
  features: TechnicalFeatureSnapshot,
  regime: MarketRegime,
  config: DecisionAgentConfig,
): SignalContribution {
  let score = 0;
  const evidence: string[] = [];
  if (features.rsi !== null) {
    if (features.rsi < 30) score += Math.min(0.5, (30 - features.rsi) / 25);
    if (features.rsi > 70) score -= Math.min(0.5, (features.rsi - 70) / 25);
    evidence.push(`RSI mean-reversion input is ${features.rsi.toFixed(1)}.`);
  }
  if (features.returnZScore !== null) {
    if (features.returnZScore < -1) score += Math.min(0.5, Math.abs(features.returnZScore) / 4);
    if (features.returnZScore > 1) score -= Math.min(0.5, Math.abs(features.returnZScore) / 4);
    evidence.push(`Return z-score is ${features.returnZScore.toFixed(2)}.`);
  }
  if (regime === 'trending_up' || regime === 'trending_down') {
    score *= 0.5;
    evidence.push('A trending regime reduced the mean-reversion score.');
  }
  return contribution(
    'mean_reversion',
    score,
    config.strategyWeights.meanReversion,
    evidence,
  );
}
