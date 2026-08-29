import { describe, expect, it } from 'vitest';

import { atr } from '@/lib/agents/decision-maker/indicators/atr';
import { ema } from '@/lib/agents/decision-maker/indicators/ema';
import { rsi } from '@/lib/agents/decision-maker/indicators/rsi';
import { sma } from '@/lib/agents/decision-maker/indicators/sma';
import { risingBars } from '@/lib/agents/decision-maker/tests/fixtures';

describe('technical indicators', () => {
  it('calculates the latest simple moving average', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toBe(4);
  });

  it('calculates an exponential moving average from a seeded SMA', () => {
    expect(ema([1, 2, 3, 4, 5], 3)).toBeCloseTo(4, 8);
  });

  it('returns 100 RSI for a continuously rising sequence', () => {
    expect(rsi([1, 2, 3, 4, 5, 6], 3)).toBe(100);
  });

  it('calculates Wilder ATR from valid bars', () => {
    expect(atr(risingBars(20), 14)).toBeGreaterThan(0);
  });
});
