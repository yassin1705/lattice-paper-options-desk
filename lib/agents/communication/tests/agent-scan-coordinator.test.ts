import { describe, expect, it } from 'vitest';

import type { MarketBar } from '@/lib/alpaca/types';
import type { DecisionContext } from '@/lib/agents/types';
import { AgentScanCoordinator } from '@/lib/agents/communication/agent-scan-coordinator';
import type { ScanScheduleConfig } from '@/lib/agents/contracts/scan';
import { decisionAgentConfigForTimeframe } from '@/lib/agents/decision-maker/config';
import { TechnicalDecisionAgentAdapter } from '@/lib/agents/decision-maker/technical-decision-agent-adapter';
import {
  decisionContext,
  risingBars,
} from '@/lib/agents/decision-maker/tests/fixtures';
import type {
  DecisionContextSource,
  RiskManagerPort,
} from '@/lib/agents/ports';

const schedule: ScanScheduleConfig = {
  timeframe: '1Hour',
  lookbackBars: 100,
  frequencyMinutes: 60,
  delayAfterIntervalMinutes: 2,
  maximumLatenessMinutes: 5,
  signalTtlMinutes: 55,
};

function contextFor(symbol: string, bars: MarketBar[]): DecisionContext {
  const base = decisionContext({
    bars: bars.map((bar) => ({ ...bar, symbol })),
  });
  return {
    ...base,
    contextId: `decision:${symbol}:fixture`,
    underlying: {
      ...base.underlying,
      symbol,
      bars: base.underlying.bars.map((bar) => ({ ...bar, symbol })),
    },
    optionChain: [],
  };
}

describe('TechnicalDecisionAgentAdapter', () => {
  it('publishes a versioned opportunity without account or sizing information', async () => {
    const agent = new TechnicalDecisionAgentAdapter(
      decisionAgentConfigForTimeframe('1Hour'),
    );
    const message = await agent.evaluate({
      context: contextFor('SPY', risingBars()),
      scan: {
        scanId: 'scan:1Hour:2026-08-29T21:02:00.000Z',
        scheduledAt: '2026-08-29T21:02:00.000Z',
        startedAt: '2026-08-29T21:02:30.000Z',
        validUntil: '2026-08-29T21:57:00.000Z',
        timeframe: '1Hour',
        lookbackBars: 100,
      },
    });

    expect(message.kind).toBe('opportunity');
    expect(message.schemaVersion).toBe('1');
    expect(message.analysis.symbol).toBe('SPY');
    expect(message.analysis.contributions.length).toBeGreaterThanOrEqual(3);
    expect(message).not.toHaveProperty('account');
    expect(message).not.toHaveProperty('balance');
    expect(message).not.toHaveProperty('quantity');
    expect(message).not.toHaveProperty('contractSymbol');
  });
});

describe('AgentScanCoordinator', () => {
  it('scans each symbol once and sends only opportunities to risk review', async () => {
    const contextSource: DecisionContextSource = {
      async getDecisionContext({ symbol }) {
        return contextFor(
          symbol,
          symbol === 'SPY' ? risingBars() : risingBars(10),
        );
      },
    };
    const reviewedSignals: string[] = [];
    const riskManager: RiskManagerPort = {
      async assess(signal) {
        reviewedSignals.push(signal.messageId);
        return {
          kind: 'rejected_trade',
          signalId: signal.messageId,
          reviewedAt: '2026-08-29T21:02:31.000Z',
          reasons: ['Risk rules are not implemented yet.'],
        };
      },
    };
    const coordinator = new AgentScanCoordinator(
      {
        contextSource,
        decisionAgent: new TechnicalDecisionAgentAdapter(
          decisionAgentConfigForTimeframe('1Hour'),
        ),
        riskManager,
      },
      schedule,
    );

    const first = await coordinator.runDueScan(
      ['spy', ' QQQ ', 'SPY'],
      new Date('2026-08-29T21:02:30.000Z'),
    );
    expect(first.kind).toBe('completed');
    if (first.kind !== 'completed') return;
    expect(first.results).toHaveLength(2);
    expect(first.results.map((result) => result.kind)).toEqual([
      'risk_reviewed',
      'no_opportunity',
    ]);
    expect(reviewedSignals).toHaveLength(1);
    expect(first.scan.validUntil).toBe('2026-08-29T21:57:00.000Z');

    const duplicate = await coordinator.runDueScan(
      ['SPY'],
      new Date('2026-08-29T21:04:00.000Z'),
    );
    expect(duplicate.kind).toBe('already_scanned');
    expect(reviewedSignals).toHaveLength(1);
  });

  it('does not run after the configured scan window', async () => {
    const coordinator = new AgentScanCoordinator(
      {
        contextSource: {
          async getDecisionContext() {
            return contextFor('SPY', risingBars());
          },
        },
        decisionAgent: new TechnicalDecisionAgentAdapter(
          decisionAgentConfigForTimeframe('1Hour'),
        ),
        riskManager: {
          async assess(signal) {
            return {
              kind: 'rejected_trade',
              signalId: signal.messageId,
              reviewedAt: '2026-08-29T21:10:00.000Z',
              reasons: [],
            };
          },
        },
      },
      schedule,
    );

    const result = await coordinator.runDueScan(
      ['SPY'],
      new Date('2026-08-29T21:10:00.000Z'),
    );
    expect(result).toEqual({
      kind: 'not_due',
      nextScanAt: '2026-08-29T22:02:00.000Z',
    });
  });

  it('rejects an agent configured for a different timeframe', () => {
    expect(
      () =>
        new AgentScanCoordinator(
          {
            contextSource: {
              async getDecisionContext() {
                return contextFor('SPY', risingBars());
              },
            },
            decisionAgent: new TechnicalDecisionAgentAdapter(),
            riskManager: {
              async assess(signal) {
                return {
                  kind: 'rejected_trade',
                  signalId: signal.messageId,
                  reviewedAt: '2026-08-29T21:02:00.000Z',
                  reasons: [],
                };
              },
            },
          },
          schedule,
        ),
    ).toThrow(
      'Decision agent timeframe 1Day does not match scan timeframe 1Hour.',
    );
  });
});
