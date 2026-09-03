export type ConnectionStatus = 'mock' | 'connected' | 'error';

export type EquityPoint = {
  date: string;
  equity: number;
};

export type OpenOptionPosition = {
  id: string;
  symbol: string;
  underlying: string;
  underlyingName: string;
  optionType: 'call' | 'put';
  strike: number;
  expiration: string;
  daysToExpiration: number;
  quantity: number;
  averageEntryPrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedProfitLoss: number;
  unrealizedProfitLossPercent: number;
  lastUpdated: string;
};

export type OpenStockPosition = {
  id: string;
  symbol: string;
  name: string;
  side: 'long' | 'short';
  quantity: number;
  averageEntryPrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedProfitLoss: number;
  unrealizedProfitLossPercent: number;
  changeTodayPercent: number;
  lastUpdated: string;
};

export type CompletedOptionTrade = {
  id: string;
  closedAt: string;
  underlying: string;
  contract: string;
  quantity: number;
  entryPrice: number | null;
  exitPrice: number | null;
  profitLoss: number | null;
  returnPercent: number | null;
  status:
    | 'closed'
    | 'expired'
    | 'exercised'
    | 'assigned'
    | 'cancelled'
    | 'unknown';
  origin: 'technical' | 'news_llm' | 'combined' | 'manual' | 'unknown';
  report: string;
};

export type AccountSummary = {
  accountNumber: string | null;
  equity: number;
  buyingPower: number;
  todayProfitLoss: number;
  todayProfitLossPercent: number;
  openRisk: number;
};

export type DashboardSnapshot = {
  connection: {
    status: ConnectionStatus;
    label: string;
    detail: string;
  };
  account: AccountSummary;
  equityHistory: EquityPoint[];
  openStockPositions: OpenStockPosition[];
  openPositions: OpenOptionPosition[];
  completedTrades: CompletedOptionTrade[];
  updatedAt: string;
  isMock: boolean;
};

export type TradableAsset = {
  symbol: string;
  name: string;
  tradable: boolean;
  optionsEnabled: boolean;
};

export interface DashboardDataProvider {
  getSnapshot(): Promise<DashboardSnapshot>;
  searchAssets(query: string): Promise<TradableAsset[]>;
}
