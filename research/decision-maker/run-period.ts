import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { config as loadEnvironment } from 'dotenv';

import { AlpacaHttpReadGateway } from '@/lib/alpaca/alpaca-http-read-gateway';
import { runDecisionPeriod } from '@/research/decision-maker/backtest-engine';
import type { DecisionPeriodRequest, ResearchTimeframe } from '@/research/decision-maker/types';

loadEnvironment({ path: '.env', quiet: true });
loadEnvironment({ path: '.env.local', override: true, quiet: true });

function argumentsMap(values: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (key?.startsWith('--') && value !== undefined) result.set(key.slice(2), value);
  }
  return result;
}

function required(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) throw new Error(`Missing required --${key} argument.`);
  return value;
}

async function main(): Promise<void> {
  const values = argumentsMap(process.argv.slice(2));
  const timeframe = (values.get('timeframe') ?? '1Day') as ResearchTimeframe;
  if (!['1Day', '1Hour', '15Min'].includes(timeframe)) {
    throw new Error('Timeframe must be 1Day, 1Hour, or 15Min.');
  }
  const apiKey = process.env.ALPACA_API_KEY;
  const secretKey = process.env.ALPACA_SECRET_KEY;
  if (!apiKey || !secretKey) {
    throw new Error('Alpaca credentials are missing from .env.local.');
  }
  const request: DecisionPeriodRequest = {
    symbol: required(values, 'symbol'),
    start: required(values, 'start'),
    end: required(values, 'end'),
    timeframe,
    lookbackBars: Number(values.get('lookback') ?? 100),
    evaluationStepBars: Number(values.get('step') ?? 1),
    forwardHorizons: (values.get('horizons') ?? '1,3,5')
      .split(',')
      .map(Number)
      .filter(Number.isFinite),
    feed: values.get('feed') || 'iex',
  };
  const alpaca = new AlpacaHttpReadGateway({
    apiKey,
    secretKey,
    tradingBaseUrl: process.env.ALPACA_API_BASE_URL,
    marketDataBaseUrl: process.env.ALPACA_DATA_BASE_URL,
  });
  const report = await runDecisionPeriod(alpaca, request);
  const output = values.get('output');
  if (output) {
    const absoluteOutput = path.resolve(output);
    await mkdir(path.dirname(absoluteOutput), { recursive: true });
    await writeFile(absoluteOutput, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stdout.write(
      JSON.stringify({ output: absoluteOutput, summary: report.summary }, null, 2),
    );
  } else {
    process.stdout.write(JSON.stringify(report, null, 2));
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Backtest failed.'}\n`);
  process.exitCode = 1;
});
