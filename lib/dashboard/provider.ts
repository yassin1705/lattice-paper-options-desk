import { AlpacaDashboardProvider } from '@/lib/dashboard/alpaca-provider';
import { mockAssets, mockSnapshot } from '@/lib/dashboard/mock-data';
import type { DashboardDataProvider, DashboardSnapshot, TradableAsset } from '@/lib/dashboard/types';

class MockDashboardProvider implements DashboardDataProvider {
  async getSnapshot(): Promise<DashboardSnapshot> {
    return { ...mockSnapshot, updatedAt: new Date().toISOString() };
  }

  async searchAssets(query: string): Promise<TradableAsset[]> {
    const normalized = query.trim().toUpperCase();
    return mockAssets.filter((asset) => {
      return (
        !normalized ||
        asset.symbol.includes(normalized) ||
        asset.name.toUpperCase().includes(normalized)
      );
    });
  }
}

export function getDashboardProvider(): DashboardDataProvider {
  const apiKey = process.env.ALPACA_API_KEY;
  const secretKey = process.env.ALPACA_SECRET_KEY;
  const baseUrl = process.env.ALPACA_API_BASE_URL ?? 'https://paper-api.alpaca.markets';

  if (!apiKey || !secretKey) return new MockDashboardProvider();
  return new AlpacaDashboardProvider(apiKey, secretKey, baseUrl);
}

export function snapshotWithConnectionError(message: string): DashboardSnapshot {
  return {
    ...mockSnapshot,
    connection: {
      status: 'error',
      label: 'Alpaca connection error',
      detail: message,
    },
    updatedAt: new Date().toISOString(),
  };
}
