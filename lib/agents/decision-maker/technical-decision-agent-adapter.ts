import type { DecisionAgentMessage } from '@/lib/agents/contracts/decision-message';
import { decisionMessageSchemaVersion } from '@/lib/agents/contracts/decision-message';
import type {
  DecisionEvaluationRequest,
  DecisionAgentPort,
} from '@/lib/agents/ports';
import {
  defaultDecisionAgentConfig,
  type DecisionAgentConfig,
} from '@/lib/agents/decision-maker/config';
import { DecisionMakerAgent } from '@/lib/agents/decision-maker/decision-maker';
import type { SignalContribution } from '@/lib/agents/decision-maker/types';

function strongestContribution(
  contributions: SignalContribution[],
): SignalContribution | null {
  return (
    [...contributions].sort(
      (left, right) =>
        Math.abs(right.weightedScore) - Math.abs(left.weightedScore),
    )[0] ?? null
  );
}

function evidence(contributions: SignalContribution[]): string[] {
  return [
    ...new Set(
      [...contributions]
        .sort(
          (left, right) =>
            Math.abs(right.weightedScore) - Math.abs(left.weightedScore),
        )
        .flatMap((contribution) => contribution.evidence),
    ),
  ];
}

export class TechnicalDecisionAgentAdapter implements DecisionAgentPort {
  readonly agentName = 'technical-decision-maker';
  readonly agentVersion: string;
  readonly timeframe: DecisionAgentConfig['timeframe'];
  private readonly agent: DecisionMakerAgent;

  constructor(
    private readonly config: DecisionAgentConfig = defaultDecisionAgentConfig,
  ) {
    this.agentVersion = config.version;
    this.timeframe = config.timeframe;
    this.agent = new DecisionMakerAgent(config);
  }

  async evaluate(
    request: DecisionEvaluationRequest,
  ): Promise<DecisionAgentMessage> {
    const result = this.agent.evaluateSignal(request.context);
    const messageId = `${this.agentName}:${this.agentVersion}:${request.scan.scanId}:${result.underlying}`;
    const base = {
      schemaVersion: decisionMessageSchemaVersion,
      messageId,
      contextId: result.contextId,
      scanId: request.scan.scanId,
      generatedAt: request.scan.startedAt,
      validUntil: request.scan.validUntil,
      agent: {
        name: this.agentName,
        version: this.agentVersion,
      },
      analysis: {
        symbol: result.underlying,
        marketObservedAt: result.observedAt,
        latestPrice: result.features.latestPrice,
        regime: result.regime,
        signedScore: result.finalScore,
        signalStrength: Math.abs(result.finalScore),
        features: result.features,
        contributions: result.contributions,
        dataQuality: result.dataQuality,
        sentiment: result.sentiment,
      },
    } as const;

    if (!result.eligible || result.direction === 'neutral') {
      return {
        ...base,
        kind: 'no_opportunity',
        reason: result.blockingReason ?? 'neutral_signal',
        explanation:
          result.explanation.length > 0
            ? result.explanation
            : ['The combined technical signal is neutral.'],
      };
    }

    const dominant = strongestContribution(result.contributions);
    return {
      ...base,
      kind: 'opportunity',
      direction: result.direction,
      suggestedAction: result.direction === 'bullish' ? 'buy_call' : 'buy_put',
      thesisType: dominant?.strategy ?? 'trend_following',
      horizon: this.config.horizon,
      explanation: evidence(result.contributions),
    };
  }
}
