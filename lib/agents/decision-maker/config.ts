export type DecisionAgentConfig = {
  version: string;
  timeframe: '1Day' | '1Hour' | '15Min';
  annualizationFactor: number;
  periods: {
    smaShort: number;
    smaLong: number;
    emaShort: number;
    rsi: number;
    atr: number;
    momentum: number;
    volatility: number;
    volume: number;
    breakout: number;
  };
  thresholds: {
    minimumBars: number;
    maximumBarAgeMinutes: number;
    tradeScore: number;
    conflictingSignalGap: number;
    highVolatilityAnnualized: number;
    highAtrPercent: number;
  };
  strategyWeights: {
    trendFollowing: number;
    meanReversion: number;
    breakout: number;
    sentiment: number;
  };
  contractSelection: {
    minimumDaysToExpiration: number;
    maximumDaysToExpiration: number;
    targetDaysToExpiration: number;
    maximumSpreadPercent: number;
    minimumVolume: number;
    minimumOpenInterest: number;
    minimumAbsoluteDelta: number;
    maximumAbsoluteDelta: number;
    targetAbsoluteDelta: number;
    maximumMoneynessPercent: number;
  };
  horizon: string;
};

export const defaultDecisionAgentConfig: DecisionAgentConfig = {
  version: 'decision-v1',
  timeframe: '1Day',
  annualizationFactor: 252,
  periods: {
    smaShort: 10,
    smaLong: 30,
    emaShort: 10,
    rsi: 14,
    atr: 14,
    momentum: 10,
    volatility: 20,
    volume: 20,
    breakout: 20,
  },
  thresholds: {
    minimumBars: 50,
    maximumBarAgeMinutes: 2_880,
    tradeScore: 0.3,
    conflictingSignalGap: 0.12,
    highVolatilityAnnualized: 0.65,
    highAtrPercent: 4,
  },
  strategyWeights: {
    trendFollowing: 0.55,
    meanReversion: 0.2,
    breakout: 0.25,
    sentiment: 0,
  },
  contractSelection: {
    minimumDaysToExpiration: 7,
    maximumDaysToExpiration: 45,
    targetDaysToExpiration: 21,
    maximumSpreadPercent: 15,
    minimumVolume: 1,
    minimumOpenInterest: 1,
    minimumAbsoluteDelta: 0.25,
    maximumAbsoluteDelta: 0.75,
    targetAbsoluteDelta: 0.5,
    maximumMoneynessPercent: 12,
  },
  horizon: '2–5 trading days',
};

export function decisionAgentConfigForTimeframe(
  timeframe: DecisionAgentConfig['timeframe'],
): DecisionAgentConfig {
  if (timeframe === '1Day') return defaultDecisionAgentConfig;
  const barsPerTradingDay = timeframe === '1Hour' ? 7 : 26;
  const maximumBarAgeMinutes = timeframe === '1Hour' ? 180 : 60;
  return {
    ...defaultDecisionAgentConfig,
    version: `${defaultDecisionAgentConfig.version}-${timeframe.toLowerCase()}`,
    timeframe,
    annualizationFactor: 252 * barsPerTradingDay,
    thresholds: {
      ...defaultDecisionAgentConfig.thresholds,
      maximumBarAgeMinutes,
    },
    horizon:
      timeframe === '1Hour' ? '3–5 hourly bars' : '3–5 fifteen-minute bars',
  };
}
