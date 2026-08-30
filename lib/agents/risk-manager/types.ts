import type {
  AccountSnapshot,
  MarketClock,
  OptionContract,
  OptionMarketSnapshot,
  OrderSnapshot,
  PositionSnapshot,
} from '@/lib/alpaca/types';
import type { OpportunityMessage } from '@/lib/agents/contracts/decision-message';
import type { RiskPolicySnapshot } from '@/lib/agents/risk-manager/policy';

export type BaseRiskSnapshot = {
  observedAt: string;
  account: AccountSnapshot;
  positions: PositionSnapshot[];
  orders: OrderSnapshot[];
  marketClock: MarketClock;
  policySnapshot: RiskPolicySnapshot;
};

export type EntryRiskFeatures = {
  signal: OpportunityMessage;
  now: string;
  signalExpired: boolean;
  minutesToClose: number | null;
  dailyProfitLossPercent: number;
  openOptionPositions: PositionSnapshot[];
  sameUnderlyingPositions: PositionSnapshot[];
  pendingSameUnderlyingOrders: OrderSnapshot[];
  optionTradesToday: number;
  minutesSinceLastEntry: number | null;
  portfolioPremiumAtRisk: number;
};

export type OptionCandidate = {
  contract: OptionContract;
  market: OptionMarketSnapshot;
  daysToExpiration: number;
  absoluteDelta: number;
  midpoint: number;
  spreadPercent: number;
  volume: number;
  openInterest: number;
};
