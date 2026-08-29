import type { DecisionAgentConfig } from '@/lib/agents/decision-maker/config';
import { contribution } from '@/lib/agents/decision-maker/strategies/helpers';
import type {
  MarketRegime,
  SignalContribution,
  TechnicalFeatureSnapshot,
} from '@/lib/agents/decision-maker/types';

export function trendFollowingSignal(
  features: TechnicalFeatureSnapshot,
  regime: MarketRegime,
  config: DecisionAgentConfig,
): SignalContribution {
  let score = 0;
  const evidence: string[] = [];
  if (features.smaShort !== null && features.smaLong !== null) {
    if (features.smaShort > features.smaLong) {
      score += 0.4;
      evidence.push('Short SMA is above long SMA.');
    } else if (features.smaShort < features.smaLong) {
      score -= 0.4;
      evidence.push('Short SMA is below long SMA.');
    }
  }
  if (features.priceToSmaLongPercent !== null) {
    score += Math.sign(features.priceToSmaLongPercent) * 0.2;
    evidence.push(
      `Price is ${Math.abs(features.priceToSmaLongPercent).toFixed(2)}% ${features.priceToSmaLongPercent >= 0 ? 'above' : 'below'} the long SMA.`,
    );
  }
  if (features.momentum !== null) {
    score += Math.sign(features.momentum) * Math.min(0.2, Math.abs(features.momentum) * 8);
    evidence.push(`Momentum is ${(features.momentum * 100).toFixed(2)}%.`);
  }
  if (features.rsi !== null) {
    if (features.rsi >= 50 && features.rsi <= 72) score += 0.1;
    if (features.rsi <= 50 && features.rsi >= 28) score -= 0.1;
    if (features.rsi > 78) score -= 0.12;
    if (features.rsi < 22) score += 0.12;
    evidence.push(`RSI is ${features.rsi.toFixed(1)}.`);
  }
  if (regime === 'high_volatility') {
    score *= 0.75;
    evidence.push('High volatility reduced the trend score.');
  }
  return contribution(
    'trend_following',
    score,
    config.strategyWeights.trendFollowing,
    evidence,
  );
}
