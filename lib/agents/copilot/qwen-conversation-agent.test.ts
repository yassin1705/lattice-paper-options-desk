import { afterEach, describe, expect, it, vi } from 'vitest';

import { QwenConversationAgent } from '@/lib/agents/copilot/qwen-conversation-agent';
import type { CopilotResponse } from '@/lib/agents/copilot/types';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('QwenConversationAgent', () => {
  it('returns the backend response unchanged after preparing a trade', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              function: {
                name: 'prepare_trade',
                arguments: {
                  symbol: 'NVDA',
                  instrument: 'stock',
                  investmentDollars: 20,
                },
              },
            },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    const authoritative: CopilotResponse = {
      sessionId: 'session-1',
      reply: 'The proposal is ready. Reply “yes” to confirm.',
      state: 'awaiting_confirmation',
      executionAllowed: true,
      qwenConnected: true,
      mcpConnected: false,
      mcpTools: [],
      proposal: null,
      marketScan: null,
    };

    const result = await new QwenConversationAgent().respond(
      [],
      'Invest $20 in NVDA stock',
      {
        symbol: null,
        instrument: null,
        direction: null,
        investmentDollars: null,
        maximumRiskDollars: null,
        holdingDays: null,
        tradeRequested: false,
        defaultedFields: [],
      },
      vi.fn(async () => ({
        response: authoritative,
        content: { state: 'awaiting_confirmation' },
      })),
    );

    expect(result).toEqual({
      reply: authoritative.reply,
      response: authoritative,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
