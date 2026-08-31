import type {
  PositionRiskDecision,
  RiskDecision,
} from '@/lib/agents/contracts/risk-decision';
import type {
  ExecutionOrderRequest,
  ExecutionProposal,
  ExecutionReceipt,
  ExecutionStatus,
} from '@/lib/agents/execution/contracts';

export interface PaperOrderGateway {
  submitOrder(order: ExecutionOrderRequest): Promise<ExecutionReceipt>;
}

export interface ExecutionManagerPort {
  processEntry(decision: RiskDecision): Promise<ExecutionProposal | null>;
  processPositionDecisions(
    decisions: PositionRiskDecision[],
  ): Promise<ExecutionProposal[]>;
  getStatus(): ExecutionStatus;
}
