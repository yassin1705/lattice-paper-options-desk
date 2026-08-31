import 'server-only';

import { AlpacaHttpReadGateway } from '@/lib/alpaca/alpaca-http-read-gateway';
import { AlpacaPaperExecutionGateway } from '@/lib/alpaca/alpaca-paper-execution-gateway';

export function createAlpacaReadGatewayFromEnvironment(): AlpacaHttpReadGateway | null {
  const apiKey = process.env.ALPACA_API_KEY;
  const secretKey = process.env.ALPACA_SECRET_KEY;
  if (!apiKey || !secretKey) return null;

  return new AlpacaHttpReadGateway({
    apiKey,
    secretKey,
    tradingBaseUrl:
      process.env.ALPACA_API_BASE_URL ?? 'https://paper-api.alpaca.markets',
    marketDataBaseUrl:
      process.env.ALPACA_DATA_BASE_URL ?? 'https://data.alpaca.markets',
  });
}

export function createAlpacaPaperExecutionGatewayFromEnvironment(): AlpacaPaperExecutionGateway | null {
  const apiKey = process.env.ALPACA_API_KEY;
  const secretKey = process.env.ALPACA_SECRET_KEY;
  if (!apiKey || !secretKey) return null;

  return new AlpacaPaperExecutionGateway({
    apiKey,
    secretKey,
    tradingBaseUrl:
      process.env.ALPACA_API_BASE_URL ?? 'https://paper-api.alpaca.markets',
  });
}
