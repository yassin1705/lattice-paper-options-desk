import 'server-only';

import { AgentDataCoordinator } from '@/lib/agents/agent-data-coordinator';
import {
  AgentScanCoordinator,
  type CompletedScanCoordinatorResult,
} from '@/lib/agents/communication/agent-scan-coordinator';
import { AlpacaDecisionContextSource } from '@/lib/agents/communication/alpaca-decision-context-source';
import {
  defaultScanScheduleConfig,
  type ScanScheduleConfig,
} from '@/lib/agents/contracts/scan';
import { decisionAgentConfigForTimeframe } from '@/lib/agents/decision-maker/config';
import { TechnicalDecisionAgentAdapter } from '@/lib/agents/decision-maker/technical-decision-agent-adapter';
import { ExplainableRiskManager } from '@/lib/agents/risk-manager/explainable-risk-manager';
import {
  getRiskPolicyProvider,
  type RiskPolicyProvider,
} from '@/lib/agents/risk-manager/policy-provider';
import { AlpacaHttpReadGateway } from '@/lib/alpaca/alpaca-http-read-gateway';

export type OrchestratorStatus = {
  busy: boolean;
  mode: 'dashboard_analysis';
  executionMode: 'alpaca_cli_runner';
  lastRunAt: string | null;
  lastRunType: 'safe_test' | null;
  lastSummary: {
    symbols: number;
    opportunities: number;
    approved: number;
    submitted: number;
    rejected: number;
    failed: number;
    exitsSubmitted: number;
  } | null;
  error: string | null;
};

function summarize(result: CompletedScanCoordinatorResult) {
  const reviewed = result.results.filter(
    (item) => item.kind === 'risk_reviewed',
  );
  return {
    symbols: result.results.length,
    opportunities: reviewed.length,
    approved: reviewed.filter(
      (item) =>
        item.kind === 'risk_reviewed' &&
        item.riskDecision.kind === 'approved_trade_plan',
    ).length,
    submitted: reviewed.filter(
      (item) =>
        item.kind === 'risk_reviewed' &&
        item.executionProposal?.status === 'submitted',
    ).length,
    rejected: reviewed.filter(
      (item) =>
        item.kind === 'risk_reviewed' &&
        item.riskDecision.kind === 'rejected_trade',
    ).length,
    failed: result.results.filter((item) => item.kind === 'failed').length,
    exitsSubmitted: result.positionExecutionProposals.filter(
      (proposal) => proposal.status === 'submitted',
    ).length,
  };
}

export class AutonomousOrchestratorService {
  private busy = false;
  private lastRunAt: string | null = null;
  private lastRunType: 'safe_test' | null = null;
  private lastSummary: OrchestratorStatus['lastSummary'] = null;
  private error: string | null = null;

  constructor(
    private readonly testCoordinator: AgentScanCoordinator,
    private readonly policyProvider: RiskPolicyProvider,
  ) {}

  async runSafeTest(): Promise<OrchestratorStatus> {
    if (this.busy) throw new Error('An agent cycle is already running.');
    this.busy = true;
    this.error = null;
    try {
      const policy = await this.policyProvider.getPolicy();
      const result = await this.testCoordinator.runTestScan(
        policy.policy.approvedUnderlyings,
      );
      this.lastRunAt = new Date().toISOString();
      this.lastRunType = 'safe_test';
      this.lastSummary = summarize(result);
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : 'The safe test failed.';
    } finally {
      this.busy = false;
    }
    return this.status();
  }

  status(): OrchestratorStatus {
    return {
      busy: this.busy,
      mode: 'dashboard_analysis',
      executionMode: 'alpaca_cli_runner',
      lastRunAt: this.lastRunAt,
      lastRunType: this.lastRunType,
      lastSummary: this.lastSummary,
      error: this.error,
    };
  }
}

function buildCoordinator(
  alpaca: AlpacaHttpReadGateway,
  policyProvider: RiskPolicyProvider,
  schedule: ScanScheduleConfig,
): AgentScanCoordinator {
  const dataCoordinator = new AgentDataCoordinator(alpaca);
  return new AgentScanCoordinator(
    {
      contextSource: new AlpacaDecisionContextSource(dataCoordinator),
      decisionAgent: new TechnicalDecisionAgentAdapter(
        decisionAgentConfigForTimeframe(schedule.timeframe),
      ),
      riskManager: new ExplainableRiskManager(alpaca, policyProvider),
    },
    schedule,
  );
}

function createService(): AutonomousOrchestratorService | null {
  const apiKey = process.env.ALPACA_API_KEY;
  const secretKey = process.env.ALPACA_SECRET_KEY;
  if (!apiKey || !secretKey) return null;
  const tradingBaseUrl =
    process.env.ALPACA_API_BASE_URL ?? 'https://paper-api.alpaca.markets';
  const alpaca = new AlpacaHttpReadGateway({
    apiKey,
    secretKey,
    tradingBaseUrl,
    marketDataBaseUrl:
      process.env.ALPACA_DATA_BASE_URL ?? 'https://data.alpaca.markets',
  });
  const policyProvider = getRiskPolicyProvider();
  return new AutonomousOrchestratorService(
    buildCoordinator(alpaca, policyProvider, defaultScanScheduleConfig),
    policyProvider,
  );
}

const globalOrchestrator = globalThis as typeof globalThis & {
  __alpacaAutonomousOrchestrator?: AutonomousOrchestratorService | null;
};

export function getAutonomousOrchestratorService(): AutonomousOrchestratorService | null {
  if (globalOrchestrator.__alpacaAutonomousOrchestrator === undefined) {
    globalOrchestrator.__alpacaAutonomousOrchestrator = createService();
  }
  return globalOrchestrator.__alpacaAutonomousOrchestrator;
}
