import type { DecisionAgentConfig } from '@/lib/agents/decision-maker/config';
import type {
  MarketRegime,
  TechnicalFeatureSnapshot,
} from '@/lib/agents/decision-maker/types';

export function classifyMarketRegime(
  features: TechnicalFeatureSnapshot,
  config: DecisionAgentConfig,
): MarketRegime {
  if (
    (features.realizedVolatility ?? 0) >= config.thresholds.highVolatilityAnnualized ||
    (features.atrPercent ?? 0) >= config.thresholds.highAtrPercent
  ) {
    return 'high_volatility';
  }
  if (
    features.smaShort === null ||
    features.smaLong === null ||
    features.priceToSmaLongPercent === null
  ) {
    return 'unknown';
  }
  if (features.smaShort > features.smaLong && features.priceToSmaLongPercent > 0) {
    return 'trending_up';
  }
  if (features.smaShort < features.smaLong && features.priceToSmaLongPercent < 0) {
    return 'trending_down';
  }
  return 'range_bound';
}
