import { describe, expect, it } from 'vitest';

import { isExplicitTradeConfirmation } from '@/lib/agents/copilot/conversational-trading-service';

describe('isExplicitTradeConfirmation', () => {
  it.each(['yes', 'Confirm', 'execute the trade', 'place it.', 'do it']) (
    'accepts an explicit confirmation: %s',
    (message) => {
      expect(isExplicitTradeConfirmation(message)).toBe(true);
    },
  );

  it.each(['maybe', 'yes, but change it', 'analyze NVDA', 'execute later'])(
    'rejects an ambiguous confirmation: %s',
    (message) => {
      expect(isExplicitTradeConfirmation(message)).toBe(false);
    },
  );
});
