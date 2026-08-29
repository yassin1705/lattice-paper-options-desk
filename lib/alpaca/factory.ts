import 'server-only';

import { AlpacaHttpReadGateway } from '@/lib/alpaca/alpaca-http-read-gateway';

export function createAlpacaReadGatewayFromEnvironment(): AlpacaHttpReadGateway | null {
  const apiKey = process.env.ALPACA_API_KEY;
  const secretKey = process.env.ALPACA_SECRET_KEY;
  if (!apiKey || !secretKey) return null;

  return new AlpacaHttpReadGateway({
    apiKey,
    secretKey,
    tradingBaseUrl: process.env.ALPACA_API_BASE_URL ?? 'https://paper-api.alpaca.markets',
    marketDataBaseUrl: process.env.ALPACA_DATA_BASE_URL ?? 'https://data.alpaca.markets',
  });
}
