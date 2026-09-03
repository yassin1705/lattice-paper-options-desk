import { describe, expect, it, vi } from 'vitest';

import {
  HttpNewsStrategySettingsProvider,
  InMemoryNewsStrategySettingsProvider,
  defaultNewsStrategySettings,
  newsStocksForSymbols,
  validateNewsStrategySettings,
} from '@/lib/agents/news/settings';

describe('news strategy settings', () => {
  it('normalizes and deduplicates the configured symbols', () => {
    const settings = validateNewsStrategySettings({
      ...defaultNewsStrategySettings,
      enabled: true,
      symbols: ['nvda', ' NVDA ', 'aapl'],
    });

    expect(settings.symbols).toEqual(['NVDA', 'AAPL']);
  });

  it('rejects an empty universe and scans faster than one hour', () => {
    expect(() =>
      validateNewsStrategySettings({
        ...defaultNewsStrategySettings,
        symbols: [],
      }),
    ).toThrow('between 1 and 20');
    expect(() =>
      validateNewsStrategySettings({
        ...defaultNewsStrategySettings,
        frequencyMinutes: 30,
      }),
    ).toThrow('at least 60 minutes');
  });

  it('increments its revision and returns isolated snapshots', async () => {
    const provider = new InMemoryNewsStrategySettingsProvider();
    const first = await provider.getSettings();
    first.settings.symbols.push('TSLA');
    const updated = await provider.updateSettings({
      ...defaultNewsStrategySettings,
      enabled: true,
      symbols: ['NVDA'],
    });

    expect(updated.revision).toBe(2);
    expect(updated.settings.enabled).toBe(true);
    expect((await provider.getSettings()).settings.symbols).toEqual(['NVDA']);
  });

  it('reads runner settings from the local dashboard endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        revision: 3,
        updatedAt: '2026-09-02T00:00:00.000Z',
        settings: {
          ...defaultNewsStrategySettings,
          enabled: true,
          symbols: ['nvda'],
        },
      }),
    );
    const provider = new HttpNewsStrategySettingsProvider(
      'http://localhost:3000',
      fetcher,
    );

    const snapshot = await provider.getSettings();

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:3000/api/news-strategy',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
    expect(snapshot.settings.symbols).toEqual(['NVDA']);
  });

  it('keeps configured metadata for defaults and supports custom symbols', () => {
    const stocks = newsStocksForSymbols(['NVDA', 'TSLA']);

    expect(stocks[0]?.companyName).toBe('NVIDIA');
    expect(stocks[1]).toMatchObject({
      symbol: 'TSLA',
      companyName: 'TSLA',
      enabled: true,
    });
  });
});
