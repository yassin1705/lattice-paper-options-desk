import type {
  DecisionAgentMessage,
  OpportunityMessage,
} from '@/lib/agents/contracts/decision-message';
import type {
  PositionRiskDecision,
  RiskDecision,
} from '@/lib/agents/contracts/risk-decision';
import {
  defaultScanScheduleConfig,
  type ScanDescriptor,
  type ScanScheduleConfig,
} from '@/lib/agents/contracts/scan';
import type {
  DecisionAgentPort,
  DecisionContextSource,
  RiskManagerPort,
} from '@/lib/agents/ports';

export type ScanSymbolResult =
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
    }
  | {
      kind: 'failed';
      symbol: string;
      error: string;
    };

export type ScanCoordinatorResult =
  | {
      kind: 'not_due';
      nextScanAt: string;
    }
  | {
      kind: 'already_scanned';
      scan: ScanDescriptor;
    }
  | {
      kind: 'completed';
      scan: ScanDescriptor;
      results: ScanSymbolResult[];
      positionDecisions: PositionRiskDecision[];
      positionSupervisionError: string | null;
    };

type CoordinatorDependencies = {
  contextSource: DecisionContextSource;
  decisionAgent: DecisionAgentPort;
  riskManager: RiskManagerPort;
  clock?: () => Date;
};

function validateConfig(config: ScanScheduleConfig): void {
  if (
    !Number.isInteger(config.frequencyMinutes) ||
    config.frequencyMinutes < 1
  ) {
    throw new Error(
      'Scan frequency must be a positive whole number of minutes.',
    );
  }
  if (
    !Number.isInteger(config.delayAfterIntervalMinutes) ||
    config.delayAfterIntervalMinutes < 0
  ) {
    throw new Error(
      'Scan delay must be a non-negative whole number of minutes.',
    );
  }
  if (config.delayAfterIntervalMinutes >= config.frequencyMinutes) {
    throw new Error('Scan delay must be shorter than the scan frequency.');
  }
  if (
    !Number.isInteger(config.maximumLatenessMinutes) ||
    config.maximumLatenessMinutes < 0
  ) {
    throw new Error(
      'Maximum scan lateness must be a non-negative whole number of minutes.',
    );
  }
  if (
    !Number.isInteger(config.signalTtlMinutes) ||
    config.signalTtlMinutes < 1
  ) {
    throw new Error(
      'Signal lifetime must be a positive whole number of minutes.',
    );
  }
  if (config.maximumLatenessMinutes >= config.signalTtlMinutes) {
    throw new Error(
      'Maximum scan lateness must be shorter than the signal lifetime.',
    );
  }
  if (!Number.isInteger(config.lookbackBars) || config.lookbackBars < 50) {
    throw new Error('The decision scan requires at least 50 lookback bars.');
  }
}

function latestScheduledTime(now: Date, config: ScanScheduleConfig): Date {
  const intervalMs = config.frequencyMinutes * 60_000;
  const delayMs = config.delayAfterIntervalMinutes * 60_000;
  const scheduledMs =
    Math.floor((now.getTime() - delayMs) / intervalMs) * intervalMs + delayMs;
  return new Date(scheduledMs);
}

function scanId(
  scheduledAt: Date,
  timeframe: ScanScheduleConfig['timeframe'],
): string {
  return `scan:${timeframe}:${scheduledAt.toISOString()}`;
}

function normalizedSymbols(symbols: string[]): string[] {
  return [
    ...new Set(
      symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean),
    ),
  ];
}

export class AgentScanCoordinator {
  private readonly config: ScanScheduleConfig;
  private readonly clock: () => Date;
  private lastStartedScanId: string | null = null;

  constructor(
    private readonly dependencies: CoordinatorDependencies,
    config: ScanScheduleConfig = defaultScanScheduleConfig,
  ) {
    validateConfig(config);
    if (dependencies.decisionAgent.timeframe !== config.timeframe) {
      throw new Error(
        `Decision agent timeframe ${dependencies.decisionAgent.timeframe} does not match scan timeframe ${config.timeframe}.`,
      );
    }
    this.config = { ...config };
    this.clock = dependencies.clock ?? (() => new Date());
  }

  get schedule(): Readonly<ScanScheduleConfig> {
    return this.config;
  }

  nextScanAt(from: Date = this.clock()): string {
    const latest = latestScheduledTime(from, this.config);
    const withinCurrentWindow =
      from.getTime() - latest.getTime() <=
        this.config.maximumLatenessMinutes * 60_000 &&
      this.lastStartedScanId !== scanId(latest, this.config.timeframe);
    return new Date(
      withinCurrentWindow
        ? latest.getTime()
        : latest.getTime() + this.config.frequencyMinutes * 60_000,
    ).toISOString();
  }

  async runDueScan(
    symbols: string[],
    startedAt: Date = this.clock(),
  ): Promise<ScanCoordinatorResult> {
    const scheduledAt = latestScheduledTime(startedAt, this.config);
    const latenessMs = startedAt.getTime() - scheduledAt.getTime();
    if (latenessMs > this.config.maximumLatenessMinutes * 60_000) {
      return {
        kind: 'not_due',
        nextScanAt: new Date(
          scheduledAt.getTime() + this.config.frequencyMinutes * 60_000,
        ).toISOString(),
      };
    }

    const currentScanId = scanId(scheduledAt, this.config.timeframe);
    const scan: ScanDescriptor = {
      scanId: currentScanId,
      scheduledAt: scheduledAt.toISOString(),
      startedAt: startedAt.toISOString(),
      validUntil: new Date(
        scheduledAt.getTime() + this.config.signalTtlMinutes * 60_000,
      ).toISOString(),
      timeframe: this.config.timeframe,
      lookbackBars: this.config.lookbackBars,
    };
    if (this.lastStartedScanId === currentScanId)
      return { kind: 'already_scanned', scan };
    this.lastStartedScanId = currentScanId;

    const requestedSymbols = normalizedSymbols(symbols);
    const results = await Promise.all(
      requestedSymbols.map((symbol) => this.scanSymbol(symbol, scan)),
    );
    try {
      const positionDecisions =
        await this.dependencies.riskManager.superviseOpenPositions(scan);
      return {
        kind: 'completed',
        scan,
        results,
        positionDecisions,
        positionSupervisionError: null,
      };
    } catch (error) {
      return {
        kind: 'completed',
        scan,
        results,
        positionDecisions: [],
        positionSupervisionError:
          error instanceof Error
            ? error.message
            : 'Position supervision failed.',
      };
    }
  }

  private async scanSymbol(
    symbol: string,
    scan: ScanDescriptor,
  ): Promise<ScanSymbolResult> {
    try {
      const context = await this.dependencies.contextSource.getDecisionContext({
        symbol,
        scan,
      });
      const decision = await this.dependencies.decisionAgent.evaluate({
        context,
        scan,
      });
      if (decision.kind === 'no_opportunity') {
        return { kind: 'no_opportunity', symbol, decision };
      }
      const riskDecision = await this.dependencies.riskManager.assess(
        decision,
        scan,
      );
      return { kind: 'risk_reviewed', symbol, decision, riskDecision };
    } catch (error) {
      return {
        kind: 'failed',
        symbol,
        error: error instanceof Error ? error.message : 'Agent scan failed.',
      };
    }
  }
}
