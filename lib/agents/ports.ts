import type { DecisionContext } from '@/lib/agents/types';
import type {
  DecisionAgentMessage,
  OpportunityMessage,
} from '@/lib/agents/contracts/decision-message';
import type { RiskDecision } from '@/lib/agents/contracts/risk-decision';
import type { ScanDescriptor } from '@/lib/agents/contracts/scan';
import type { ScanTimeframe } from '@/lib/agents/contracts/scan';

export type DecisionEvaluationRequest = {
  context: DecisionContext;
  scan: ScanDescriptor;
};

export interface DecisionAgentPort {
  readonly agentName: string;
  readonly agentVersion: string;
  readonly timeframe: ScanTimeframe;
  evaluate(request: DecisionEvaluationRequest): Promise<DecisionAgentMessage>;
}

export type DecisionContextSourceRequest = {
  symbol: string;
  scan: ScanDescriptor;
};

export interface DecisionContextSource {
  getDecisionContext(
    request: DecisionContextSourceRequest,
  ): Promise<DecisionContext>;
}

export interface RiskManagerPort {
  assess(
    signal: OpportunityMessage,
    scan: ScanDescriptor,
  ): Promise<RiskDecision>;
}
