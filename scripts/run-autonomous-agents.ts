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
      minimumOptionsLevel: integerEnvironment(
        'ALPACA_MIN_OPTIONS_LEVEL',
        2,
      ),
    }),
    true,
  );
  const dataCoordinator = new AgentDataCoordinator(alpaca);
  const coordinator = new AgentScanCoordinator(
    {
      contextSource: new AlpacaDecisionContextSource(dataCoordinator),
      decisionAgent: new TechnicalDecisionAgentAdapter(
        decisionAgentConfigForTimeframe(schedule.timeframe),
      ),
      riskManager: new ExplainableRiskManager(alpaca, policyProvider),
      executionManager: execution,
    },
    schedule,
  );
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());

  writeEvent({
    event: 'orchestrator_started',
    mode: 'autonomous_paper',
    schedule,
    nextScanAt: coordinator.nextScanAt(),
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
