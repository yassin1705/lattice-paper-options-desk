import {
  defaultNewsStocks,
  defaultNewsStrategyConfig,
} from '@/lib/agents/news/config';
import type { NewsStockConfig } from '@/lib/agents/news/types';

export type NewsStrategySettings = {
  enabled: boolean;
  symbols: string[];
  frequencyMinutes: number;
  lookbackHours: number;
  modelName: string;
};

export type NewsStrategySettingsSnapshot = {
  revision: number;
  updatedAt: string;
  settings: NewsStrategySettings;
};

export type OllamaConnectionStatus = {
  status: 'connected' | 'model_missing' | 'unavailable';
  modelName: string;
  detail: string;
};

export type NewsSourceStatus = {
  sourceId:
    | 'alpaca'
    | 'google_news'
    | 'official_company'
    | 'finnhub'
    | 'alpha_vantage'
    | 'gdelt';
  label: string;
  configured: boolean;
  detail: string;
};

export type NewsStrategySettingsView = NewsStrategySettingsSnapshot & {
  ollama: OllamaConnectionStatus;
  sources: NewsSourceStatus[];
};

export const defaultNewsStrategySettings: NewsStrategySettings = {
  enabled: false,
  symbols: defaultNewsStocks.map((stock) => stock.symbol),
  frequencyMinutes: defaultNewsStrategyConfig.frequencyMinutes,
  lookbackHours: defaultNewsStrategyConfig.lookbackHours,
  modelName: 'qwen3:8b',
};

function environmentInitialSettings(): NewsStrategySettings {
  const symbols = process.env.NEWS_SYMBOLS
    ? process.env.NEWS_SYMBOLS.split(',')
    : defaultNewsStrategySettings.symbols;
  return validateNewsStrategySettings({
    enabled:
      process.env.NEWS_STRATEGY_ENABLED === undefined
        ? defaultNewsStrategySettings.enabled
        : process.env.NEWS_STRATEGY_ENABLED === 'true',
    symbols,
    frequencyMinutes: Number(
      process.env.NEWS_STRATEGY_FREQUENCY_MINUTES ??
        defaultNewsStrategySettings.frequencyMinutes,
    ),
    lookbackHours: Number(
      process.env.NEWS_LOOKBACK_HOURS ??
        defaultNewsStrategySettings.lookbackHours,
    ),
    modelName:
      process.env.OLLAMA_MODEL_NAME ?? defaultNewsStrategySettings.modelName,
  });
}

function normalizeSymbols(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error('News symbols must be an array.');
  }
  const symbols = [
    ...new Set(
      value.map((item) => String(item).trim().toUpperCase()).filter(Boolean),
    ),
  ];
  if (symbols.length === 0 || symbols.length > 20) {
    throw new Error('Choose between 1 and 20 news symbols.');
  }
  if (symbols.some((symbol) => !/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol))) {
    throw new Error('One or more news symbols are invalid.');
  }
  return symbols;
}

export function validateNewsStrategySettings(
  value: unknown,
): NewsStrategySettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('News strategy settings are invalid.');
  }
  const settings = value as Record<string, unknown>;
  const frequencyMinutes = Number(settings.frequencyMinutes);
  const lookbackHours = Number(settings.lookbackHours);
  const modelName =
    typeof settings.modelName === 'string' ? settings.modelName.trim() : '';
  if (typeof settings.enabled !== 'boolean') {
    throw new Error('News strategy enabled state must be true or false.');
  }
  if (!Number.isInteger(frequencyMinutes) || frequencyMinutes < 60) {
    throw new Error('News frequency must be at least 60 minutes.');
  }
  if (!Number.isInteger(lookbackHours) || lookbackHours < 1) {
    throw new Error('News lookback must be at least one hour.');
  }
  if (!modelName || modelName.length > 100) {
    throw new Error('A valid local model name is required.');
  }
  return {
    enabled: settings.enabled,
    symbols: normalizeSymbols(settings.symbols),
    frequencyMinutes,
    lookbackHours,
    modelName,
  };
}

export interface NewsStrategySettingsProvider {
  getSettings(): Promise<NewsStrategySettingsSnapshot>;
  updateSettings(value: unknown): Promise<NewsStrategySettingsSnapshot>;
}

export class InMemoryNewsStrategySettingsProvider implements NewsStrategySettingsProvider {
  private revision = 1;
  private updatedAt = new Date().toISOString();
  private settings: NewsStrategySettings;

  constructor(initial: NewsStrategySettings = defaultNewsStrategySettings) {
    this.settings = validateNewsStrategySettings(initial);
  }

  async getSettings(): Promise<NewsStrategySettingsSnapshot> {
    return this.snapshot();
  }

  async updateSettings(value: unknown): Promise<NewsStrategySettingsSnapshot> {
    this.settings = validateNewsStrategySettings(value);
    this.revision += 1;
    this.updatedAt = new Date().toISOString();
    return this.snapshot();
  }

  private snapshot(): NewsStrategySettingsSnapshot {
    return {
      revision: this.revision,
      updatedAt: this.updatedAt,
      settings: structuredClone(this.settings),
    };
  }
}

export class HttpNewsStrategySettingsProvider implements NewsStrategySettingsProvider {
  constructor(
    private readonly baseUrl = 'http://localhost:3000',
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async getSettings(): Promise<NewsStrategySettingsSnapshot> {
    const response = await this.fetcher(`${this.baseUrl}/api/news-strategy`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`News-settings service returned ${response.status}.`);
    }
    const snapshot = (await response.json()) as NewsStrategySettingsSnapshot;
    return {
      revision: snapshot.revision,
      updatedAt: snapshot.updatedAt,
      settings: validateNewsStrategySettings(snapshot.settings),
    };
  }

  async updateSettings(value: unknown): Promise<NewsStrategySettingsSnapshot> {
    const response = await this.fetcher(`${this.baseUrl}/api/news-strategy`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
    if (!response.ok) {
      throw new Error(`News-settings service returned ${response.status}.`);
    }
    const snapshot = (await response.json()) as NewsStrategySettingsSnapshot;
    return {
      revision: snapshot.revision,
      updatedAt: snapshot.updatedAt,
      settings: validateNewsStrategySettings(snapshot.settings),
    };
  }
}

export function newsStocksForSymbols(symbols: string[]): NewsStockConfig[] {
  const defaults = new Map(
    defaultNewsStocks.map((stock) => [stock.symbol, stock]),
  );
  return symbols.map(
    (symbol) =>
      defaults.get(symbol) ?? {
        symbol,
        companyName: symbol,
        aliases: [symbol],
        topics: [],
        officialFeedUrls: [],
        enabled: true,
      },
  );
}

const globalSettings = globalThis as typeof globalThis & {
  __newsStrategySettingsProvider?: InMemoryNewsStrategySettingsProvider;
};

export function getNewsStrategySettingsProvider(): NewsStrategySettingsProvider {
  globalSettings.__newsStrategySettingsProvider ??=
    new InMemoryNewsStrategySettingsProvider(environmentInitialSettings());
  return globalSettings.__newsStrategySettingsProvider;
}
