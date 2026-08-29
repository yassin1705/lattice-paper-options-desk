import type { DecisionContext } from '@/lib/agents/types';
import {
  defaultDecisionAgentConfig,
  type DecisionAgentConfig,
} from '@/lib/agents/decision-maker/config';
import { selectContract } from '@/lib/agents/decision-maker/contract-selector';
import { buildTradeExplanation, dominantThesis } from '@/lib/agents/decision-maker/explanation-builder';
import { computeFeatures } from '@/lib/agents/decision-maker/feature-engine';
import { classifyMarketRegime } from '@/lib/agents/decision-maker/market-regime';
import { combineSignals } from '@/lib/agents/decision-maker/signal-scorer';
import { unavailableSentiment } from '@/lib/agents/decision-maker/sentiment/sentiment-provider';
import { breakoutSignal } from '@/lib/agents/decision-maker/strategies/breakout';
import { meanReversionSignal } from '@/lib/agents/decision-maker/strategies/mean-reversion';
import { trendFollowingSignal } from '@/lib/agents/decision-maker/strategies/trend-following';
import type {
  DecisionAnalysis,
  DecisionResult,
  NoTradeIntent,
  NoTradeReason,
  SentimentSignal,
  SignalEvaluation,
} from '@/lib/agents/decision-maker/types';

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function noTrade(
  analysis: DecisionAnalysis,
  reason: NoTradeReason,
  explanation: string[],
): NoTradeIntent {
  return {
    ...analysis,
    kind: 'no_trade',
    id: `decision:${stableHash(`${analysis.contextId}:${analysis.configVersion}:${reason}`)}`,
    reason,
    explanation,
  };
}

export class DecisionMakerAgent {
  constructor(private readonly config: DecisionAgentConfig = defaultDecisionAgentConfig) {}

  evaluateSignal(
    context: DecisionContext,
    sentiment: SentimentSignal = unavailableSentiment,
  ): SignalEvaluation {
    const { features, dataQuality } = computeFeatures(context, this.config);
    const regime = classifyMarketRegime(features, this.config);
    const technicalContributions = [
      trendFollowingSignal(features, regime, this.config),
      meanReversionSignal(features, regime, this.config),
      breakoutSignal(features, this.config),
    ];
    const score = combineSignals(technicalContributions, sentiment, this.config);
    const analysis: DecisionAnalysis = {
      configVersion: this.config.version,
      contextId: context.contextId,
      observedAt: context.observedAt,
      underlying: context.underlying.symbol,
      regime,
      features,
      dataQuality,
      contributions: score.contributions,
      finalScore: score.finalScore,
      sentiment,
    };

    const blockingReason = !dataQuality.sufficient
      ? 'insufficient_data'
      : dataQuality.stale
        ? 'stale_data'
        : score.conflicting
          ? 'conflicting_signals'
          : Math.abs(score.finalScore) < this.config.thresholds.tradeScore
            ? 'weak_signal'
            : null;
    const explanation =
      blockingReason === 'insufficient_data' || blockingReason === 'stale_data'
        ? dataQuality.warnings
        : blockingReason === 'conflicting_signals'
          ? ['Bullish and bearish strategy contributions are too close to distinguish.']
          : blockingReason === 'weak_signal'
            ? [
                `Absolute signal score ${Math.abs(score.finalScore).toFixed(3)} is below the ${this.config.thresholds.tradeScore.toFixed(3)} threshold.`,
              ]
            : [];

    return {
      ...analysis,
      kind: 'signal_evaluation',
      eligible: blockingReason === null,
      direction:
        score.finalScore > 0.05 ? 'bullish' : score.finalScore < -0.05 ? 'bearish' : 'neutral',
      blockingReason,
      explanation,
    };
  }

  evaluate(
    context: DecisionContext,
    sentiment: SentimentSignal = unavailableSentiment,
  ): DecisionResult {
    const signal = this.evaluateSignal(context, sentiment);
    const {
      kind: _kind,
      eligible,
      direction,
      blockingReason,
      explanation: signalExplanation,
      ...analysis
    } = signal;
    if (!eligible || direction === 'neutral') {
      return noTrade(
        analysis,
        blockingReason ?? 'weak_signal',
        signalExplanation.length ? signalExplanation : ['The combined signal is neutral.'],
      );
    }

    const selectedContract = selectContract(
      context,
      direction,
      this.config,
      analysis.features.latestPrice,
    );
    if (!selectedContract) {
      return noTrade(analysis, 'no_liquid_contract', [
        'No contract passed expiration, spread, liquidity, delta, and moneyness filters.',
      ]);
    }

    const explanation = buildTradeExplanation(
      direction,
      analysis.regime,
      analysis.contributions,
      selectedContract,
    );
    return {
      ...analysis,
      kind: 'trade_intent',
      id: `decision:${stableHash(`${context.contextId}:${this.config.version}:${selectedContract.contract.symbol}`)}`,
      action: direction === 'bullish' ? 'buy_call' : 'buy_put',
      contractSymbol: selectedContract.contract.symbol,
      thesisType: dominantThesis(analysis.contributions),
      horizon: this.config.horizon,
      signalStrength: Math.abs(analysis.finalScore),
      thesis: explanation.thesis,
      invalidationConditions: explanation.invalidationConditions,
      selectedContract,
    };
  }
}

export * from '@/lib/agents/decision-maker/config';
export * from '@/lib/agents/decision-maker/types';
