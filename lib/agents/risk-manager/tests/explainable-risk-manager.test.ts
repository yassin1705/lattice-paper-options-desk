import { describe, expect, it } from 'vitest';

import type {
  AccountSnapshot,
  AlpacaReadGateway,
  MarketClock,
  OptionContract,
  OptionMarketSnapshot,
  OrderSnapshot,
  PositionSnapshot,
} from '@/lib/alpaca/types';
import type { OpportunityMessage } from '@/lib/agents/contracts/decision-message';
import type { ScanDescriptor } from '@/lib/agents/contracts/scan';
import { decisionAgentConfigForTimeframe } from '@/lib/agents/decision-maker/config';
import { TechnicalDecisionAgentAdapter } from '@/lib/agents/decision-maker/technical-decision-agent-adapter';
import {
  decisionContext,
  risingBars,
} from '@/lib/agents/decision-maker/tests/fixtures';
import { ExplainableRiskManager } from '@/lib/agents/risk-manager/explainable-risk-manager';
import {
  defaultRiskPolicy,
  validateRiskPolicy,
} from '@/lib/agents/risk-manager/policy';
import type { RiskPolicyProvider } from '@/lib/agents/risk-manager/policy-provider';

const NOW = new Date('2026-08-29T21:10:00.000Z');
const scan: ScanDescriptor = {
  scanId: 'scan:1Hour:2026-08-29T21:02:00.000Z',
  scheduledAt: '2026-08-29T21:02:00.000Z',
  startedAt: '2026-08-29T21:02:30.000Z',
  validUntil: '2026-08-29T21:57:00.000Z',
  timeframe: '1Hour',
  lookbackBars: 100,
};

const account: AccountSnapshot = {
  observedAt: NOW.toISOString(),
  accountNumber: 'paper',
  status: 'ACTIVE',
  currency: 'USD',
  equity: 100_000,
  lastEquity: 100_000,
  cash: 50_000,
  buyingPower: 50_000,
  optionsBuyingPower: 50_000,
  optionsTradingLevel: 2,
  optionsApprovedLevel: 2,
  patternDayTrader: false,
  tradingBlocked: false,
  accountBlocked: false,
};

const marketClock: MarketClock = {
  observedAt: NOW.toISOString(),
  timestamp: NOW.toISOString(),
  isOpen: true,
  nextOpen: '2026-08-31T13:30:00.000Z',
  nextClose: '2026-08-29T23:00:00.000Z',
};

const contract: OptionContract = {
  id: 'spy-call',
  symbol: 'SPY260918C00160000',
  name: 'SPY call',
  status: 'active',
  tradable: true,
  underlyingSymbol: 'SPY',
  rootSymbol: 'SPY',
  type: 'call',
  style: 'american',
  strikePrice: 160,
  expirationDate: '2026-09-18',
  multiplier: 100,
  openInterest: 1_000,
  openInterestDate: '2026-08-28',
  closePrice: 2,
  closePriceDate: '2026-08-28',
};

const market: OptionMarketSnapshot = {
  observedAt: NOW.toISOString(),
  symbol: contract.symbol,
  feed: 'indicative',
  latestTradePrice: 2.05,
  latestTradeSize: 10,
  latestTradeAt: NOW.toISOString(),
  bidPrice: 2,
  bidSize: 20,
  askPrice: 2.1,
  askSize: 20,
  quoteAt: NOW.toISOString(),
  impliedVolatility: 0.25,
  delta: 0.5,
  gamma: 0.04,
  theta: -0.03,
  vega: 0.08,
  rho: 0.01,
  volume: 500,
  openInterest: 1_000,
};

function policyProvider(): RiskPolicyProvider {
  return {
    async getPolicy() {
      return {
        revision: 1,
        updatedAt: NOW.toISOString(),
        policy: structuredClone(defaultRiskPolicy),
      };
    },
    async updatePolicy() {
      throw new Error('Not used by this test.');
    },
  };
}

function gateway(options?: {
  clock?: MarketClock;
  positions?: PositionSnapshot[];
  orders?: OrderSnapshot[];
}): AlpacaReadGateway {
  return {
    async getAccount() {
      return account;
    },
    async getPortfolioHistory() {
      return [];
    },
    async getOpenPositions() {
      return options?.positions ?? [];
    },
    async getOrders() {
      return options?.orders ?? [];
    },
    async getActivities() {
      return [];
    },
    async getOptionContracts() {
      return [contract];
    },
    async getOptionContract() {
      return contract;
    },
    async getOptionChain() {
      return [market];
    },
    async getOptionSnapshots() {
      return [market];
    },
    async getOptionHistory() {
      return [];
    },
    async getUnderlyingHistory() {
      return [];
    },
    async getClock() {
      return options?.clock ?? marketClock;
    },
    async searchOptionableAssets() {
      return [];
    },
  };
}

async function opportunity(): Promise<OpportunityMessage> {
  const adapter = new TechnicalDecisionAgentAdapter(
    decisionAgentConfigForTimeframe('1Hour'),
  );
  const message = await adapter.evaluate({
    context: decisionContext({ bars: risingBars() }),
    scan,
  });
  if (message.kind !== 'opportunity')
    throw new Error('Fixture did not produce an opportunity.');
  return message;
}

describe('risk policy', () => {
  it('normalizes symbols and rejects an invalid expiration range', () => {
    const valid = validateRiskPolicy({
      ...structuredClone(defaultRiskPolicy),
      approvedUnderlyings: [' spy ', 'SPY', 'qqq'],
    });
    expect(valid.approvedUnderlyings).toEqual(['SPY', 'QQQ']);
    expect(() =>
      validateRiskPolicy({
        ...structuredClone(defaultRiskPolicy),
        contract: {
          ...defaultRiskPolicy.contract,
          minimumDaysToExpiration: 45,
          maximumDaysToExpiration: 7,
        },
      }),
    ).toThrow();
  });
});

describe('ExplainableRiskManager', () => {
  it('approves and sizes a liquid opportunity within the full-premium budget', async () => {
    const manager = new ExplainableRiskManager(
      gateway(),
      policyProvider(),
      () => NOW,
    );
    const result = await manager.assess(await opportunity(), scan);
    expect(result.kind).toBe('approved_trade_plan');
    if (result.kind !== 'approved_trade_plan') return;
    expect(result.plan.contractSymbol).toBe(contract.symbol);
    expect(result.plan.quantity).toBe(1);
    expect(result.plan.maximumLoss).toBe(210);
    expect(result.rules.every((rule) => rule.outcome !== 'fail')).toBe(true);
  });

  it('rejects an entry while the market is closed with an explicit rule result', async () => {
    const manager = new ExplainableRiskManager(
      gateway({ clock: { ...marketClock, isOpen: false } }),
      policyProvider(),
      () => NOW,
    );
    const result = await manager.assess(await opportunity(), scan);
    expect(result.kind).toBe('rejected_trade');
    if (result.kind !== 'rejected_trade') return;
    expect(result.rules).toContainEqual(
      expect.objectContaining({ ruleId: 'market_open', outcome: 'fail' }),
    );
  });

  it('rejects a fresh news signal that opposes the technical strategy', async () => {
    const manager = new ExplainableRiskManager(
      gateway(),
      policyProvider(),
      () => NOW,
    );
    const technical = await opportunity();
    await manager.assess(technical, scan);
    const news: OpportunityMessage = {
      ...technical,
      messageId: 'news:test:SPY',
      strategy: { id: 'news_llm', frequencyMinutes: 300 },
      direction: 'bearish',
      suggestedAction: 'buy_put',
      thesisType: 'sentiment',
      analysis: {
        kind: 'news',
        symbol: 'SPY',
        marketObservedAt: NOW.toISOString(),
        latestPrice: null,
        signalStrength: 0.9,
        dataQuality: {
          sufficient: true,
          stale: false,
          observationsReceived: 1,
          observationsRequired: 1,
          latestObservationAt: NOW.toISOString(),
          warnings: [],
        },
        relevance: 0.95,
        impact: 'high',
        horizon: 'intraday',
        eventTypes: ['regulation'],
        sourceIds: ['alpaca'],
        storyIds: ['story:test'],
        model: { provider: 'test', name: 'fixture', promptVersion: 'v1' },
      },
    };
    const result = await manager.assess(news, scan);

    expect(result.kind).toBe('rejected_trade');
    expect(result.strategyId).toBe('news_llm');
    expect(result.rules).toContainEqual(
      expect.objectContaining({ ruleId: 'strategy_conflict', outcome: 'fail' }),
    );
  });

  it('proposes exiting an open option after its stop-loss threshold', async () => {
    const position: PositionSnapshot = {
      observedAt: NOW.toISOString(),
      assetId: 'position-1',
      symbol: contract.symbol,
      assetClass: 'us_option',
      side: 'long',
      quantity: 1,
      availableQuantity: 1,
      averageEntryPrice: 2,
      currentPrice: 1.4,
      marketValue: 140,
      costBasis: 200,
      unrealizedProfitLoss: -60,
      unrealizedProfitLossPercent: -0.3,
      changeTodayPercent: -0.1,
    };
    const order: OrderSnapshot = {
      id: 'order-1',
      clientOrderId: null,
      createdAt: '2026-08-28T20:00:00.000Z',
      submittedAt: '2026-08-28T20:00:00.000Z',
      filledAt: '2026-08-28T20:01:00.000Z',
      canceledAt: null,
      symbol: contract.symbol,
      assetClass: 'us_option',
      side: 'buy',
      positionIntent: 'buy_to_open',
      type: 'limit',
      timeInForce: 'day',
      status: 'filled',
      quantity: 1,
      filledQuantity: 1,
      limitPrice: 2,
      stopPrice: null,
      filledAveragePrice: 2,
      orderClass: null,
      legs: [],
    };
    const manager = new ExplainableRiskManager(
      gateway({ positions: [position], orders: [order] }),
      policyProvider(),
      () => NOW,
    );
    const results = await manager.superviseOpenPositions(scan);
    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe('exit_position');
    expect(results[0]?.rules).toContainEqual(
      expect.objectContaining({
        ruleId: 'position_stop_loss',
        outcome: 'fail',
      }),
    );
  });
});
