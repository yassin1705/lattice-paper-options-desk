import 'server-only';

import { AgentDataCoordinator } from '@/lib/agents/agent-data-coordinator';
import { AgentScanCoordinator } from '@/lib/agents/communication/agent-scan-coordinator';
import { AlpacaDecisionContextSource } from '@/lib/agents/communication/alpaca-decision-context-source';
import {
  defaultScanScheduleConfig,
  type ScanScheduleConfig,
} from '@/lib/agents/contracts/scan';
import { decisionAgentConfigForTimeframe } from '@/lib/agents/decision-maker/config';
import { TechnicalDecisionAgentAdapter } from '@/lib/agents/decision-maker/technical-decision-agent-adapter';
import { ExplainableRiskManager } from '@/lib/agents/risk-manager/explainable-risk-manager';
import { getRiskPolicyProvider } from '@/lib/agents/risk-manager/policy-provider';
import { createAlpacaReadGatewayFromEnvironment } from '@/lib/alpaca/factory';

export function createAgentDataCoordinatorFromEnvironment(): AgentDataCoordinator | null {
  const alpaca = createAlpacaReadGatewayFromEnvironment();
  return alpaca ? new AgentDataCoordinator(alpaca) : null;
}

export function createAgentScanCoordinatorFromEnvironment(
  schedule: ScanScheduleConfig = defaultScanScheduleConfig,
): AgentScanCoordinator | null {
  const alpaca = createAlpacaReadGatewayFromEnvironment();
  if (!alpaca) return null;
  const dataCoordinator = new AgentDataCoordinator(alpaca);
  return new AgentScanCoordinator(
    {
      contextSource: new AlpacaDecisionContextSource(dataCoordinator),
      decisionAgent: new TechnicalDecisionAgentAdapter(
        decisionAgentConfigForTimeframe(schedule.timeframe),
      ),
      riskManager: new ExplainableRiskManager(alpaca, getRiskPolicyProvider()),
    },
    schedule,
  );
}
