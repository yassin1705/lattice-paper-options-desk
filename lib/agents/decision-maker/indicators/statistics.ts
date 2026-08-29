export function percentReturn(values: number[], periods: number): number | null {
  if (periods <= 0 || values.length <= periods) return null;
  const current = values.at(-1) ?? 0;
  const previous = values.at(-(periods + 1)) ?? 0;
  return previous > 0 ? current / previous - 1 : null;
}

export function standardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

export function realizedVolatility(
  values: number[],
  period: number,
  annualizationFactor = 252,
): number | null {
  if (period <= 1 || values.length <= period) return null;
  const returns = values.slice(1).map((value, index) => {
    const previous = values[index];
    return previous > 0 ? Math.log(value / previous) : 0;
  });
  const deviation = standardDeviation(returns.slice(-period));
  return deviation === null ? null : deviation * Math.sqrt(annualizationFactor);
}

export function zScore(values: number[], period: number): number | null {
  if (period <= 1 || values.length < period) return null;
  const window = values.slice(-period);
  const current = window.at(-1) ?? 0;
  const mean = window.reduce((total, value) => total + value, 0) / window.length;
  const deviation = standardDeviation(window);
  return deviation && deviation > 0 ? (current - mean) / deviation : 0;
}
