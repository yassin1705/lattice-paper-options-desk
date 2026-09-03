import type {
  PositionRiskDecision,
  RiskDecision,
} from '@/lib/agents/contracts/risk-decision';
import type {
  ExecutionOrderRequest,
  ExecutionProposal,
  ExecutionStatus,
  StockEntryRequest,
} from '@/lib/agents/execution/contracts';
import type {
  ExecutionManagerPort,
  PaperOrderGateway,
} from '@/lib/agents/execution/ports';
import { parseOptionSymbol } from '@/lib/alpaca/option-symbol';

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function clientOrderId(
  source: 'entry' | 'exit',
  strategyId: 'technical' | 'news_llm' | null,
  reference: string,
  symbol: string,
  revision: number,
): string {
  const strategy =
    strategyId === 'technical' ? 't' : strategyId === 'news_llm' ? 'n' : 'x';
  return `agent-${source}-${strategy}-r${revision}-${stableHash(`${reference}:${symbol}`)}`;
}

export class ExecutionManager implements ExecutionManagerPort {
  private readonly proposals = new Map<string, ExecutionProposal>();

  constructor(
    private readonly gateway: PaperOrderGateway,
    private readonly enabled = false,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async processEntry(
    decision: RiskDecision,
  ): Promise<ExecutionProposal | null> {
    if (decision.kind !== 'approved_trade_plan') return null;
    const order: ExecutionOrderRequest = {
      symbol: decision.plan.contractSymbol,
      quantity: decision.plan.quantity,
      side: 'buy',
      positionIntent: 'buy_to_open',
      type: 'limit',
      timeInForce: 'day',
      limitPrice: decision.plan.maximumEntryPrice,
      clientOrderId: clientOrderId(
        'entry',
        decision.strategyId,
        decision.signalId,
        decision.plan.contractSymbol,
        decision.policyRevision,
      ),
    };
    return this.stage(
      'entry',
      decision.signalId,
      decision.policyRevision,
      order,
    );
  }

  async processStockEntry(
    request: StockEntryRequest,
  ): Promise<ExecutionProposal> {
    const order: ExecutionOrderRequest = {
      symbol: request.symbol,
      quantity: request.quantity,
      side: 'buy',
      type: 'limit',
      timeInForce: 'day',
      limitPrice: request.limitPrice,
      clientOrderId: clientOrderId(
        'entry',
        null,
        request.sourceReference,
        request.symbol,
        request.policyRevision,
      ),
    };
    return this.stage(
      'entry',
      request.sourceReference,
      request.policyRevision,
      order,
    );
  }

  async processPositionDecisions(
    decisions: PositionRiskDecision[],
  ): Promise<ExecutionProposal[]> {
    const proposals: ExecutionProposal[] = [];
    for (const decision of decisions) {
      if (decision.kind !== 'exit_position') continue;
      const reference = `${decision.contractSymbol}:${decision.reviewedAt}`;
      const order: ExecutionOrderRequest = {
        symbol: decision.contractSymbol,
        quantity: decision.quantity,
        side: 'sell',
        positionIntent: 'sell_to_close',
        type: 'limit',
        timeInForce: 'day',
        limitPrice: decision.proposedLimitPrice ?? 0,
        clientOrderId: clientOrderId(
          'exit',
          null,
          reference,
          decision.contractSymbol,
          decision.policyRevision,
        ),
      };
      proposals.push(
        await this.stage('exit', reference, decision.policyRevision, order),
      );
    }
    return proposals;
  }

  getStatus(): ExecutionStatus {
    return {
      enabled: this.enabled,
      environment: 'paper',
      proposals: [...this.proposals.values()].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      ),
    };
  }

  private async stage(
    source: 'entry' | 'exit',
    sourceReference: string,
    policyRevision: number,
    order: ExecutionOrderRequest,
  ): Promise<ExecutionProposal> {
    const id = order.clientOrderId;
    const existing = this.proposals.get(id);
    if (existing) return existing;
    const optionOrder = Boolean(parseOptionSymbol(order.symbol));
    const invalidOrder =
      order.quantity <= 0 ||
      (optionOrder && !Number.isInteger(order.quantity)) ||
      !Number.isFinite(order.limitPrice) ||
      order.limitPrice <= 0;
    const proposal: ExecutionProposal = {
      id,
      source,
      sourceReference,
      policyRevision,
      createdAt: this.clock().toISOString(),
      status: invalidOrder ? 'failed' : 'ready',
      order,
      receipt: null,
      error: invalidOrder
        ? 'A valid positive quantity and limit price are required.'
        : null,
    };
    this.proposals.set(id, proposal);
    if (!invalidOrder && this.enabled) {
      return this.submit(proposal);
    }
    return proposal;
  }

  private async submit(
    proposal: ExecutionProposal,
  ): Promise<ExecutionProposal> {
    try {
      const receipt = await this.gateway.submitOrder(proposal.order);
      const submitted: ExecutionProposal = {
        ...proposal,
        status: 'submitted',
        receipt,
        error: null,
      };
      this.proposals.set(proposal.id, submitted);
      return submitted;
    } catch (error) {
      const failed: ExecutionProposal = {
        ...proposal,
        status: 'failed',
        error:
          error instanceof Error
            ? error.message
            : 'Paper order submission failed.',
      };
      this.proposals.set(proposal.id, failed);
      return failed;
    }
  }
}
