import { createAlpacaReadGatewayFromEnvironment } from '@/lib/alpaca/factory';
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
  const alpaca = createAlpacaReadGatewayFromEnvironment();
  if (!alpaca) return new MockDashboardProvider();
  return AlpacaDashboardProvider.fromGateway(alpaca);
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
