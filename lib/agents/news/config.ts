import type { NewsStockConfig } from '@/lib/agents/news/types';

export const defaultNewsStocks: NewsStockConfig[] = [
  {
    symbol: 'NVDA',
    companyName: 'NVIDIA',
    aliases: ['NVIDIA', 'Nvidia Corporation', 'Jensen Huang'],
    topics: ['semiconductors', 'artificial intelligence', 'data centers'],
    officialFeedUrls: ['https://nvidianews.nvidia.com/releases.xml'],
    enabled: true,
  },
  {
    symbol: 'AAPL',
    companyName: 'Apple',
    aliases: ['Apple Inc.', 'Tim Cook'],
    topics: ['consumer technology', 'devices', 'services'],
    officialFeedUrls: [],
    enabled: true,
  },
  {
    symbol: 'MSFT',
    companyName: 'Microsoft',
    aliases: ['Microsoft Corporation', 'Satya Nadella'],
    topics: ['cloud computing', 'artificial intelligence', 'software'],
    officialFeedUrls: [],
    enabled: true,
  },
  {
    symbol: 'AMZN',
    companyName: 'Amazon',
    aliases: ['Amazon.com', 'AWS', 'Andy Jassy'],
    topics: ['cloud computing', 'ecommerce', 'artificial intelligence'],
    officialFeedUrls: [],
    enabled: true,
  },
  {
    symbol: 'META',
    companyName: 'Meta Platforms',
    aliases: ['Meta', 'Facebook', 'Mark Zuckerberg'],
    topics: ['social media', 'digital advertising', 'artificial intelligence'],
    officialFeedUrls: [],
    enabled: true,
  },
];

export type NewsStrategyConfig = {
  frequencyMinutes: number;
  lookbackHours: number;
  signalTtlMinutes: number;
  limitPerSymbol: number;
  minimumConfidence: number;
  minimumRelevance: number;
  minimumImpact: 'medium' | 'high';
};

export const defaultNewsStrategyConfig: NewsStrategyConfig = {
  frequencyMinutes: 300,
  lookbackHours: 24,
  signalTtlMinutes: 300,
  limitPerSymbol: 10,
  minimumConfidence: 0.65,
  minimumRelevance: 0.6,
  minimumImpact: 'medium',
};
