import { describe, expect, it } from 'vitest';

import { DecisionMakerAgent } from '@/lib/agents/decision-maker/decision-maker';
import { computeFeatures } from '@/lib/agents/decision-maker/feature-engine';
import { defaultDecisionAgentConfig } from '@/lib/agents/decision-maker/config';
import {
  decisionContext,
  fallingBars,
  risingBars,
} from '@/lib/agents/decision-maker/tests/fixtures';

describe('DecisionMakerAgent', () => {
  it('produces an explainable bullish call intent for a strong rising fixture', () => {
    const result = new DecisionMakerAgent().evaluate(decisionContext());
    expect(result.kind).toBe('trade_intent');
    if (result.kind !== 'trade_intent') return;
    expect(result.action).toBe('buy_call');
    expect(result.contractSymbol).toContain('C');
    expect(result.contributions.length).toBeGreaterThanOrEqual(3);
    expect(result.thesis.length).toBeGreaterThan(0);
    expect(result).not.toHaveProperty('quantity');
    expect(result).not.toHaveProperty('buyingPower');
  });

  it('returns no trade when history is insufficient', () => {
    const result = new DecisionMakerAgent().evaluate(
      decisionContext({ bars: risingBars(10) }),
    );
    expect(result.kind).toBe('no_trade');
    if (result.kind === 'no_trade') expect(result.reason).toBe('insufficient_data');
  });

  it('produces a bearish put intent for a strong falling fixture', () => {
    const result = new DecisionMakerAgent().evaluate(
      decisionContext({ bars: fallingBars() }),
    );
    expect(result.kind).toBe('trade_intent');
    if (result.kind !== 'trade_intent') return;
    expect(result.action).toBe('buy_put');
    expect(result.contractSymbol).toContain('P');
  });

  it('rejects a contract with an excessive spread', () => {
    const result = new DecisionMakerAgent().evaluate(decisionContext({ callSpread: 1 }));
    expect(result.kind).toBe('no_trade');
    if (result.kind === 'no_trade') expect(result.reason).toBe('no_liquid_contract');
  });

  it('is deterministic for identical input', () => {
    const context = decisionContext();
    const agent = new DecisionMakerAgent();
    expect(agent.evaluate(context)).toEqual(agent.evaluate(context));
  });

  it('ignores bars after the context observation time', () => {
    const context = decisionContext();
    const futureBars = [
      ...context.underlying.bars,
      {
        ...context.underlying.bars.at(-1)!,
        timestamp: '2026-09-01T20:00:00.000Z',
        close: 1,
      },
    ];
    const baseline = computeFeatures(context, defaultDecisionAgentConfig);
    const withFuture = computeFeatures(
      decisionContext({ bars: futureBars }),
      defaultDecisionAgentConfig,
    );
    expect(withFuture.features).toEqual(baseline.features);
  });
});
