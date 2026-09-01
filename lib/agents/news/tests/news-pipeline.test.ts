import { describe, expect, it, vi } from 'vitest';

import {
  defaultNewsStocks,
  defaultNewsStrategyConfig,
} from '@/lib/agents/news/config';
import { NewsAcquisitionService } from '@/lib/agents/news/news-acquisition-service';
import { NewsDecisionAgent } from '@/lib/agents/news/news-decision-agent';
import { OllamaNewsModel } from '@/lib/agents/news/ollama-news-model';
import type {
  NewsArticle,
  NewsModelPort,
  NewsSourcePort,
} from '@/lib/agents/news/types';

const NOW = '2026-09-01T12:00:00.000Z';
const stock = defaultNewsStocks[0]!;

function article(
  sourceId: NewsArticle['sourceId'],
  articleId: string,
): NewsArticle {
  return {
    articleId,
    sourceId,
    publisher: sourceId,
    symbols: ['NVDA'],
    title: 'NVIDIA raises its data-center revenue guidance',
    summary: 'Management reported stronger demand for data-center products.',
    content: null,
    url: 'https://example.com/nvda-guidance?utm_source=test',
    publishedAt: '2026-09-01T11:00:00.000Z',
    updatedAt: null,
  };
}

describe('NewsAcquisitionService', () => {
  it('isolates a failed source and merges duplicate coverage', async () => {
    const sources: NewsSourcePort[] = [
      {
        sourceId: 'alpaca',
        async fetch() {
          return [article('alpaca', 'alpaca:1')];
        },
      },
      {
        sourceId: 'finnhub',
        async fetch() {
          return [article('finnhub', 'finnhub:2')];
        },
      },
      {
        sourceId: 'gdelt',
        async fetch() {
          throw new Error('temporary outage');
        },
      },
    ];
    const service = new NewsAcquisitionService(sources, () => new Date(NOW));
    const result = await service.collect({
      stocks: [stock],
      from: '2026-09-01T00:00:00.000Z',
      to: NOW,
      limitPerSymbol: 10,
    });

    expect(result.articlesReceived).toBe(2);
    expect(result.duplicatesRemoved).toBe(1);
    expect(result.stories).toHaveLength(1);
    expect(result.stories[0]?.sourceIds).toEqual(['alpaca', 'finnhub']);
    expect(result.sourceReports).toContainEqual(
      expect.objectContaining({ sourceId: 'gdelt', status: 'failed' }),
    );
  });
});

describe('OllamaNewsModel', () => {
  it('requests schema-constrained output and validates story references', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        message: {
          content: JSON.stringify({
            symbol: 'NVDA',
            direction: 'bullish',
            confidence: 0.82,
            relevance: 0.96,
            impact: 'high',
            horizon: 'one_day',
            eventTypes: ['guidance'],
            summary: 'Guidance improved on stronger demand.',
            bullishEvidence: ['Management raised guidance.'],
            bearishEvidence: [],
            risks: ['The news may already be priced in.'],
            conflictingEvidence: false,
            supportingStoryIds: ['story:one'],
          }),
        },
      }),
    );
    const model = new OllamaNewsModel({ fetcher, modelName: 'qwen3:8b' });
    const result = await model.analyze({
      stock,
      observedAt: NOW,
      stories: [
        {
          storyId: 'story:one',
          articleIds: ['alpaca:1'],
          sourceIds: ['alpaca'],
          publishers: ['Alpaca'],
          symbols: ['NVDA'],
          title: 'NVIDIA raises guidance',
          summary: 'Demand is stronger.',
          content: null,
          url: 'https://example.com/story',
          publishedAt: '2026-09-01T11:00:00.000Z',
        },
      ],
    });

    expect(result.direction).toBe('bullish');
    const request = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(request.model).toBe('qwen3:8b');
    expect(request.think).toBe(false);
    expect(request.format.type).toBe('object');
  });
});

describe('NewsDecisionAgent', () => {
  it('publishes an independently attributed opportunity for a strong result', async () => {
    const model: NewsModelPort = {
      providerName: 'test',
      modelName: 'fixture',
      promptVersion: 'v1',
      async analyze() {
        return {
          symbol: 'NVDA',
          direction: 'bullish',
          confidence: 0.9,
          relevance: 0.9,
          impact: 'high',
          horizon: 'one_day',
          eventTypes: ['earnings'],
          summary: 'The event is materially positive.',
          bullishEvidence: ['Revenue guidance increased.'],
          bearishEvidence: [],
          risks: [],
          conflictingEvidence: false,
          supportingStoryIds: ['story:one'],
        };
      },
    };
    const decisionAgent = new NewsDecisionAgent(
      model,
      defaultNewsStrategyConfig,
    );
    const decision = await decisionAgent.evaluateStock(
      {
        collectedAt: NOW,
        articlesReceived: 1,
        duplicatesRemoved: 0,
        sourceReports: [
          {
            sourceId: 'alpaca',
            status: 'available',
            articlesReceived: 1,
            error: null,
          },
        ],
        stories: [
          {
            storyId: 'story:one',
            articleIds: ['alpaca:1'],
            sourceIds: ['alpaca'],
            publishers: ['Alpaca'],
            symbols: ['NVDA'],
            title: 'NVIDIA raises guidance',
            summary: 'Demand is stronger.',
            content: null,
            url: 'https://example.com/story',
            publishedAt: '2026-09-01T11:00:00.000Z',
          },
        ],
      },
      stock,
      'news:test',
      NOW,
      '2026-09-01T17:00:00.000Z',
    );

    expect(decision.kind).toBe('opportunity');
    expect(decision.strategy.id).toBe('news_llm');
    expect(decision.analysis.kind).toBe('news');
    expect(decision.analysis.signalStrength).toBeCloseTo(0.81);
  });
});
