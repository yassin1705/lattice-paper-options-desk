import type {
  MarketBar,
  MarketClock,
  OptionContract,
  OptionMarketSnapshot,
} from '@/lib/alpaca/types';
import type { DecisionContext } from '@/lib/agents/types';

const OBSERVED_AT = '2026-08-29T21:00:00.000Z';

export function risingBars(count = 60): MarketBar[] {
  const start = new Date('2026-07-01T20:00:00.000Z').getTime();
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index;
    return {
      symbol: 'SPY',
      timestamp: new Date(start + index * 86_400_000).toISOString(),
      open: close - 0.5,
      high: close + 0.4,
      low: close - 0.8,
      close,
      volume: index === count - 1 ? 2_000_000 : 1_000_000,
      tradeCount: 10_000,
      volumeWeightedPrice: close,
    };
  });
}

export function fallingBars(count = 60): MarketBar[] {
  return risingBars(count).map((bar, index) => {
    const close = 219 - index;
    return {
      ...bar,
      open: close + 0.5,
      high: close + 0.8,
      low: close - 0.4,
      close,
      volumeWeightedPrice: close,
    };
  });
}

function optionContract(type: 'call' | 'put'): OptionContract {
  const optionCode = type === 'call' ? 'C' : 'P';
  return {
    id: `spy-${type}`,
    symbol: `SPY260918${optionCode}00160000`,
    name: `SPY Sep 18 2026 160 ${type}`,
    status: 'active',
    tradable: true,
    underlyingSymbol: 'SPY',
    rootSymbol: 'SPY',
    type,
    style: 'american',
    strikePrice: 160,
    expirationDate: '2026-09-18',
    multiplier: 100,
    openInterest: 500,
    openInterestDate: '2026-08-28',
    closePrice: 2,
    closePriceDate: '2026-08-28',
  };
}

function optionMarket(contract: OptionContract, spread = 0.1): OptionMarketSnapshot {
  return {
    observedAt: OBSERVED_AT,
    symbol: contract.symbol,
    feed: 'indicative',
    latestTradePrice: 2.05,
    latestTradeSize: 10,
    latestTradeAt: OBSERVED_AT,
    bidPrice: 2,
    bidSize: 25,
    askPrice: 2 + spread,
    askSize: 25,
    quoteAt: OBSERVED_AT,
    impliedVolatility: 0.24,
    delta: contract.type === 'call' ? 0.5 : -0.5,
    gamma: 0.04,
    theta: -0.03,
    vega: 0.08,
    rho: 0.01,
    volume: 100,
    openInterest: 500,
  };
}

const marketClock: MarketClock = {
  observedAt: OBSERVED_AT,
  timestamp: OBSERVED_AT,
  isOpen: false,
  nextOpen: '2026-08-31T13:30:00.000Z',
  nextClose: '2026-08-31T20:00:00.000Z',
};

export function decisionContext(options?: {
  bars?: MarketBar[];
  callSpread?: number;
}): DecisionContext {
  const bars = options?.bars ?? risingBars();
  const call = optionContract('call');
  const put = optionContract('put');
  return {
    contextId: 'decision:SPY:fixture',
    observedAt: OBSERVED_AT,
    source: 'alpaca',
    underlying: {
      symbol: 'SPY',
      latestPrice: bars.at(-1)?.close ?? null,
      recentReturns: [],
      realizedVolatility: null,
      bars,
    },
    optionChain: [
      { contract: call, market: optionMarket(call, options?.callSpread) },
      { contract: put, market: optionMarket(put) },
    ],
    marketClock,
  };
}
