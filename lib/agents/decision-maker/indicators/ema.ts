export function ema(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  const multiplier = 2 / (period + 1);
  let current = values.slice(0, period).reduce((total, value) => total + value, 0) / period;
  for (const value of values.slice(period)) current = (value - current) * multiplier + current;
  return current;
}
