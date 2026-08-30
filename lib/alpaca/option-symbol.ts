export type ParsedOptionSymbol = {
  underlying: string;
  expirationDate: string;
  type: 'call' | 'put';
  strikePrice: number;
};

export function parseOptionSymbol(symbol: string): ParsedOptionSymbol | null {
  const match = symbol
    .toUpperCase()
    .match(/^([A-Z]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!match) return null;
  const [, underlying, year, month, day, type, strike] = match;
  return {
    underlying,
    expirationDate: `20${year}-${month}-${day}`,
    type: type === 'C' ? 'call' : 'put',
    strikePrice: Number(strike) / 1_000,
  };
}
