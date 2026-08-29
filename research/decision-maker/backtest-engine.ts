import type { AlpacaReadGateway, MarketBar, MarketClock } from '@/lib/alpaca/types';
import type { DecisionContext } from '@/lib/agents/types';
import {
  defaultDecisionAgentConfig,
  type DecisionAgentConfig,
} from '@/lib/agents/decision-maker/config';
import { DecisionMakerAgent } from '@/lib/agents/decision-maker/decision-maker';
import { summarizeBacktest } from '@/research/decision-maker/metrics';
import type {
  DecisionBacktestReport,
  DecisionObservation,
  DecisionPeriodRequest,
  ResearchTimeframe,
} from '@/research/decision-maker/types';

const TIMEFRAME_DETAILS: Record<
  ResearchTimeframe,
  { barsPerTradingDay: number; annualizationFactor: number; maximumBarAgeMinutes: number }
> = {
  '1Day': { barsPerTradingDay: 1, annualizationFactor: 252, maximumBarAgeMinutes: 2_880 },
  '1Hour': { barsPerTradingDay: 7, annualizationFactor: 252 * 7, maximumBarAgeMinutes: 180 },
  '15Min': { barsPerTradingDay: 26, annualizationFactor: 252 * 26, maximumBarAgeMinutes: 60 },
};

function agentConfigForTimeframe(timeframe: ResearchTimeframe): DecisionAgentConfig {
  const details = TIMEFRAME_DETAILS[timeframe];
  return {
    ...defaultDecisionAgentConfig,
    version: `${defaultDecisionAgentConfig.version}-${timeframe.toLowerCase()}`,
    timeframe,
    annualizationFactor: details.annualizationFactor,
    thresholds: {
      ...defaultDecisionAgentConfig.thresholds,
      maximumBarAgeMinutes: details.maximumBarAgeMinutes,
    },
  };
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function dateOnly(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function sortedUniqueBars(bars: MarketBar[], symbol: string): MarketBar[] {
  const values = new Map<string, MarketBar>();
  for (const bar of bars) {
    if (bar.symbol === symbol && bar.timestamp && Number.isFinite(bar.close) && bar.close > 0) {
      values.set(bar.timestamp, bar);
    }
  }
  return [...values.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function recentReturns(bars: MarketBar[]): number[] {
  return bars.slice(1).map((bar, index) => {
    const previous = bars[index]?.close ?? 0;
    return previous > 0 ? bar.close / previous - 1 : 0;
  });
}

function researchClock(timestamp: string): MarketClock {
  return {
    observedAt: timestamp,
    timestamp,
    isOpen: false,
    nextOpen: '',
    nextClose: '',
  };
}

function validateRequest(request: DecisionPeriodRequest): void {
  const start = new Date(`${request.start}T00:00:00.000Z`).getTime();
  const end = new Date(`${request.end}T23:59:59.999Z`).getTime();
  if (!request.symbol.trim()) throw new Error('A symbol is required.');
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw new Error('The backtest start must be before its end.');
  }
  if (request.lookbackBars < 50) throw new Error('At least 50 lookback bars are required.');
  if (request.evaluationStepBars < 1) throw new Error('Evaluation step must be at least one bar.');
  if (!request.forwardHorizons.length || request.forwardHorizons.some((value) => value < 1)) {
    throw new Error('At least one positive forward horizon is required.');
  }
}

export async function runDecisionPeriod(
  alpaca: AlpacaReadGateway,
  request: DecisionPeriodRequest,
): Promise<DecisionBacktestReport> {
  validateRequest(request);
  const symbol = request.symbol.trim().toUpperCase();
  const details = TIMEFRAME_DETAILS[request.timeframe];
  const maximumHorizon = Math.max(...request.forwardHorizons);
  const warmupCalendarDays = Math.ceil(
    (request.lookbackBars / details.barsPerTradingDay) * 2.2 + 10,
  );
  const labelCalendarDays = Math.ceil(maximumHorizon / details.barsPerTradingDay) * 3 + 5;
  const bars = sortedUniqueBars(
    await alpaca.getUnderlyingHistory({
      symbols: [symbol],
      timeframe: request.timeframe,
      start: shiftDate(request.start, -warmupCalendarDays),
      end: shiftDate(request.end, labelCalendarDays),
      feed: request.feed,
      limit: 10_000,
    }),
    symbol,
  );
  if (bars.length < request.lookbackBars) {
    throw new Error(
      `Alpaca returned ${bars.length} usable bars, fewer than the ${request.lookbackBars} requested for warm-up.`,
    );
  }

  const config = agentConfigForTimeframe(request.timeframe);
  const agent = new DecisionMakerAgent(config);
  const observations: DecisionObservation[] = [];

  for (let index = request.lookbackBars - 1; index < bars.length; index += 1) {
    const bar = bars[index];
    const day = dateOnly(bar.timestamp);
    if (day < request.start || day > request.end) continue;
    if ((index - (request.lookbackBars - 1)) % request.evaluationStepBars !== 0) continue;

    const window = bars.slice(index - request.lookbackBars + 1, index + 1);
    const context: DecisionContext = {
      contextId: `backtest:${symbol}:${bar.timestamp}`,
      observedAt: bar.timestamp,
      source: 'alpaca',
      underlying: {
        symbol,
        latestPrice: bar.close,
        recentReturns: recentReturns(window),
        realizedVolatility: null,
        bars: window,
      },
      optionChain: [],
      marketClock: researchClock(bar.timestamp),
    };
    const signal = agent.evaluateSignal(context);
    const outcomes: DecisionObservation['outcomes'] = {};
    for (const horizon of request.forwardHorizons) {
      const future = bars[index + horizon];
      if (!future || !signal.eligible || signal.direction === 'neutral') {
        outcomes[String(horizon)] = null;
        continue;
      }
      const rawReturn = future.close / bar.close - 1;
      const signedReturn = signal.direction === 'bullish' ? rawReturn : -rawReturn;
      outcomes[String(horizon)] = {
        rawReturn,
        signedReturn,
        correct: signedReturn > 0,
      };
    }

    observations.push({
      evaluationIndex: index,
      asOf: bar.timestamp,
      close: bar.close,
      eligible: signal.eligible,
      direction: signal.direction,
      blockingReason: signal.blockingReason,
      finalScore: signal.finalScore,
      regime: signal.regime,
      features: signal.features,
      dataQuality: signal.dataQuality,
      contributions: signal.contributions,
      explanation: signal.explanation,
      outcomes,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    request: { ...request, symbol },
    agentConfig: config,
    summary: summarizeBacktest(observations, request.forwardHorizons),
    observations,
  };
}
