import type { DecisionAgentMessage } from '@/lib/agents/contracts/decision-message';

export type NewsSourceId =
  | 'alpaca'
  | 'finnhub'
  | 'alpha_vantage'
  | 'google_news'
  | 'gdelt'
  | 'official_company';

export type NewsStockConfig = {
  symbol: string;
  companyName: string;
  aliases: string[];
  topics: string[];
  officialFeedUrls: string[];
  enabled: boolean;
};

export type NewsArticle = {
  articleId: string;
  sourceId: NewsSourceId;
  publisher: string;
  symbols: string[];
  title: string;
  summary: string;
  content: string | null;
  url: string | null;
  publishedAt: string;
  updatedAt: string | null;
};

export type NewsStory = {
  storyId: string;
  articleIds: string[];
  sourceIds: NewsSourceId[];
  publishers: string[];
  symbols: string[];
  title: string;
  summary: string;
  content: string | null;
  url: string | null;
  publishedAt: string;
};

export type NewsSourceRequest = {
  stocks: NewsStockConfig[];
  from: string;
  to: string;
  limitPerSymbol: number;
};

export interface NewsSourcePort {
  readonly sourceId: NewsSourceId;
  fetch(request: NewsSourceRequest): Promise<NewsArticle[]>;
}

export type NewsSourceReport = {
  sourceId: NewsSourceId;
  status: 'available' | 'failed';
  articlesReceived: number;
  error: string | null;
};

export type NewsAcquisitionResult = {
  collectedAt: string;
  articlesReceived: number;
  duplicatesRemoved: number;
  stories: NewsStory[];
  sourceReports: NewsSourceReport[];
};

export type NewsImpact = 'low' | 'medium' | 'high';
export type NewsHorizon = 'intraday' | 'one_day' | 'three_days' | 'long_term';

export type NewsModelDecision = {
  symbol: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  relevance: number;
  impact: NewsImpact;
  horizon: NewsHorizon;
  eventTypes: string[];
  summary: string;
  bullishEvidence: string[];
  bearishEvidence: string[];
  risks: string[];
  conflictingEvidence: boolean;
  supportingStoryIds: string[];
};

export type NewsModelRequest = {
  stock: NewsStockConfig;
  stories: NewsStory[];
  observedAt: string;
};

export interface NewsModelPort {
  readonly providerName: string;
  readonly modelName: string;
  readonly promptVersion: string;
  analyze(request: NewsModelRequest): Promise<NewsModelDecision>;
}

export type NewsStrategyRun = {
  runId: string;
  startedAt: string;
  validUntil: string;
  acquisition: NewsAcquisitionResult;
  decisions: DecisionAgentMessage[];
};
