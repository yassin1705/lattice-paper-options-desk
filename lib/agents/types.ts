import type {
  AccountSnapshot,
  MarketBar,
  MarketClock,
  OptionContract,
  OptionMarketSnapshot,
  OrderSnapshot,
  PositionSnapshot,
} from '@/lib/alpaca/types';

export type RiskPolicy = {
  profile: 'conservative' | 'moderate' | 'experimental';
  maxTradeLossPercent: number;
  dailyLossLimitPercent: number;
  holdingHorizon: 'intraday' | 'swing' | 'position';
  requireConfirmation: boolean;
};

export type DecisionContext = {
  contextId: string;
  observedAt: string;
  source: 'alpaca';
  underlying: {
    symbol: string;
    latestPrice: number | null;
    recentReturns: number[];
    realizedVolatility: number | null;
    bars: MarketBar[];
  };
  optionChain: Array<{
    contract: OptionContract | null;
    market: OptionMarketSnapshot;
  }>;
  marketClock: MarketClock;
};

export type RiskContext = {
  contextId: string;
  observedAt: string;
  source: 'alpaca';
  account: AccountSnapshot;
  positions: PositionSnapshot[];
  openOrders: OrderSnapshot[];
  contract: OptionContract | null;
  contractMarket: OptionMarketSnapshot | null;
  marketClock: MarketClock;
  policy: RiskPolicy;
};
