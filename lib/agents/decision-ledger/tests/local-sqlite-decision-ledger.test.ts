import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LocalSqliteDecisionLedger } from '@/lib/agents/decision-ledger/local-sqlite-decision-ledger';
import type { NewsSymbolResult } from '@/lib/agents/news/news-strategy-coordinator';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('LocalSqliteDecisionLedger', () => {
  it('stores an agent decision with a useful explanation', () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-ledger-'));
    temporaryDirectories.push(directory);
    const ledger = new LocalSqliteDecisionLedger(
      join(directory, 'decisions.sqlite'),
    );
    const result: NewsSymbolResult = {
      kind: 'no_opportunity',
      symbol: 'NVDA',
      decision: {
        schemaVersion: '1',
        messageId: 'decision:test:nvda',
        contextId: 'context:test:nvda',
        scanId: 'news:test',
        generatedAt: '2026-09-02T12:00:00.000Z',
        validUntil: '2026-09-02T17:00:00.000Z',
        agent: { name: 'news-llm-decision-maker', version: 'test' },
        strategy: { id: 'news_llm', frequencyMinutes: 300 },
        analysis: {
          kind: 'news',
          symbol: 'NVDA',
          marketObservedAt: '2026-09-02T12:00:00.000Z',
          latestPrice: null,
          signalStrength: 0.2,
          dataQuality: {
            sufficient: true,
            stale: false,
            observationsReceived: 2,
            observationsRequired: 1,
            latestObservationAt: '2026-09-02T11:45:00.000Z',
            warnings: [],
          },
          relevance: 0.8,
          impact: 'medium',
          horizon: 'one_day',
          eventTypes: ['product'],
          sourceIds: ['alpaca'],
          storyIds: ['story:test'],
          model: {
            provider: 'ollama',
            name: 'qwen3:8b',
            promptVersion: 'test',
          },
        },
        kind: 'no_opportunity',
        reason: 'neutral_signal',
        explanation: ['Coverage was relevant but direction remained neutral.'],
      },
    };

    expect(ledger.recordResults('news_llm', 'news:test', [result])).toBe(1);
    const records = ledger.list();
    ledger.close();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: 'decision:test:nvda',
      strategyId: 'news_llm',
      symbol: 'NVDA',
      decisionKind: 'no_opportunity',
      confidence: 0.2,
      executionError: null,
      why: 'Coverage was relevant but direction remained neutral.',
    });
  });

  it('migrates an existing ledger and stores an execution error', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-ledger-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'decisions.sqlite');
    const { DatabaseSync } = await import('node:sqlite');
    const oldDatabase = new DatabaseSync(databasePath);
    oldDatabase.exec(`
      CREATE TABLE agent_decisions (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        strategy_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        decision_kind TEXT NOT NULL,
        direction TEXT,
        confidence REAL,
        risk_outcome TEXT,
        execution_status TEXT,
        order_client_id TEXT,
        decision_json TEXT,
        risk_json TEXT,
        why TEXT NOT NULL DEFAULT ''
      );
    `);
    oldDatabase.close();

    const ledger = new LocalSqliteDecisionLedger(databasePath);
    const result: NewsSymbolResult = {
      kind: 'risk_reviewed',
      symbol: 'NVDA',
      decision: {
        schemaVersion: '1',
        messageId: 'decision:test:execution',
        contextId: 'context:test:execution',
        scanId: 'news:test',
        generatedAt: '2026-09-02T12:00:00.000Z',
        validUntil: '2026-09-02T17:00:00.000Z',
        agent: { name: 'news-llm-decision-maker', version: 'test' },
        strategy: { id: 'news_llm', frequencyMinutes: 300 },
        analysis: {
          kind: 'news',
          symbol: 'NVDA',
          marketObservedAt: '2026-09-02T12:00:00.000Z',
          latestPrice: 170,
          signalStrength: 0.9,
          dataQuality: {
            sufficient: true,
            stale: false,
            observationsReceived: 2,
            observationsRequired: 1,
            latestObservationAt: '2026-09-02T11:45:00.000Z',
            warnings: [],
          },
          relevance: 0.9,
          impact: 'high',
          horizon: 'three_days',
          eventTypes: ['guidance'],
          sourceIds: ['alpaca'],
          storyIds: ['story:test'],
          model: {
            provider: 'ollama',
            name: 'qwen3:8b',
            promptVersion: 'test',
          },
        },
        kind: 'opportunity',
        direction: 'bullish',
        suggestedAction: 'buy_call',
        thesisType: 'sentiment',
        horizon: 'three_days',
        explanation: ['Guidance improved materially.'],
      },
      riskDecision: {
        kind: 'approved_trade_plan',
        signalId: 'decision:test:execution',
        strategyId: 'news_llm',
        reviewedAt: '2026-09-02T12:01:00.000Z',
        policyRevision: 1,
        plan: {
          contractSymbol: 'NVDA260918C00170000',
          quantity: 1,
          maximumEntryPrice: 2.1,
          stopLossPrice: 1.58,
          takeProfitPrice: 2.94,
          maximumLoss: 210,
          maximumHoldingMinutes: 1_950,
        },
        rules: [],
        explanation: ['The proposal passed every configured risk rule.'],
      },
      executionProposal: {
        id: 'agent-entry-test',
        source: 'entry',
        sourceReference: 'decision:test:execution',
        policyRevision: 1,
        createdAt: '2026-09-02T12:01:00.000Z',
        status: 'failed',
        order: {
          symbol: 'NVDA260918C00170000',
          quantity: 1,
          side: 'buy',
          positionIntent: 'buy_to_open',
          type: 'limit',
          timeInForce: 'day',
          limitPrice: 2.1,
          clientOrderId: 'agent-entry-test',
        },
        receipt: null,
        error: 'Alpaca CLI returned no JSON output.',
      },
      executionError: null,
    };

    expect(ledger.recordResults('news_llm', 'news:test', [result])).toBe(1);
    expect(ledger.list()[0]).toMatchObject({
      executionStatus: 'failed',
      executionError: 'Alpaca CLI returned no JSON output.',
      why: 'Guidance improved materially. The proposal passed every configured risk rule.',
    });
    ledger.close();
  });
});
