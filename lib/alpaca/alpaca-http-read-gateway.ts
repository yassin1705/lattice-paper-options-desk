import 'server-only';

import type {
  AccountActivity,
  AccountSnapshot,
  ActivityFilter,
  AlpacaReadGateway,
  HistoryRequest,
  MarketBar,
  MarketClock,
  MarketDataFeed,
  OptionChainFilter,
  OptionContract,
  OptionContractFilter,
  OptionMarketSnapshot,
  OrderFilter,
  OrderSnapshot,
  OrderStatus,
  PortfolioHistoryPoint,
  PositionSnapshot,
  TradableUnderlying,
} from '@/lib/alpaca/types';

type AlpacaRecord = Record<string, unknown>;

export type AlpacaReadGatewayOptions = {
  apiKey: string;
  secretKey: string;
  tradingBaseUrl?: string;
  marketDataBaseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetcher?: typeof fetch;
};

export class AlpacaReadError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly path: string,
  ) {
    super(message);
    this.name = 'AlpacaReadError';
  }
}

function record(value: unknown): AlpacaRecord {
  return value && typeof value === 'object' ? (value as AlpacaRecord) : {};
}

function textValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableText(value: unknown): string | null {
  const parsed = textValue(value).trim();
  return parsed || null;
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 'true';
}

function isoTimestamp(value: unknown): string | null {
  const parsed = nullableText(value);
  if (!parsed) return null;
  const date = new Date(parsed);
  return Number.isNaN(date.getTime()) ? parsed : date.toISOString();
}

function unixTimestamp(value: unknown): string {
  return new Date(numberValue(value) * 1000).toISOString();
}

function queryString(values: Record<string, unknown>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      query.set(key, value.join(','));
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      query.set(key, String(value));
    }
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '').replace(/\/v2$/, '');
}

function mapOrder(value: unknown): OrderSnapshot {
  const order = record(value);
  const status = textValue(order.status, 'unknown') as OrderStatus;
  const side = textValue(order.side, 'unknown');

  return {
    id: textValue(order.id),
    clientOrderId: nullableText(order.client_order_id),
    createdAt: isoTimestamp(order.created_at),
    submittedAt: isoTimestamp(order.submitted_at),
    filledAt: isoTimestamp(order.filled_at),
    canceledAt: isoTimestamp(order.canceled_at),
    symbol: textValue(order.symbol),
    assetClass: textValue(order.asset_class),
    side: side === 'buy' || side === 'sell' ? side : 'unknown',
    positionIntent: nullableText(order.position_intent),
    type: textValue(order.type),
    timeInForce: textValue(order.time_in_force),
    status,
    quantity: numberValue(order.qty),
    filledQuantity: numberValue(order.filled_qty),
    limitPrice: nullableNumber(order.limit_price),
    stopPrice: nullableNumber(order.stop_price),
    filledAveragePrice: nullableNumber(order.filled_avg_price),
    orderClass: nullableText(order.order_class),
    legs: Array.isArray(order.legs) ? order.legs.map(mapOrder) : [],
  };
}

function mapActivity(value: unknown): AccountActivity {
  const activity = record(value);
  return {
    id: textValue(activity.id),
    activityType: textValue(activity.activity_type),
    transactionTime: isoTimestamp(activity.transaction_time),
    date: nullableText(activity.date),
    symbol: nullableText(activity.symbol),
    side: nullableText(activity.side),
    quantity: nullableNumber(activity.qty),
    price: nullableNumber(activity.price),
    netAmount: nullableNumber(activity.net_amount),
    orderId: nullableText(activity.order_id),
    status: nullableText(activity.status),
    description: nullableText(activity.description),
  };
}

function mapContract(value: unknown): OptionContract {
  const contract = record(value);
  const type = textValue(contract.type);
  const style = textValue(contract.style);
  const status = textValue(contract.status);
  return {
    id: textValue(contract.id),
    symbol: textValue(contract.symbol),
    name: textValue(contract.name, textValue(contract.symbol)),
    status: status === 'active' || status === 'inactive' ? status : 'unknown',
    tradable: booleanValue(contract.tradable),
    underlyingSymbol: textValue(contract.underlying_symbol),
    rootSymbol: textValue(contract.root_symbol),
    type: type === 'put' ? 'put' : 'call',
    style: style === 'american' || style === 'european' ? style : 'unknown',
    strikePrice: numberValue(contract.strike_price),
    expirationDate: textValue(contract.expiration_date),
    multiplier: numberValue(contract.size, 100),
    openInterest: nullableNumber(contract.open_interest),
    openInterestDate: nullableText(contract.open_interest_date),
    closePrice: nullableNumber(contract.close_price),
    closePriceDate: nullableText(contract.close_price_date),
  };
}

function mapOptionSnapshot(
  symbol: string,
  value: unknown,
  feed: MarketDataFeed,
  observedAt: string,
): OptionMarketSnapshot {
  const snapshot = record(value);
  const trade = record(snapshot.latestTrade ?? snapshot.latest_trade);
  const quote = record(snapshot.latestQuote ?? snapshot.latest_quote);
  const greeks = record(snapshot.greeks);
  const dailyBar = record(snapshot.dailyBar ?? snapshot.daily_bar);

  return {
    observedAt,
    symbol,
    feed,
    latestTradePrice: nullableNumber(trade.p ?? trade.price),
    latestTradeSize: nullableNumber(trade.s ?? trade.size),
    latestTradeAt: isoTimestamp(trade.t ?? trade.timestamp),
    bidPrice: nullableNumber(quote.bp ?? quote.bid_price),
    bidSize: nullableNumber(quote.bs ?? quote.bid_size),
    askPrice: nullableNumber(quote.ap ?? quote.ask_price),
    askSize: nullableNumber(quote.as ?? quote.ask_size),
    quoteAt: isoTimestamp(quote.t ?? quote.timestamp),
    impliedVolatility: nullableNumber(snapshot.impliedVolatility ?? snapshot.implied_volatility),
    delta: nullableNumber(greeks.delta),
    gamma: nullableNumber(greeks.gamma),
    theta: nullableNumber(greeks.theta),
    vega: nullableNumber(greeks.vega),
    rho: nullableNumber(greeks.rho),
    volume: nullableNumber(dailyBar.v ?? dailyBar.volume),
    openInterest: nullableNumber(snapshot.openInterest ?? snapshot.open_interest),
  };
}

function mapBars(payload: unknown): MarketBar[] {
  const barsBySymbol = record(record(payload).bars);
  return Object.entries(barsBySymbol).flatMap(([symbol, values]) =>
    Array.isArray(values)
      ? values.map((value) => {
          const bar = record(value);
          return {
            symbol,
            timestamp: isoTimestamp(bar.t ?? bar.timestamp) ?? '',
            open: numberValue(bar.o ?? bar.open),
            high: numberValue(bar.h ?? bar.high),
            low: numberValue(bar.l ?? bar.low),
            close: numberValue(bar.c ?? bar.close),
            volume: numberValue(bar.v ?? bar.volume),
            tradeCount: nullableNumber(bar.n ?? bar.trade_count),
            volumeWeightedPrice: nullableNumber(bar.vw ?? bar.vwap),
          };
        })
      : [],
  );
}

export class AlpacaHttpReadGateway implements AlpacaReadGateway {
  private readonly tradingBaseUrl: string;
  private readonly marketDataBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetcher: typeof fetch;
  private readonly headers: Record<string, string>;

  constructor(options: AlpacaReadGatewayOptions) {
    this.tradingBaseUrl = normalizeBaseUrl(
      options.tradingBaseUrl ?? 'https://paper-api.alpaca.markets',
    );
    this.marketDataBaseUrl = normalizeBaseUrl(
      options.marketDataBaseUrl ?? 'https://data.alpaca.markets',
    );
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.fetcher = options.fetcher ?? fetch;
    this.headers = {
      'APCA-API-KEY-ID': options.apiKey,
      'APCA-API-SECRET-KEY': options.secretKey,
    };
  }

  private async request<T>(baseUrl: string, path: string): Promise<T> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetcher(`${baseUrl}${path}`, {
          method: 'GET',
          headers: this.headers,
          cache: 'no-store',
          signal: controller.signal,
        });

        if (response.ok) return (await response.json()) as T;

        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt === this.maxRetries) {
          throw new AlpacaReadError(
            `Alpaca read failed with status ${response.status}`,
            response.status,
            path,
          );
        }
      } catch (error) {
        if (error instanceof AlpacaReadError) throw error;
        if (attempt === this.maxRetries) {
          throw new AlpacaReadError(
            error instanceof Error ? error.message : 'Alpaca read failed',
            null,
            path,
          );
        }
      } finally {
        clearTimeout(timeout);
      }

      await new Promise((resolve) => setTimeout(resolve, 150 * 2 ** attempt));
    }

    throw new AlpacaReadError('Alpaca read failed', null, path);
  }

  private trading<T>(path: string): Promise<T> {
    return this.request<T>(this.tradingBaseUrl, path);
  }

  private marketData<T>(path: string): Promise<T> {
    return this.request<T>(this.marketDataBaseUrl, path);
  }

  async getAccount(): Promise<AccountSnapshot> {
    const account = await this.trading<AlpacaRecord>('/v2/account');
    return {
      observedAt: new Date().toISOString(),
      accountNumber: nullableText(account.account_number),
      status: textValue(account.status),
      currency: textValue(account.currency, 'USD'),
      equity: numberValue(account.equity),
      lastEquity: numberValue(account.last_equity),
      cash: numberValue(account.cash),
      buyingPower: numberValue(account.buying_power),
      optionsBuyingPower: numberValue(account.options_buying_power ?? account.buying_power),
      optionsTradingLevel: nullableNumber(account.options_trading_level),
      optionsApprovedLevel: nullableNumber(account.options_approved_level),
      patternDayTrader: booleanValue(account.pattern_day_trader),
      tradingBlocked: booleanValue(account.trading_blocked),
      accountBlocked: booleanValue(account.account_blocked),
    };
  }

  async getPortfolioHistory(period = '1M', timeframe = '1D'): Promise<PortfolioHistoryPoint[]> {
    const history = await this.trading<AlpacaRecord>(
      `/v2/account/portfolio/history${queryString({ period, timeframe })}`,
    );
    const timestamps = Array.isArray(history.timestamp) ? history.timestamp : [];
    const equities = Array.isArray(history.equity) ? history.equity : [];
    const profits = Array.isArray(history.profit_loss) ? history.profit_loss : [];
    const profitPercents = Array.isArray(history.profit_loss_pct) ? history.profit_loss_pct : [];

    return timestamps.map((timestamp, index) => ({
      timestamp: unixTimestamp(timestamp),
      equity: numberValue(equities[index]),
      profitLoss: nullableNumber(profits[index]),
      profitLossPercent: nullableNumber(profitPercents[index]),
    }));
  }

  async getOpenPositions(assetClass?: string): Promise<PositionSnapshot[]> {
    const observedAt = new Date().toISOString();
    const positions = await this.trading<AlpacaRecord[]>('/v2/positions');
    return positions
      .filter((position) => !assetClass || position.asset_class === assetClass)
      .map((position) => ({
        observedAt,
        assetId: textValue(position.asset_id),
        symbol: textValue(position.symbol),
        assetClass: textValue(position.asset_class),
        side: textValue(position.side) === 'short' ? 'short' : 'long',
        quantity: Math.abs(numberValue(position.qty)),
        availableQuantity: Math.abs(numberValue(position.qty_available ?? position.qty)),
        averageEntryPrice: numberValue(position.avg_entry_price),
        currentPrice: numberValue(position.current_price),
        marketValue: numberValue(position.market_value),
        costBasis: numberValue(position.cost_basis),
        unrealizedProfitLoss: numberValue(position.unrealized_pl),
        unrealizedProfitLossPercent: numberValue(position.unrealized_plpc) * 100,
        changeTodayPercent: numberValue(position.change_today) * 100,
      }));
  }

  async getOrders(filter: OrderFilter = {}): Promise<OrderSnapshot[]> {
    const requestedLimit = Math.max(1, filter.limit ?? 500);
    const orders: OrderSnapshot[] = [];
    let beforeOrderId: string | undefined;

    while (orders.length < requestedLimit) {
      const pageLimit = Math.min(500, requestedLimit - orders.length);
      const page = await this.trading<unknown[]>(
        `/v2/orders${queryString({
          status: filter.status ?? 'all',
          after: filter.after,
          until: filter.until,
          symbols: filter.symbols,
          asset_class: filter.assetClass,
          direction: filter.direction ?? 'desc',
          nested: filter.nested ?? true,
          limit: pageLimit,
          before_order_id: beforeOrderId,
        })}`,
      );
      const mapped = page.map(mapOrder);
      orders.push(...mapped);
      if (page.length < pageLimit || mapped.length === 0) break;
      beforeOrderId = mapped.at(-1)?.id;
      if (!beforeOrderId) break;
    }

    return orders.slice(0, requestedLimit);
  }

  async getActivities(filter: ActivityFilter = {}): Promise<AccountActivity[]> {
    const requestedLimit = Math.max(1, filter.limit ?? 500);
    const activities: AccountActivity[] = [];
    let pageToken: string | undefined;

    while (activities.length < requestedLimit) {
      const pageSize = Math.min(100, requestedLimit - activities.length);
      const page = await this.trading<unknown[]>(
        `/v2/account/activities${queryString({
          activity_types: filter.activityTypes,
          after: filter.after,
          until: filter.until,
          direction: filter.direction ?? 'desc',
          page_size: pageSize,
          page_token: pageToken,
        })}`,
      );
      const mapped = page.map(mapActivity);
      activities.push(...mapped);
      if (page.length < pageSize || mapped.length === 0) break;
      pageToken = mapped.at(-1)?.id;
      if (!pageToken) break;
    }

    return activities.slice(0, requestedLimit);
  }

  async getOptionContracts(filter: OptionContractFilter): Promise<OptionContract[]> {
    const requestedLimit = Math.max(1, filter.limit ?? 1_000);
    const contracts: OptionContract[] = [];
    let pageToken: string | undefined;

    while (contracts.length < requestedLimit) {
      const pageLimit = Math.min(10_000, requestedLimit - contracts.length);
      const payload = await this.trading<AlpacaRecord>(
        `/v2/options/contracts${queryString({
          underlying_symbols: filter.underlyingSymbols,
          status: filter.status ?? 'active',
          expiration_date: filter.expirationDate,
          expiration_date_gte: filter.expirationDateGte,
          expiration_date_lte: filter.expirationDateLte,
          type: filter.type,
          strike_price_gte: filter.strikePriceGte,
          strike_price_lte: filter.strikePriceLte,
          limit: pageLimit,
          page_token: pageToken,
        })}`,
      );
      const values = Array.isArray(payload.option_contracts) ? payload.option_contracts : [];
      contracts.push(...values.map(mapContract));
      pageToken = nullableText(payload.next_page_token ?? payload.page_token) ?? undefined;
      if (!pageToken || values.length === 0) break;
    }

    return contracts.slice(0, requestedLimit);
  }

  async getOptionContract(symbolOrId: string): Promise<OptionContract | null> {
    try {
      const contract = await this.trading<unknown>(
        `/v2/options/contracts/${encodeURIComponent(symbolOrId)}`,
      );
      return mapContract(contract);
    } catch (error) {
      if (error instanceof AlpacaReadError && error.status === 404) return null;
      throw error;
    }
  }

  async getOptionChain(
    underlyingSymbol: string,
    filter: OptionChainFilter = {},
  ): Promise<OptionMarketSnapshot[]> {
    const requestedLimit = Math.max(1, filter.limit ?? 1_000);
    const feed = filter.feed ?? 'indicative';
    const snapshots: OptionMarketSnapshot[] = [];
    let pageToken: string | undefined;

    while (snapshots.length < requestedLimit) {
      const observedAt = new Date().toISOString();
      const payload = await this.marketData<AlpacaRecord>(
        `/v1beta1/options/snapshots/${encodeURIComponent(underlyingSymbol)}${queryString({
          feed,
          type: filter.type,
          expiration_date: filter.expirationDate,
          expiration_date_gte: filter.expirationDateGte,
          expiration_date_lte: filter.expirationDateLte,
          strike_price_gte: filter.strikePriceGte,
          strike_price_lte: filter.strikePriceLte,
          limit: Math.min(1_000, requestedLimit - snapshots.length),
          page_token: pageToken,
        })}`,
      );
      const values = record(payload.snapshots);
      snapshots.push(
        ...Object.entries(values).map(([symbol, value]) =>
          mapOptionSnapshot(symbol, value, feed, observedAt),
        ),
      );
      pageToken = nullableText(payload.next_page_token) ?? undefined;
      if (!pageToken || Object.keys(values).length === 0) break;
    }

    return snapshots.slice(0, requestedLimit);
  }

  async getOptionSnapshots(
    symbols: string[],
    feed: Exclude<MarketDataFeed, 'unknown'> = 'indicative',
  ): Promise<OptionMarketSnapshot[]> {
    if (symbols.length === 0) return [];
    const snapshots: OptionMarketSnapshot[] = [];
    for (let index = 0; index < symbols.length; index += 100) {
      const batch = symbols.slice(index, index + 100);
      const observedAt = new Date().toISOString();
      const payload = await this.marketData<AlpacaRecord>(
        `/v1beta1/options/snapshots${queryString({ symbols: batch, feed, limit: batch.length })}`,
      );
      snapshots.push(
        ...Object.entries(record(payload.snapshots)).map(([symbol, value]) =>
          mapOptionSnapshot(symbol, value, feed, observedAt),
        ),
      );
    }
    return snapshots;
  }

  async getOptionHistory(request: HistoryRequest): Promise<MarketBar[]> {
    return this.getPaginatedBars('/v1beta1/options/bars', request, 'indicative');
  }

  async getUnderlyingHistory(request: HistoryRequest): Promise<MarketBar[]> {
    return this.getPaginatedBars('/v2/stocks/bars', request);
  }

  private async getPaginatedBars(
    path: string,
    request: HistoryRequest,
    defaultFeed?: string,
  ): Promise<MarketBar[]> {
    const requestedLimit = Math.max(1, request.limit ?? 10_000);
    const bars: MarketBar[] = [];
    let pageToken: string | undefined;

    while (bars.length < requestedLimit) {
      const payload = await this.marketData<AlpacaRecord>(
        `${path}${queryString({
          symbols: request.symbols,
          timeframe: request.timeframe,
          start: request.start,
          end: request.end,
          feed: request.feed ?? defaultFeed,
          limit: Math.min(10_000, requestedLimit - bars.length),
          page_token: pageToken,
        })}`,
      );
      const page = mapBars(payload);
      bars.push(...page);
      pageToken = nullableText(payload.next_page_token) ?? undefined;
      if (!pageToken || page.length === 0) break;
    }

    return bars.slice(0, requestedLimit);
  }

  async getClock(): Promise<MarketClock> {
    const clock = await this.trading<AlpacaRecord>('/v2/clock');
    return {
      observedAt: new Date().toISOString(),
      timestamp: isoTimestamp(clock.timestamp) ?? '',
      isOpen: booleanValue(clock.is_open),
      nextOpen: isoTimestamp(clock.next_open) ?? '',
      nextClose: isoTimestamp(clock.next_close) ?? '',
    };
  }

  async searchOptionableAssets(query: string, limit = 10): Promise<TradableUnderlying[]> {
    const assets = await this.trading<AlpacaRecord[]>(
      '/v2/assets?status=active&asset_class=us_equity&attributes=options_enabled',
    );
    const normalized = query.trim().toUpperCase();
    return assets
      .filter((asset) => {
        const symbol = textValue(asset.symbol).toUpperCase();
        const name = textValue(asset.name).toUpperCase();
        return !normalized || symbol.includes(normalized) || name.includes(normalized);
      })
      .slice(0, limit)
      .map((asset) => ({
        id: textValue(asset.id),
        symbol: textValue(asset.symbol),
        name: textValue(asset.name, textValue(asset.symbol)),
        tradable: booleanValue(asset.tradable),
        optionsEnabled: Array.isArray(asset.attributes)
          ? asset.attributes.includes('options_enabled')
          : true,
      }));
  }
}
