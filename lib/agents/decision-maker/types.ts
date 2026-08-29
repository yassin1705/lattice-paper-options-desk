import type { OptionContract, OptionMarketSnapshot } from '@/lib/alpaca/types';

export type MarketRegime =
  | 'trending_up'
  | 'trending_down'
  | 'range_bound'
  | 'high_volatility'
  | 'unknown';

export type ThesisType = 'trend_following' | 'mean_reversion' | 'breakout';
export type SignalDirection = 'bullish' | 'bearish' | 'neutral';

export type TechnicalFeatureSnapshot = {
  latestPrice: number;
  smaShort: number | null;
  smaLong: number | null;
  emaShort: number | null;
  rsi: number | null;
  atr: number | null;
  atrPercent: number | null;
  return1: number | null;
  return5: number | null;
  momentum: number | null;
  realizedVolatility: number | null;
  priceToSmaLongPercent: number | null;
  returnZScore: number | null;
  volumeRatio: number | null;
  distanceFromRecentHighPercent: number | null;
  distanceFromRecentLowPercent: number | null;
};

export type DataQuality = {
  sufficient: boolean;
  stale: boolean;
  barsReceived: number;
  barsRequired: number;
  latestBarAt: string | null;
  warnings: string[];
};

export type SignalContribution = {
  strategy: ThesisType | 'sentiment';
  direction: SignalDirection;
  score: number;
  weight: number;
  weightedScore: number;
  evidence: string[];
};

export type SentimentSignal = {
  status: 'available' | 'unavailable';
  observedAt: string | null;
  score: number | null;
  confidence: number | null;
  sources: string[];
  explanation: string | null;
};

export type SelectedContract = {
  contract: OptionContract;
  market: OptionMarketSnapshot;
  daysToExpiration: number;
  moneynessPercent: number;
  spreadPercent: number;
  selectionScore: number;
  selectionReasons: string[];
};

export type DecisionAnalysis = {
  configVersion: string;
  contextId: string;
  observedAt: string;
  underlying: string;
  regime: MarketRegime;
  features: TechnicalFeatureSnapshot;
  dataQuality: DataQuality;
  contributions: SignalContribution[];
  finalScore: number;
  sentiment: SentimentSignal;
};

export type TradeIntent = DecisionAnalysis & {
  kind: 'trade_intent';
  id: string;
  action: 'buy_call' | 'buy_put';
  contractSymbol: string;
  thesisType: ThesisType;
  horizon: string;
  signalStrength: number;
  thesis: string[];
  invalidationConditions: string[];
  selectedContract: SelectedContract;
};

export type NoTradeReason =
  | 'insufficient_data'
  | 'stale_data'
  | 'weak_signal'
  | 'conflicting_signals'
  | 'no_liquid_contract';

export type NoTradeIntent = DecisionAnalysis & {
  kind: 'no_trade';
  id: string;
  reason: NoTradeReason;
  explanation: string[];
};

export type DecisionResult = TradeIntent | NoTradeIntent;
