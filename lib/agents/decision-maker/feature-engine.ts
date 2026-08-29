import type { MarketBar } from '@/lib/alpaca/types';
import type { DecisionContext } from '@/lib/agents/types';
import type { DecisionAgentConfig } from '@/lib/agents/decision-maker/config';
import { atr } from '@/lib/agents/decision-maker/indicators/atr';
import { ema } from '@/lib/agents/decision-maker/indicators/ema';
import { rsi } from '@/lib/agents/decision-maker/indicators/rsi';
import { sma } from '@/lib/agents/decision-maker/indicators/sma';
import {
  percentReturn,
  realizedVolatility,
  zScore,
} from '@/lib/agents/decision-maker/indicators/statistics';
import type {
  DataQuality,
  TechnicalFeatureSnapshot,
} from '@/lib/agents/decision-maker/types';

export type FeatureEngineResult = {
  bars: MarketBar[];
  features: TechnicalFeatureSnapshot;
  dataQuality: DataQuality;
};

function normalizeBars(bars: MarketBar[], symbol: string, observedAt: string): MarketBar[] {
  const byTimestamp = new Map<string, MarketBar>();
  const observedTime = new Date(observedAt).getTime();
  for (const bar of bars) {
    const barTime = new Date(bar.timestamp).getTime();
    if (
      bar.symbol !== symbol ||
      !bar.timestamp ||
      !Number.isFinite(barTime) ||
      (Number.isFinite(observedTime) && barTime > observedTime) ||
      !Number.isFinite(bar.open) ||
      !Number.isFinite(bar.high) ||
      !Number.isFinite(bar.low) ||
      !Number.isFinite(bar.close) ||
      bar.open <= 0 ||
      bar.high <= 0 ||
      bar.low <= 0 ||
      bar.close <= 0 ||
      bar.high < bar.low
    ) {
      continue;
    }
    byTimestamp.set(bar.timestamp, bar);
  }
  return [...byTimestamp.values()].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  );
}

export function computeFeatures(
  context: DecisionContext,
  config: DecisionAgentConfig,
): FeatureEngineResult {
  const bars = normalizeBars(
    context.underlying.bars,
    context.underlying.symbol,
    context.observedAt,
  );
  const closes = bars.map((bar) => bar.close);
  const volumes = bars.map((bar) => bar.volume);
  const latest = bars.at(-1);
  const latestPrice = latest?.close ?? 0;
  const smaShort = sma(closes, config.periods.smaShort);
  const smaLong = sma(closes, config.periods.smaLong);
  const currentAtr = atr(bars, config.periods.atr);
  const returns = closes.slice(1).map((value, index) => {
    const previous = closes[index];
    return previous > 0 ? value / previous - 1 : 0;
  });
  const priorBreakoutBars = bars.slice(-(config.periods.breakout + 1), -1);
  const recentHigh = priorBreakoutBars.length
    ? Math.max(...priorBreakoutBars.map((bar) => bar.high))
    : null;
  const recentLow = priorBreakoutBars.length
    ? Math.min(...priorBreakoutBars.map((bar) => bar.low))
    : null;
  const averageVolume = sma(volumes, config.periods.volume);

  const features: TechnicalFeatureSnapshot = {
    latestPrice,
    smaShort,
    smaLong,
    emaShort: ema(closes, config.periods.emaShort),
    rsi: rsi(closes, config.periods.rsi),
    atr: currentAtr,
    atrPercent: currentAtr !== null && latestPrice > 0 ? (currentAtr / latestPrice) * 100 : null,
    return1: percentReturn(closes, 1),
    return5: percentReturn(closes, 5),
    momentum: percentReturn(closes, config.periods.momentum),
    realizedVolatility: realizedVolatility(closes, config.periods.volatility),
    priceToSmaLongPercent:
      smaLong !== null && smaLong > 0 ? ((latestPrice - smaLong) / smaLong) * 100 : null,
    returnZScore: zScore(returns, config.periods.volatility),
    volumeRatio:
      averageVolume !== null && averageVolume > 0 && latest
        ? latest.volume / averageVolume
        : null,
    distanceFromRecentHighPercent:
      recentHigh !== null && recentHigh > 0 ? ((latestPrice - recentHigh) / recentHigh) * 100 : null,
    distanceFromRecentLowPercent:
      recentLow !== null && recentLow > 0 ? ((latestPrice - recentLow) / recentLow) * 100 : null,
  };

  const warnings: string[] = [];
  const latestBarAt = latest?.timestamp ?? null;
  const latestTime = latestBarAt ? new Date(latestBarAt).getTime() : Number.NaN;
  const observedTime = new Date(context.observedAt).getTime();
  const ageMinutes =
    Number.isFinite(latestTime) && Number.isFinite(observedTime)
      ? Math.max(0, (observedTime - latestTime) / 60_000)
      : Number.POSITIVE_INFINITY;
  const requiredBars = Math.max(
    config.thresholds.minimumBars,
    config.periods.smaLong,
    config.periods.atr + 1,
    config.periods.rsi + 1,
    config.periods.breakout + 1,
  );
  const sufficient = bars.length >= requiredBars;
  const stale = ageMinutes > config.thresholds.maximumBarAgeMinutes;
  if (!sufficient) warnings.push(`Only ${bars.length} valid bars; ${requiredBars} required.`);
  if (stale) warnings.push('The latest underlying bar is stale for this strategy configuration.');
  if (bars.length !== context.underlying.bars.length) {
    warnings.push('Invalid or duplicate market bars were removed before analysis.');
  }

  return {
    bars,
    features,
    dataQuality: {
      sufficient,
      stale,
      barsReceived: bars.length,
      barsRequired: requiredBars,
      latestBarAt,
      warnings,
    },
  };
}
