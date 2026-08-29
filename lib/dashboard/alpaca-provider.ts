import 'server-only';

import { AlpacaHttpReadGateway } from '@/lib/alpaca/alpaca-http-read-gateway';
import type {
  AlpacaReadGateway,
  OrderSnapshot,
  PortfolioHistoryPoint,
  PositionSnapshot,
} from '@/lib/alpaca/types';
import type {
  CompletedOptionTrade,
  DashboardDataProvider,
  DashboardSnapshot,
  OpenOptionPosition,
  TradableAsset,
} from '@/lib/dashboard/types';

const ASSET_NAMES: Record<string, string> = {
  SPY: 'S&P 500',
  QQQ: 'Nasdaq 100',
  GLD: 'Gold',
  AAPL: 'Apple',
  MSFT: 'Microsoft',
  NVDA: 'NVIDIA',
};

function dateLabel(point: PortfolioHistoryPoint): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/New_York',
  }).format(new Date(point.timestamp));
}

function parseOptionSymbol(symbol: string) {
  const match = symbol.match(/^([A-Z]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!match) return null;

  const [, underlying, year, month, day, type, strike] = match;
  const expiration = `20${year}-${month}-${day}`;
  const expirationDate = new Date(`${expiration}T20:00:00Z`);
  const daysToExpiration = Math.max(
    0,
    Math.ceil((expirationDate.getTime() - Date.now()) / 86_400_000),
  );

  return {
    underlying,
    optionType: type === 'C' ? ('call' as const) : ('put' as const),
    strike: Number(strike) / 1000,
    expiration,
    daysToExpiration,
  };
}

function dashboardPosition(position: PositionSnapshot): OpenOptionPosition | null {
  const contract = parseOptionSymbol(position.symbol);
  if (!contract) return null;

  return {
    id: position.assetId || position.symbol,
    symbol: position.symbol,
    underlying: contract.underlying,
    underlyingName: ASSET_NAMES[contract.underlying] ?? contract.underlying,
    optionType: contract.optionType,
    strike: contract.strike,
    expiration: contract.expiration,
    daysToExpiration: contract.daysToExpiration,
    quantity: position.quantity,
    averageEntryPrice: position.averageEntryPrice,
    currentPrice: position.currentPrice,
    marketValue: position.marketValue,
    unrealizedProfitLoss: position.unrealizedProfitLoss,
    unrealizedProfitLossPercent: position.unrealizedProfitLossPercent,
    lastUpdated: position.observedAt,
  };
}

function dashboardTrade(order: OrderSnapshot): CompletedOptionTrade | null {
  const contract = parseOptionSymbol(order.symbol);
  if (!contract || order.status !== 'filled' || !order.filledAt) return null;

  const optionLabel = contract.optionType === 'call' ? 'Call' : 'Put';
  const expirationLabel = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(`${contract.expiration}T00:00:00Z`));

  return {
    id: order.id,
    closedAt: order.filledAt,
    underlying: contract.underlying,
    contract: `${optionLabel} · $${contract.strike.toLocaleString()} · ${expirationLabel}`,
    quantity: order.filledQuantity,
    entryPrice: null,
    exitPrice: order.filledAveragePrice,
    profitLoss: null,
    returnPercent: null,
    status: 'closed',
    report: 'Imported from Alpaca order history. P&L pairing will be added with the execution ledger.',
  };
}

export class AlpacaDashboardProvider implements DashboardDataProvider {
  private readonly alpaca: AlpacaReadGateway;

  static fromGateway(alpaca: AlpacaReadGateway): AlpacaDashboardProvider {
    return new AlpacaDashboardProvider(alpaca);
  }

  constructor(
    apiKeyOrGateway: string | AlpacaReadGateway,
    secretKey = '',
    tradingBaseUrl = 'https://paper-api.alpaca.markets',
  ) {
    this.alpaca =
      typeof apiKeyOrGateway === 'string'
        ? new AlpacaHttpReadGateway({
            apiKey: apiKeyOrGateway,
            secretKey,
            tradingBaseUrl,
          })
        : apiKeyOrGateway;
  }

  async getSnapshot(): Promise<DashboardSnapshot> {
    const [account, history, positions, orders] = await Promise.all([
      this.alpaca.getAccount(),
      this.alpaca.getPortfolioHistory('1M', '1D'),
      this.alpaca.getOpenPositions('us_option'),
      this.alpaca.getOrders({
        status: 'closed',
        assetClass: 'us_option',
        direction: 'desc',
        nested: true,
        limit: 100,
      }),
    ]);

    const openPositions = positions
      .map(dashboardPosition)
      .filter((position): position is OpenOptionPosition => position !== null);
    const completedTrades = orders
      .map(dashboardTrade)
      .filter((trade): trade is CompletedOptionTrade => trade !== null);
    const lastEquity = account.lastEquity || account.equity;
    const todayProfitLoss = account.equity - lastEquity;

    return {
      connection: {
        status: 'connected',
        label: 'Alpaca paper connected',
        detail: `Account ${account.accountNumber?.slice(-6) || 'verified'}`,
      },
      account: {
        accountNumber: account.accountNumber,
        equity: account.equity,
        buyingPower: account.buyingPower,
        todayProfitLoss,
        todayProfitLossPercent: lastEquity ? (todayProfitLoss / lastEquity) * 100 : 0,
        openRisk: openPositions.reduce(
          (total, position) =>
            total + Math.abs(position.averageEntryPrice * position.quantity * 100),
          0,
        ),
      },
      equityHistory: history.map((point) => ({
        date: dateLabel(point),
        equity: point.equity,
      })),
      openPositions,
      completedTrades,
      updatedAt: new Date().toISOString(),
      isMock: false,
    };
  }

  async searchAssets(query: string): Promise<TradableAsset[]> {
    const assets = await this.alpaca.searchOptionableAssets(query, 10);
    return assets.map((asset) => ({
      symbol: asset.symbol,
      name: asset.name,
      tradable: asset.tradable,
      optionsEnabled: asset.optionsEnabled,
    }));
  }
}
