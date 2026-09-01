import { config as loadEnvironment } from 'dotenv';

import { AgentDataCoordinator } from '@/lib/agents/agent-data-coordinator';
import { AgentScanCoordinator } from '@/lib/agents/communication/agent-scan-coordinator';
import { AlpacaDecisionContextSource } from '@/lib/agents/communication/alpaca-decision-context-source';
import {
  defaultScanScheduleConfig,
  type ScanScheduleConfig,
  type ScanTimeframe,
} from '@/lib/agents/contracts/scan';
import { decisionAgentConfigForTimeframe } from '@/lib/agents/decision-maker/config';
import { TechnicalDecisionAgentAdapter } from '@/lib/agents/decision-maker/technical-decision-agent-adapter';
import { ExecutionManager } from '@/lib/agents/execution/execution-manager';
import { ExplainableRiskManager } from '@/lib/agents/risk-manager/explainable-risk-manager';
import {
  defaultNewsStocks,
  defaultNewsStrategyConfig,
  type NewsStrategyConfig,
} from '@/lib/agents/news/config';
import { NewsAcquisitionService } from '@/lib/agents/news/news-acquisition-service';
import { NewsDecisionAgent } from '@/lib/agents/news/news-decision-agent';
import { NewsStrategyCoordinator } from '@/lib/agents/news/news-strategy-coordinator';
import { OllamaNewsModel } from '@/lib/agents/news/ollama-news-model';
import {
  AlpacaNewsSource,
  AlphaVantageNewsSource,
  FinnhubNewsSource,
  GdeltNewsSource,
  GoogleNewsRssSource,
  OfficialCompanyNewsSource,
} from '@/lib/agents/news/sources/http-news-sources';
import type { NewsSourcePort, NewsStockConfig } from '@/lib/agents/news/types';
import { HttpRiskPolicyProvider } from '@/lib/agents/risk-manager/http-policy-provider';
import { AlpacaCliExecutionGateway } from '@/lib/alpaca/alpaca-cli-execution-gateway';
import { AlpacaHttpReadGateway } from '@/lib/alpaca/alpaca-http-read-gateway';

loadEnvironment({ path: '.env', quiet: true });
loadEnvironment({ path: '.env.local', override: true, quiet: true });

function integerEnvironment(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value))
    throw new Error(`${name} must be a whole number.`);
  return value;
}

function numberEnvironment(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number.`);
  return value;
}

function booleanEnvironment(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

function scheduleFromEnvironment(): ScanScheduleConfig {
  const timeframe = (process.env.AGENT_SCAN_TIMEFRAME ??
    defaultScanScheduleConfig.timeframe) as ScanTimeframe;
  if (!['15Min', '1Hour', '1Day'].includes(timeframe)) {
    throw new Error('AGENT_SCAN_TIMEFRAME must be 15Min, 1Hour, or 1Day.');
  }
  return {
    timeframe,
    lookbackBars: integerEnvironment(
      'AGENT_SCAN_LOOKBACK_BARS',
      defaultScanScheduleConfig.lookbackBars,
    ),
    frequencyMinutes: integerEnvironment(
      'AGENT_SCAN_FREQUENCY_MINUTES',
      defaultScanScheduleConfig.frequencyMinutes,
    ),
    delayAfterIntervalMinutes: integerEnvironment(
      'AGENT_SCAN_DELAY_MINUTES',
      defaultScanScheduleConfig.delayAfterIntervalMinutes,
    ),
    maximumLatenessMinutes: integerEnvironment(
      'AGENT_SCAN_MAXIMUM_LATENESS_MINUTES',
      defaultScanScheduleConfig.maximumLatenessMinutes,
    ),
    signalTtlMinutes: integerEnvironment(
      'AGENT_SIGNAL_TTL_MINUTES',
      defaultScanScheduleConfig.signalTtlMinutes,
    ),
  };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing from .env.local.`);
  return value;
}

function newsScheduleFromEnvironment(): NewsStrategyConfig {
  const minimumImpact =
    process.env.NEWS_MINIMUM_IMPACT ?? defaultNewsStrategyConfig.minimumImpact;
  if (minimumImpact !== 'medium' && minimumImpact !== 'high') {
    throw new Error('NEWS_MINIMUM_IMPACT must be medium or high.');
  }
  return {
    frequencyMinutes: integerEnvironment(
      'NEWS_SCAN_FREQUENCY_MINUTES',
      defaultNewsStrategyConfig.frequencyMinutes,
    ),
    lookbackHours: integerEnvironment(
      'NEWS_LOOKBACK_HOURS',
      defaultNewsStrategyConfig.lookbackHours,
    ),
    signalTtlMinutes: integerEnvironment(
      'NEWS_SIGNAL_TTL_MINUTES',
      defaultNewsStrategyConfig.signalTtlMinutes,
    ),
    limitPerSymbol: integerEnvironment(
      'NEWS_LIMIT_PER_SYMBOL',
      defaultNewsStrategyConfig.limitPerSymbol,
    ),
    minimumConfidence: numberEnvironment(
      'NEWS_MINIMUM_CONFIDENCE',
      defaultNewsStrategyConfig.minimumConfidence,
    ),
    minimumRelevance: numberEnvironment(
      'NEWS_MINIMUM_RELEVANCE',
      defaultNewsStrategyConfig.minimumRelevance,
    ),
    minimumImpact,
  };
}

function newsStocksFromEnvironment(): NewsStockConfig[] {
  const requested = (
    process.env.NEWS_STRATEGY_SYMBOLS ?? 'NVDA,AAPL,MSFT,AMZN,META'
  )
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
  const defaults = new Map(
    defaultNewsStocks.map((stock) => [stock.symbol, stock]),
  );
  return [...new Set(requested)].map(
    (symbol) =>
      defaults.get(symbol) ?? {
        symbol,
        companyName: symbol,
        aliases: [symbol],
        topics: [],
        officialFeedUrls: [],
        enabled: true,
      },
  );
}

function newsSources(apiKey: string, secretKey: string): NewsSourcePort[] {
  const sources: NewsSourcePort[] = [
    new AlpacaNewsSource(
      apiKey,
      secretKey,
      process.env.ALPACA_DATA_BASE_URL ?? 'https://data.alpaca.markets',
    ),
    new GoogleNewsRssSource(),
    new OfficialCompanyNewsSource(),
  ];
  if (booleanEnvironment('GDELT_NEWS_ENABLED', false)) {
    sources.push(new GdeltNewsSource({ timeoutMs: 30_000 }));
  }
  if (process.env.FINNHUB_API_KEY) {
    sources.push(new FinnhubNewsSource(process.env.FINNHUB_API_KEY));
  }
  if (process.env.ALPHA_VANTAGE_API_KEY) {
    sources.push(new AlphaVantageNewsSource(process.env.ALPHA_VANTAGE_API_KEY));
  }
  return sources;
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, Math.max(0, milliseconds));
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

function writeEvent(event: Record<string, unknown>): void {
  process.stdout.write(
    `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`,
  );
}

async function main(): Promise<void> {
  const apiKey = requiredEnvironment('ALPACA_API_KEY');
  const secretKey = requiredEnvironment('ALPACA_SECRET_KEY');
  const tradingBaseUrl =
    process.env.ALPACA_API_BASE_URL ?? 'https://paper-api.alpaca.markets';
  const schedule = scheduleFromEnvironment();
  const policyProvider = new HttpRiskPolicyProvider(
    process.env.LOCAL_DASHBOARD_URL ?? 'http://localhost:3000',
  );
  const alpaca = new AlpacaHttpReadGateway({
    apiKey,
    secretKey,
    tradingBaseUrl,
    marketDataBaseUrl:
      process.env.ALPACA_DATA_BASE_URL ?? 'https://data.alpaca.markets',
  });
  const execution = new ExecutionManager(
    new AlpacaCliExecutionGateway({
      apiKey,
      secretKey,
      binaryPath: process.env.ALPACA_CLI_PATH ?? 'alpaca',
      expectedAccountId: process.env.ALPACA_EXPECTED_ACCOUNT_ID,
      minimumOptionsLevel: integerEnvironment('ALPACA_MIN_OPTIONS_LEVEL', 2),
    }),
    true,
  );
  const dataCoordinator = new AgentDataCoordinator(alpaca);
  const riskManager = new ExplainableRiskManager(alpaca, policyProvider);
  const coordinator = new AgentScanCoordinator(
    {
      contextSource: new AlpacaDecisionContextSource(dataCoordinator),
      decisionAgent: new TechnicalDecisionAgentAdapter(
        decisionAgentConfigForTimeframe(schedule.timeframe),
      ),
      riskManager,
      executionManager: execution,
    },
    schedule,
  );
  const newsEnabled = booleanEnvironment('NEWS_STRATEGY_ENABLED', false);
  const newsSchedule = newsScheduleFromEnvironment();
  const newsUniverse = newsStocksFromEnvironment();
  const newsCoordinator = newsEnabled
    ? new NewsStrategyCoordinator(
        {
          acquisition: new NewsAcquisitionService(
            newsSources(apiKey, secretKey),
          ),
          decisionAgent: new NewsDecisionAgent(
            new OllamaNewsModel({
              modelName: process.env.NEWS_LLM_MODEL ?? 'qwen3:8b',
              baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
            }),
            newsSchedule,
          ),
          riskManager,
          executionManager: execution,
        },
        newsSchedule,
      )
    : null;
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());

  writeEvent({
    event: 'orchestrator_started',
    mode: 'autonomous_paper',
    schedule,
    nextScanAt: coordinator.nextScanAt(),
    newsStrategy: {
      enabled: newsEnabled,
      schedule: newsSchedule,
      symbols: newsUniverse.map((stock) => stock.symbol),
      model: process.env.NEWS_LLM_MODEL ?? 'qwen3:8b',
      nextRunAt: newsCoordinator?.nextRunAt() ?? null,
    },
  });

  while (!controller.signal.aborted) {
    try {
      const policy = await policyProvider.getPolicy();
      const result = await coordinator.runDueScan(
        policy.policy.approvedUnderlyings,
      );
      if (result.kind === 'completed') {
        writeEvent({
          event: 'scan_completed',
          scanId: result.scan.scanId,
          symbols: policy.policy.approvedUnderlyings,
          decisions: result.results.map((item) => ({
            symbol: item.symbol,
            outcome: item.kind,
            risk: item.kind === 'risk_reviewed' ? item.riskDecision.kind : null,
            riskReasons:
              item.kind === 'risk_reviewed' &&
              item.riskDecision.kind === 'rejected_trade'
                ? item.riskDecision.reasons
                : [],
            execution:
              item.kind === 'risk_reviewed'
                ? (item.executionProposal?.status ?? null)
                : null,
            error: item.kind === 'failed' ? item.error : null,
          })),
          exits: result.positionExecutionProposals.map((proposal) => ({
            symbol: proposal.order.symbol,
            status: proposal.status,
            error: proposal.error,
          })),
          positionSupervisionError: result.positionSupervisionError,
          positionExecutionError: result.positionExecutionError,
        });
      }
      if (newsCoordinator) {
        const newsResult = await newsCoordinator.runDue(newsUniverse);
        if (newsResult.kind === 'completed') {
          writeEvent({
            event: 'news_scan_completed',
            runId: newsResult.runId,
            symbols: newsUniverse.map((stock) => stock.symbol),
            sources: newsResult.acquisition.sourceReports,
            articlesReceived: newsResult.acquisition.articlesReceived,
            duplicatesRemoved: newsResult.acquisition.duplicatesRemoved,
            decisions: newsResult.results.map((item) => ({
              symbol: item.symbol,
              outcome: item.kind,
              direction:
                item.kind === 'risk_reviewed' ? item.decision.direction : null,
              risk:
                item.kind === 'risk_reviewed' ? item.riskDecision.kind : null,
              execution:
                item.kind === 'risk_reviewed'
                  ? (item.executionProposal?.status ?? null)
                  : null,
              error: item.kind === 'failed' ? item.error : null,
            })),
          });
        }
      }
    } catch (error) {
      writeEvent({
        event: 'orchestrator_error',
        error:
          error instanceof Error
            ? error.message
            : 'Unknown orchestrator error.',
      });
    }

    const nextScanAt = new Date(coordinator.nextScanAt()).getTime();
    const retryAt = Date.now() + 60_000;
    await wait(
      Math.max(1_000, Math.min(nextScanAt, retryAt) - Date.now()),
      controller.signal,
    );
  }

  writeEvent({ event: 'orchestrator_stopped' });
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Autonomous orchestrator failed.'}\n`,
  );
  process.exitCode = 1;
});
