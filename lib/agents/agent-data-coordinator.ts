import 'server-only';

import type {
  AlpacaReadGateway,
  MarketBar,
  OptionChainFilter,
  OptionContractFilter,
} from '@/lib/alpaca/types';
import type { DecisionContext, RiskContext } from '@/lib/agents/types';
import type { RiskPolicy } from '@/lib/agents/risk-manager/policy';

export type DecisionContextRequest = {
  underlyingSymbol: string;
  historyStart: string;
  historyEnd?: string;
  historyTimeframe?: string;
  historyFeed?: string;
  optionFilter?: OptionChainFilter;
  includeOptionChain?: boolean;
};

export type RiskContextRequest = {
  underlyingSymbol: string;
  contractSymbol: string;
  policy: RiskPolicy;
  marketDataFeed?: 'indicative' | 'opra';
};

function calculateReturns(bars: MarketBar[]): number[] {
  const sorted = [...bars].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  );
  return sorted.slice(1).map((bar, index) => {
    const previousClose = sorted[index]?.close ?? 0;
    return previousClose > 0 ? bar.close / previousClose - 1 : 0;
  });
}

function realizedVolatility(returns: number[]): number | null {
  if (returns.length < 2) return null;
  const mean =
    returns.reduce((total, value) => total + value, 0) / returns.length;
  const variance =
    returns.reduce((total, value) => total + (value - mean) ** 2, 0) /
    (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

function contextId(
  scope: 'decision' | 'risk',
  subject: string,
  observedAt: string,
): string {
  return `${scope}:${subject}:${observedAt}`;
}

export class AgentDataCoordinator {
  constructor(private readonly alpaca: AlpacaReadGateway) {}

  async buildDecisionContext(
    request: DecisionContextRequest,
  ): Promise<DecisionContext> {
    const symbol = request.underlyingSymbol.trim().toUpperCase();
    const optionFilter = request.optionFilter ?? {};
    const contractFilter: OptionContractFilter = {
      underlyingSymbols: [symbol],
      status: 'active',
      expirationDate: optionFilter.expirationDate,
      expirationDateGte: optionFilter.expirationDateGte,
      expirationDateLte: optionFilter.expirationDateLte,
      type: optionFilter.type,
      strikePriceGte: optionFilter.strikePriceGte,
      strikePriceLte: optionFilter.strikePriceLte,
      limit: optionFilter.limit,
    };

    const includeOptionChain = request.includeOptionChain ?? true;
    const [bars, chain, contracts, marketClock] = await Promise.all([
      this.alpaca.getUnderlyingHistory({
        symbols: [symbol],
        timeframe: request.historyTimeframe ?? '1Day',
        start: request.historyStart,
        end: request.historyEnd,
        feed: request.historyFeed,
      }),
      includeOptionChain
        ? this.alpaca.getOptionChain(symbol, optionFilter)
        : Promise.resolve([]),
      includeOptionChain
        ? this.alpaca.getOptionContracts(contractFilter)
        : Promise.resolve([]),
      this.alpaca.getClock(),
    ]);

    const symbolBars = bars.filter((bar) => bar.symbol === symbol);
    const recentReturns = calculateReturns(symbolBars);
    const contractBySymbol = new Map(
      contracts.map((contract) => [contract.symbol, contract]),
    );
    const observedAt = new Date().toISOString();

    return {
      contextId: contextId('decision', symbol, observedAt),
      observedAt,
      source: 'alpaca',
      underlying: {
        symbol,
        latestPrice: symbolBars.at(-1)?.close ?? null,
        recentReturns,
        realizedVolatility: realizedVolatility(recentReturns),
        bars: symbolBars,
      },
      optionChain: chain.map((market) => ({
        contract: contractBySymbol.get(market.symbol) ?? null,
        market,
      })),
      marketClock,
    };
  }

  async buildRiskContext(request: RiskContextRequest): Promise<RiskContext> {
    const underlyingSymbol = request.underlyingSymbol.trim().toUpperCase();
    const contractSymbol = request.contractSymbol.trim().toUpperCase();
    const [account, positions, openOrders, contract, snapshots, marketClock] =
      await Promise.all([
        this.alpaca.getAccount(),
        this.alpaca.getOpenPositions(),
        this.alpaca.getOrders({
          status: 'open',
          assetClass: 'us_option',
          limit: 500,
        }),
        this.alpaca.getOptionContract(contractSymbol),
        this.alpaca.getOptionSnapshots(
          [contractSymbol],
          request.marketDataFeed ?? 'indicative',
        ),
        this.alpaca.getClock(),
      ]);
    if (contract && contract.underlyingSymbol !== underlyingSymbol) {
      throw new Error(
        `Contract ${contractSymbol} does not belong to underlying ${underlyingSymbol}`,
      );
    }
    const observedAt = new Date().toISOString();

    return {
      contextId: contextId('risk', contractSymbol, observedAt),
      observedAt,
      source: 'alpaca',
      account,
      positions,
      openOrders,
      contract,
      contractMarket:
        snapshots.find((snapshot) => snapshot.symbol === contractSymbol) ??
        null,
      marketClock,
      policy: request.policy,
    };
  }
}
