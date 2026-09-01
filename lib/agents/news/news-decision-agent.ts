import {
  decisionMessageSchemaVersion,
  type DecisionAgentMessage,
} from '@/lib/agents/contracts/decision-message';
import type { NewsStrategyConfig } from '@/lib/agents/news/config';
import { defaultNewsStrategyConfig } from '@/lib/agents/news/config';
import type {
  NewsAcquisitionResult,
  NewsModelDecision,
  NewsModelPort,
  NewsStockConfig,
  NewsStory,
} from '@/lib/agents/news/types';

function storiesForStock(
  acquisition: NewsAcquisitionResult,
  stock: NewsStockConfig,
): NewsStory[] {
  return acquisition.stories.filter((story) =>
    story.symbols.includes(stock.symbol),
  );
}

function impactEligible(
  impact: NewsModelDecision['impact'],
  minimum: NewsStrategyConfig['minimumImpact'],
): boolean {
  const rank = { low: 0, medium: 1, high: 2 } as const;
  return rank[impact] >= rank[minimum];
}

function horizonLabel(value: NewsModelDecision['horizon']): string {
  return {
    intraday: 'intraday',
    one_day: 'one trading day',
    three_days: 'three trading days',
    long_term: 'long term',
  }[value];
}

export class NewsDecisionAgent {
  readonly agentName = 'news-llm-decision-maker';
  readonly agentVersion = '1.0.0';

  constructor(
    private readonly model: NewsModelPort,
    private readonly config: NewsStrategyConfig = defaultNewsStrategyConfig,
  ) {}

  async evaluate(
    acquisition: NewsAcquisitionResult,
    stocks: NewsStockConfig[],
    runId: string,
    startedAt: string,
    validUntil: string,
  ): Promise<DecisionAgentMessage[]> {
    return Promise.all(
      stocks.map((stock) =>
        this.evaluateStock(acquisition, stock, runId, startedAt, validUntil),
      ),
    );
  }

  async evaluateStock(
    acquisition: NewsAcquisitionResult,
    stock: NewsStockConfig,
    runId: string,
    startedAt: string,
    validUntil: string,
  ): Promise<DecisionAgentMessage> {
    const stories = storiesForStock(acquisition, stock).slice(
      0,
      this.config.limitPerSymbol,
    );
    const latestObservationAt = stories[0]?.publishedAt ?? null;
    const baseIdentity = {
      schemaVersion: decisionMessageSchemaVersion,
      messageId: `${this.agentName}:${this.agentVersion}:${runId}:${stock.symbol}`,
      contextId: `news:${stock.symbol}:${acquisition.collectedAt}`,
      scanId: runId,
      generatedAt: startedAt,
      validUntil,
      agent: { name: this.agentName, version: this.agentVersion },
      strategy: {
        id: 'news_llm' as const,
        frequencyMinutes: this.config.frequencyMinutes,
      },
    };

    if (!stories.length) {
      return {
        ...baseIdentity,
        kind: 'no_opportunity',
        reason: 'insufficient_data',
        analysis: {
          kind: 'news',
          symbol: stock.symbol,
          marketObservedAt: acquisition.collectedAt,
          latestPrice: null,
          signalStrength: 0,
          dataQuality: {
            sufficient: false,
            stale: false,
            observationsReceived: 0,
            observationsRequired: 1,
            latestObservationAt: null,
            warnings: [
              'No relevant news story was collected in the configured window.',
            ],
          },
          relevance: 0,
          impact: 'low',
          horizon: 'intraday',
          eventTypes: [],
          sourceIds: [],
          storyIds: [],
          model: {
            provider: this.model.providerName,
            name: this.model.modelName,
            promptVersion: this.model.promptVersion,
          },
        },
        explanation: [
          'No relevant news was available, so the news strategy remains neutral.',
        ],
      };
    }

    const result = await this.model.analyze({
      stock,
      stories,
      observedAt: acquisition.collectedAt,
    });
    const signalStrength = result.confidence * result.relevance;
    const analysis = {
      kind: 'news' as const,
      symbol: stock.symbol,
      marketObservedAt: latestObservationAt ?? acquisition.collectedAt,
      latestPrice: null,
      signalStrength,
      dataQuality: {
        sufficient: true,
        stale: false,
        observationsReceived: stories.length,
        observationsRequired: 1,
        latestObservationAt,
        warnings: acquisition.sourceReports
          .filter((report) => report.status === 'failed')
          .map((report) => `${report.sourceId}: ${report.error}`),
      },
      relevance: result.relevance,
      impact: result.impact,
      horizon: result.horizon,
      eventTypes: result.eventTypes,
      sourceIds: [...new Set(stories.flatMap((story) => story.sourceIds))],
      storyIds: result.supportingStoryIds,
      model: {
        provider: this.model.providerName,
        name: this.model.modelName,
        promptVersion: this.model.promptVersion,
      },
    };
    const eligible =
      result.direction !== 'neutral' &&
      !result.conflictingEvidence &&
      result.confidence >= this.config.minimumConfidence &&
      result.relevance >= this.config.minimumRelevance &&
      impactEligible(result.impact, this.config.minimumImpact) &&
      result.supportingStoryIds.length > 0;

    if (!eligible) {
      return {
        ...baseIdentity,
        kind: 'no_opportunity',
        reason: result.conflictingEvidence
          ? 'conflicting_signals'
          : 'weak_signal',
        analysis,
        explanation: [result.summary, ...result.risks].filter(Boolean),
      };
    }

    const directionalEvidence =
      result.direction === 'bullish'
        ? result.bullishEvidence
        : result.bearishEvidence;
    const direction = result.direction === 'bullish' ? 'bullish' : 'bearish';
    return {
      ...baseIdentity,
      kind: 'opportunity',
      direction,
      suggestedAction: direction === 'bullish' ? 'buy_call' : 'buy_put',
      thesisType: 'sentiment',
      horizon: horizonLabel(result.horizon),
      analysis,
      explanation: [
        result.summary,
        ...directionalEvidence,
        ...result.risks,
      ].filter(Boolean),
    };
  }
}
