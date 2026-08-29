import type { DecisionAgentConfig } from '@/lib/agents/decision-maker/config';
import { contribution } from '@/lib/agents/decision-maker/strategies/helpers';
import type {
  SignalContribution,
  TechnicalFeatureSnapshot,
} from '@/lib/agents/decision-maker/types';

export function breakoutSignal(
  features: TechnicalFeatureSnapshot,
  config: DecisionAgentConfig,
): SignalContribution {
  let score = 0;
  const evidence: string[] = [];
  if ((features.distanceFromRecentHighPercent ?? -1) > 0) {
    score += 0.65;
    evidence.push('Price broke above the prior rolling high.');
  }
  if ((features.distanceFromRecentLowPercent ?? 1) < 0) {
    score -= 0.65;
    evidence.push('Price broke below the prior rolling low.');
  }
  if (score !== 0 && (features.volumeRatio ?? 0) >= 1.2) {
    score += Math.sign(score) * 0.2;
    evidence.push(`Breakout volume is ${(features.volumeRatio ?? 0).toFixed(2)}× average.`);
  }
  if (score === 0) evidence.push('No confirmed rolling high or low breakout.');
  return contribution('breakout', score, config.strategyWeights.breakout, evidence);
}
