import type { MarketBar } from '@/lib/alpaca/types';

export function atr(bars: MarketBar[], period: number): number | null {
  if (period <= 0 || bars.length <= period) return null;
  const trueRanges = bars.slice(1).map((bar, index) => {
    const previousClose = bars[index].close;
    return Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - previousClose),
      Math.abs(bar.low - previousClose),
    );
  });
  let current =
    trueRanges.slice(0, period).reduce((total, value) => total + value, 0) / period;
  for (const value of trueRanges.slice(period)) {
    current = (current * (period - 1) + value) / period;
  }
  return current;
}
