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

  evaluate(
    context: DecisionContext,
    sentiment: SentimentSignal = unavailableSentiment,
  ): DecisionResult {
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

    if (!dataQuality.sufficient) {
      return noTrade(analysis, 'insufficient_data', dataQuality.warnings);
    }
    if (dataQuality.stale) {
      return noTrade(analysis, 'stale_data', dataQuality.warnings);
    }
    if (score.conflicting) {
      return noTrade(analysis, 'conflicting_signals', [
        'Bullish and bearish strategy contributions are too close to distinguish.',
      ]);
    }
    if (Math.abs(score.finalScore) < this.config.thresholds.tradeScore) {
      return noTrade(analysis, 'weak_signal', [
        `Absolute signal score ${Math.abs(score.finalScore).toFixed(3)} is below the ${this.config.thresholds.tradeScore.toFixed(3)} threshold.`,
      ]);
    }

    const direction = score.finalScore > 0 ? 'bullish' : 'bearish';
    const selectedContract = selectContract(
      context,
      direction,
      this.config,
      features.latestPrice,
    );
    if (!selectedContract) {
      return noTrade(analysis, 'no_liquid_contract', [
        'No contract passed expiration, spread, liquidity, delta, and moneyness filters.',
      ]);
    }

    const explanation = buildTradeExplanation(
      direction,
      regime,
      score.contributions,
      selectedContract,
    );
    return {
      ...analysis,
      kind: 'trade_intent',
      id: `decision:${stableHash(`${context.contextId}:${this.config.version}:${selectedContract.contract.symbol}`)}`,
      action: direction === 'bullish' ? 'buy_call' : 'buy_put',
      contractSymbol: selectedContract.contract.symbol,
      thesisType: dominantThesis(score.contributions),
      horizon: this.config.horizon,
      signalStrength: Math.abs(score.finalScore),
      thesis: explanation.thesis,
      invalidationConditions: explanation.invalidationConditions,
      selectedContract,
    };
  }
}

export * from '@/lib/agents/decision-maker/config';
export * from '@/lib/agents/decision-maker/types';
