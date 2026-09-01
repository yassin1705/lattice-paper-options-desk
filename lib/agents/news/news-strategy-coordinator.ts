import type {
  DecisionAgentMessage,
  OpportunityMessage,
} from '@/lib/agents/contracts/decision-message';
import type { RiskDecision } from '@/lib/agents/contracts/risk-decision';
import type { ScanDescriptor } from '@/lib/agents/contracts/scan';
import type { ExecutionProposal } from '@/lib/agents/execution/contracts';
import type { ExecutionManagerPort, RiskManagerPort } from '@/lib/agents/ports';
import type { NewsStrategyConfig } from '@/lib/agents/news/config';
import { defaultNewsStrategyConfig } from '@/lib/agents/news/config';
import { NewsAcquisitionService } from '@/lib/agents/news/news-acquisition-service';
import { NewsDecisionAgent } from '@/lib/agents/news/news-decision-agent';
import type {
  NewsAcquisitionResult,
  NewsStockConfig,
} from '@/lib/agents/news/types';

export type NewsSymbolResult =
  | {
      kind: 'no_opportunity';
      symbol: string;
      decision: DecisionAgentMessage & { kind: 'no_opportunity' };
    }
  | {
      kind: 'risk_reviewed';
      symbol: string;
      decision: OpportunityMessage;
      riskDecision: RiskDecision;
      executionProposal: ExecutionProposal | null;
      executionError: string | null;
    }
  | { kind: 'failed'; symbol: string; error: string };

export type NewsCoordinatorResult =
  | { kind: 'not_due'; nextRunAt: string }
  | {
      kind: 'completed';
      runId: string;
      startedAt: string;
      validUntil: string;
      acquisition: NewsAcquisitionResult;
      results: NewsSymbolResult[];
    };

type NewsCoordinatorDependencies = {
  acquisition: NewsAcquisitionService;
  decisionAgent: NewsDecisionAgent;
  riskManager: RiskManagerPort;
  executionManager?: ExecutionManagerPort;
  clock?: () => Date;
};

function normalizeStocks(stocks: NewsStockConfig[]): NewsStockConfig[] {
  const bySymbol = new Map<string, NewsStockConfig>();
  for (const stock of stocks) {
    if (!stock.enabled) continue;
    const symbol = stock.symbol.trim().toUpperCase();
    if (symbol) bySymbol.set(symbol, { ...stock, symbol });
  }
  return [...bySymbol.values()];
}

export class NewsStrategyCoordinator {
  private readonly clock: () => Date;
  private lastRunId: string | null = null;

  constructor(
    private readonly dependencies: NewsCoordinatorDependencies,
    private readonly config: NewsStrategyConfig = defaultNewsStrategyConfig,
  ) {
    this.clock = dependencies.clock ?? (() => new Date());
  }

  nextRunAt(from: Date = this.clock()): string {
    const interval = this.config.frequencyMinutes * 60_000;
    const scheduled = Math.floor(from.getTime() / interval) * interval;
    const id = `news:${new Date(scheduled).toISOString()}`;
    return new Date(
      this.lastRunId === id ? scheduled + interval : scheduled,
    ).toISOString();
  }

  async runDue(stocks: NewsStockConfig[]): Promise<NewsCoordinatorResult> {
    const now = this.clock();
    const interval = this.config.frequencyMinutes * 60_000;
    const scheduled = new Date(Math.floor(now.getTime() / interval) * interval);
    const runId = `news:${scheduled.toISOString()}`;
    if (this.lastRunId === runId)
      return { kind: 'not_due', nextRunAt: this.nextRunAt(now) };
    this.lastRunId = runId;
    return this.execute(normalizeStocks(stocks), runId, now);
  }

  async runTest(
    stocks: NewsStockConfig[],
  ): Promise<Extract<NewsCoordinatorResult, { kind: 'completed' }>> {
    const now = this.clock();
    return this.execute(
      normalizeStocks(stocks),
      `news:test:${now.toISOString()}`,
      now,
    );
  }

  private async execute(
    stocks: NewsStockConfig[],
    runId: string,
    started: Date,
  ): Promise<Extract<NewsCoordinatorResult, { kind: 'completed' }>> {
    const validUntil = new Date(
      started.getTime() + this.config.signalTtlMinutes * 60_000,
    ).toISOString();
    const acquisition = await this.dependencies.acquisition.collect({
      stocks,
      from: new Date(
        started.getTime() - this.config.lookbackHours * 3_600_000,
      ).toISOString(),
      to: started.toISOString(),
      limitPerSymbol: this.config.limitPerSymbol,
    });
    const scan: ScanDescriptor = {
      scanId: runId,
      scheduledAt: started.toISOString(),
      startedAt: started.toISOString(),
      validUntil,
      timeframe: '1Hour',
      lookbackBars: 50,
    };
    const results = await Promise.all(
      stocks.map(async (stock): Promise<NewsSymbolResult> => {
        try {
          const decision = await this.dependencies.decisionAgent.evaluateStock(
            acquisition,
            stock,
            runId,
            started.toISOString(),
            validUntil,
          );
          if (decision.kind === 'no_opportunity') {
            return { kind: 'no_opportunity', symbol: stock.symbol, decision };
          }
          const riskDecision = await this.dependencies.riskManager.assess(
            decision,
            scan,
          );
          let executionProposal: ExecutionProposal | null = null;
          let executionError: string | null = null;
          if (this.dependencies.executionManager) {
            try {
              executionProposal =
                await this.dependencies.executionManager.processEntry(
                  riskDecision,
                );
            } catch (error) {
              executionError =
                error instanceof Error
                  ? error.message
                  : 'News entry handoff failed.';
            }
          }
          return {
            kind: 'risk_reviewed',
            symbol: stock.symbol,
            decision,
            riskDecision,
            executionProposal,
            executionError,
          };
        } catch (error) {
          return {
            kind: 'failed',
            symbol: stock.symbol,
            error:
              error instanceof Error ? error.message : 'News strategy failed.',
          };
        }
      }),
    );
    return {
      kind: 'completed',
      runId,
      startedAt: started.toISOString(),
      validUntil,
      acquisition,
      results,
    };
  }
}
