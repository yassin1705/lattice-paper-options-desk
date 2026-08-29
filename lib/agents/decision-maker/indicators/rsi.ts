export function rsi(values: number[], period: number): number | null {
  if (period <= 0 || values.length <= period) return null;
  const changes = values.slice(1).map((value, index) => value - values[index]);
  let averageGain =
    changes.slice(0, period).reduce((total, change) => total + Math.max(change, 0), 0) /
    period;
  let averageLoss =
    changes.slice(0, period).reduce((total, change) => total + Math.max(-change, 0), 0) /
    period;

  for (const change of changes.slice(period)) {
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
  }

  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}
