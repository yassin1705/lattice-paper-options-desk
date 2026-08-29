import type {
  CompletedOptionTrade,
  DashboardDataProvider,
  DashboardSnapshot,
  OpenOptionPosition,
  TradableAsset,
} from '@/lib/dashboard/types';

type AlpacaRecord = Record<string, unknown>;

const ASSET_NAMES: Record<string, string> = {
  SPY: 'S&P 500',
  QQQ: 'Nasdaq 100',
  GLD: 'Gold',
  AAPL: 'Apple',
  MSFT: 'Microsoft',
  NVDA: 'NVIDIA',
};

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateLabel(timestamp: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/New_York',
  }).format(new Date(timestamp * 1000));
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

function optionPosition(position: AlpacaRecord): OpenOptionPosition | null {
  const symbol = String(position.symbol ?? '');
  const contract = parseOptionSymbol(symbol);
  if (!contract) return null;

  return {
    id: String(position.asset_id ?? symbol),
    symbol,
    underlying: contract.underlying,
    underlyingName: ASSET_NAMES[contract.underlying] ?? contract.underlying,
    optionType: contract.optionType,
    strike: contract.strike,
    expiration: contract.expiration,
    daysToExpiration: contract.daysToExpiration,
    quantity: Math.abs(numberValue(position.qty)),
    averageEntryPrice: numberValue(position.avg_entry_price),
    currentPrice: numberValue(position.current_price),
    marketValue: numberValue(position.market_value),
    unrealizedProfitLoss: numberValue(position.unrealized_pl),
    unrealizedProfitLossPercent: numberValue(position.unrealized_plpc) * 100,
    lastUpdated: 'Live',
  };
}

function completedTrade(order: AlpacaRecord): CompletedOptionTrade | null {
  const symbol = String(order.symbol ?? '');
  const contract = parseOptionSymbol(symbol);
  if (!contract || order.status !== 'filled' || !order.filled_at) return null;

  const optionLabel = contract.optionType === 'call' ? 'Call' : 'Put';
  const expirationLabel = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(`${contract.expiration}T00:00:00Z`));

  return {
    id: String(order.id ?? `${symbol}-${order.filled_at}`),
    closedAt: new Date(String(order.filled_at)).toISOString(),
    underlying: contract.underlying,
    contract: `${optionLabel} · $${contract.strike.toLocaleString()} · ${expirationLabel}`,
    quantity: numberValue(order.filled_qty),
    entryPrice: null,
    exitPrice: numberValue(order.filled_avg_price) || null,
    profitLoss: null,
    returnPercent: null,
    status: 'closed',
    report: 'Imported from Alpaca order history. P&L pairing will be added with the execution ledger.',
  };
}

export class AlpacaDashboardProvider implements DashboardDataProvider {
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, secretKey: string, baseUrl: string) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '').replace(/\/v2$/, '');
  }

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        'APCA-API-KEY-ID': this.apiKey,
        'APCA-API-SECRET-KEY': this.secretKey,
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Alpaca request failed with status ${response.status}`);
    }

    return (await response.json()) as T;
  }

  async getSnapshot(): Promise<DashboardSnapshot> {
    const [account, history, positions, orders] = await Promise.all([
      this.request<AlpacaRecord>('/v2/account'),
      this.request<AlpacaRecord>('/v2/account/portfolio/history?period=1M&timeframe=1D'),
      this.request<AlpacaRecord[]>('/v2/positions'),
      this.request<AlpacaRecord[]>('/v2/orders?status=closed&limit=100&direction=desc&nested=true'),
    ]);

    const openPositions = positions
      .filter((position) => position.asset_class === 'us_option')
      .map(optionPosition)
      .filter((position): position is OpenOptionPosition => position !== null);

    const completedTrades = orders
      .map(completedTrade)
      .filter((trade): trade is CompletedOptionTrade => trade !== null);

    const timestamps = Array.isArray(history.timestamp) ? history.timestamp : [];
    const equities = Array.isArray(history.equity) ? history.equity : [];
    const equityHistory = timestamps.map((timestamp, index) => ({
      date: dateLabel(numberValue(timestamp)),
      equity: numberValue(equities[index]),
    }));

    const equity = numberValue(account.equity);
    const lastEquity = numberValue(account.last_equity) || equity;
    const todayProfitLoss = equity - lastEquity;

    return {
      connection: {
        status: 'connected',
        label: 'Alpaca paper connected',
        detail: `Account ${String(account.account_number ?? '').slice(-6) || 'verified'}`,
      },
      account: {
        accountNumber: String(account.account_number ?? '') || null,
        equity,
        buyingPower: numberValue(account.buying_power),
        todayProfitLoss,
        todayProfitLossPercent: lastEquity ? (todayProfitLoss / lastEquity) * 100 : 0,
        openRisk: openPositions.reduce(
          (total, position) => total + Math.abs(position.averageEntryPrice * position.quantity * 100),
          0,
        ),
      },
      equityHistory,
      openPositions,
      completedTrades,
      updatedAt: new Date().toISOString(),
      isMock: false,
    };
  }

  async searchAssets(query: string): Promise<TradableAsset[]> {
    const assets = await this.request<AlpacaRecord[]>(
      '/v2/assets?status=active&asset_class=us_equity&attributes=options_enabled',
    );
    const normalized = query.trim().toUpperCase();

    return assets
      .filter((asset) => {
        const symbol = String(asset.symbol ?? '').toUpperCase();
        const name = String(asset.name ?? '').toUpperCase();
        return !normalized || symbol.includes(normalized) || name.includes(normalized);
      })
      .slice(0, 10)
      .map((asset) => ({
        symbol: String(asset.symbol ?? ''),
        name: String(asset.name ?? asset.symbol ?? ''),
        tradable: Boolean(asset.tradable),
        optionsEnabled: Array.isArray(asset.attributes)
          ? asset.attributes.includes('options_enabled')
          : true,
      }));
  }
}
