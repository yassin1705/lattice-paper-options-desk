import { parseOptionSymbol } from '@/lib/alpaca/option-symbol';
import type { OpportunityMessage } from '@/lib/agents/contracts/decision-message';
import type {
  EntryRiskFeatures,
  BaseRiskSnapshot,
} from '@/lib/agents/risk-manager/types';

function underlyingForSymbol(symbol: string): string | null {
  return parseOptionSymbol(symbol)?.underlying ?? null;
}

function isOpenOrder(status: string): boolean {
  return [
    'new',
    'accepted',
    'pending_new',
    'partially_filled',
    'pending_replace',
  ].includes(status);
}

export function buildEntryRiskFeatures(
  signal: OpportunityMessage,
  snapshot: BaseRiskSnapshot,
  now: Date,
): EntryRiskFeatures {
  const symbol = signal.analysis.symbol;
  const openOptionPositions = snapshot.positions.filter(
    (position) => position.assetClass === 'us_option',
  );
  const sameUnderlyingPositions = openOptionPositions.filter(
    (position) => underlyingForSymbol(position.symbol) === symbol,
  );
  const pendingSameUnderlyingOrders = snapshot.orders.filter(
    (order) =>
      isOpenOrder(order.status) && underlyingForSymbol(order.symbol) === symbol,
  );
  const day = now.toISOString().slice(0, 10);
  const filledEntries = snapshot.orders.filter(
    (order) =>
      order.assetClass === 'us_option' &&
      order.side === 'buy' &&
      order.status === 'filled' &&
      order.filledAt?.slice(0, 10) === day,
  );
  const lastEntryAt = snapshot.orders
    .filter(
      (order) =>
        order.assetClass === 'us_option' &&
        order.side === 'buy' &&
        order.status === 'filled' &&
        underlyingForSymbol(order.symbol) === symbol &&
        order.filledAt,
    )
    .map((order) => new Date(order.filledAt!).getTime())
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0];
  const minutesToClose = snapshot.marketClock.nextClose
    ? Math.max(
        0,
        (new Date(snapshot.marketClock.nextClose).getTime() - now.getTime()) /
          60_000,
      )
    : null;
  const baselineEquity = snapshot.account.lastEquity || snapshot.account.equity;

  return {
    signal,
    now: now.toISOString(),
    signalExpired: now.getTime() > new Date(signal.validUntil).getTime(),
    minutesToClose,
    dailyProfitLossPercent: baselineEquity
      ? ((snapshot.account.equity - baselineEquity) / baselineEquity) * 100
      : 0,
    openOptionPositions,
    sameUnderlyingPositions,
    pendingSameUnderlyingOrders,
    optionTradesToday: filledEntries.length,
    minutesSinceLastEntry:
      lastEntryAt === undefined
        ? null
        : Math.max(0, (now.getTime() - lastEntryAt) / 60_000),
    portfolioPremiumAtRisk: openOptionPositions.reduce(
      (total, position) => total + Math.abs(position.costBasis),
      0,
    ),
  };
}
