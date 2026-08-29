export type OptionType = 'call' | 'put';
export type MarketDataFeed = 'indicative' | 'opra' | 'unknown';
export type OrderStatus =
  | 'new'
  | 'accepted'
  | 'pending_new'
  | 'partially_filled'
  | 'filled'
  | 'done_for_day'
  | 'canceled'
  | 'expired'
  | 'replaced'
  | 'pending_cancel'
  | 'pending_replace'
  | 'rejected'
  | 'stopped'
  | 'suspended'
  | 'calculated'
  | 'unknown';

export type AccountSnapshot = {
  observedAt: string;
  accountNumber: string | null;
  status: string;
  currency: string;
  equity: number;
  lastEquity: number;
  cash: number;
  buyingPower: number;
  optionsBuyingPower: number;
  optionsTradingLevel: number | null;
  optionsApprovedLevel: number | null;
  patternDayTrader: boolean;
  tradingBlocked: boolean;
  accountBlocked: boolean;
};

export type PortfolioHistoryPoint = {
  timestamp: string;
  equity: number;
  profitLoss: number | null;
  profitLossPercent: number | null;
};

export type PositionSnapshot = {
  observedAt: string;
  assetId: string;
  symbol: string;
  assetClass: string;
  side: 'long' | 'short';
  quantity: number;
  availableQuantity: number;
  averageEntryPrice: number;
  currentPrice: number;
  marketValue: number;
  costBasis: number;
  unrealizedProfitLoss: number;
  unrealizedProfitLossPercent: number;
  changeTodayPercent: number;
};

export type OrderSnapshot = {
  id: string;
  clientOrderId: string | null;
  createdAt: string | null;
  submittedAt: string | null;
  filledAt: string | null;
  canceledAt: string | null;
  symbol: string;
  assetClass: string;
  side: 'buy' | 'sell' | 'unknown';
  positionIntent: string | null;
  type: string;
  timeInForce: string;
  status: OrderStatus;
  quantity: number;
  filledQuantity: number;
  limitPrice: number | null;
  stopPrice: number | null;
  filledAveragePrice: number | null;
  orderClass: string | null;
  legs: OrderSnapshot[];
};

export type AccountActivity = {
  id: string;
  activityType: string;
  transactionTime: string | null;
  date: string | null;
  symbol: string | null;
  side: string | null;
  quantity: number | null;
  price: number | null;
  netAmount: number | null;
  orderId: string | null;
  status: string | null;
  description: string | null;
};

export type OptionContract = {
  id: string;
  symbol: string;
  name: string;
  status: 'active' | 'inactive' | 'unknown';
  tradable: boolean;
  underlyingSymbol: string;
  rootSymbol: string;
  type: OptionType;
  style: 'american' | 'european' | 'unknown';
  strikePrice: number;
  expirationDate: string;
  multiplier: number;
  openInterest: number | null;
  openInterestDate: string | null;
  closePrice: number | null;
  closePriceDate: string | null;
};

export type OptionMarketSnapshot = {
  observedAt: string;
  symbol: string;
  feed: MarketDataFeed;
  latestTradePrice: number | null;
  latestTradeSize: number | null;
  latestTradeAt: string | null;
  bidPrice: number | null;
  bidSize: number | null;
  askPrice: number | null;
  askSize: number | null;
  quoteAt: string | null;
  impliedVolatility: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
  volume: number | null;
  openInterest: number | null;
};

export type MarketBar = {
  symbol: string;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradeCount: number | null;
  volumeWeightedPrice: number | null;
};

export type MarketClock = {
  observedAt: string;
  timestamp: string;
  isOpen: boolean;
  nextOpen: string;
  nextClose: string;
};

export type TradableUnderlying = {
  id: string;
  symbol: string;
  name: string;
  tradable: boolean;
  optionsEnabled: boolean;
};

export type OrderFilter = {
  status?: 'open' | 'closed' | 'all';
  after?: string;
  until?: string;
  symbols?: string[];
  assetClass?: 'us_option' | 'us_equity' | 'crypto' | 'all';
  direction?: 'asc' | 'desc';
  nested?: boolean;
  limit?: number;
};

export type ActivityFilter = {
  activityTypes?: string[];
  after?: string;
  until?: string;
  direction?: 'asc' | 'desc';
  limit?: number;
};

export type OptionContractFilter = {
  underlyingSymbols: string[];
  status?: 'active' | 'inactive';
  expirationDate?: string;
  expirationDateGte?: string;
  expirationDateLte?: string;
  type?: OptionType;
  strikePriceGte?: number;
  strikePriceLte?: number;
  limit?: number;
};

export type OptionChainFilter = {
  feed?: Exclude<MarketDataFeed, 'unknown'>;
  type?: OptionType;
  expirationDate?: string;
  expirationDateGte?: string;
  expirationDateLte?: string;
  strikePriceGte?: number;
  strikePriceLte?: number;
  limit?: number;
};

export type HistoryRequest = {
  symbols: string[];
  timeframe: string;
  start: string;
  end?: string;
  feed?: string;
  limit?: number;
};

export interface AlpacaReadGateway {
  getAccount(): Promise<AccountSnapshot>;
  getPortfolioHistory(period?: string, timeframe?: string): Promise<PortfolioHistoryPoint[]>;
  getOpenPositions(assetClass?: string): Promise<PositionSnapshot[]>;
  getOrders(filter?: OrderFilter): Promise<OrderSnapshot[]>;
  getActivities(filter?: ActivityFilter): Promise<AccountActivity[]>;
  getOptionContracts(filter: OptionContractFilter): Promise<OptionContract[]>;
  getOptionContract(symbolOrId: string): Promise<OptionContract | null>;
  getOptionChain(
    underlyingSymbol: string,
    filter?: OptionChainFilter,
  ): Promise<OptionMarketSnapshot[]>;
  getOptionSnapshots(
    symbols: string[],
    feed?: Exclude<MarketDataFeed, 'unknown'>,
  ): Promise<OptionMarketSnapshot[]>;
  getOptionHistory(request: HistoryRequest): Promise<MarketBar[]>;
  getUnderlyingHistory(request: HistoryRequest): Promise<MarketBar[]>;
  getClock(): Promise<MarketClock>;
  searchOptionableAssets(query: string, limit?: number): Promise<TradableUnderlying[]>;
}
