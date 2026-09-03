import type { CopilotIntent } from '@/lib/agents/copilot/types';

type JsonRecord = Record<string, unknown>;

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: {
      type: 'string',
      enum: [
        'market_scan',
        'analyze',
        'trade',
        'account',
        'confirm',
        'cancel',
        'help',
      ],
    },
    symbol: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    direction: {
      anyOf: [
        { type: 'string', enum: ['bullish', 'bearish'] },
        { type: 'null' },
      ],
    },
    maximumRiskDollars: {
      anyOf: [{ type: 'number', minimum: 1 }, { type: 'null' }],
    },
    investmentDollars: {
      anyOf: [{ type: 'number', minimum: 1 }, { type: 'null' }],
    },
    holdingDays: {
      anyOf: [{ type: 'number', minimum: 1 }, { type: 'null' }],
    },
  },
  required: [
    'action',
    'symbol',
    'direction',
    'investmentDollars',
    'maximumRiskDollars',
    'holdingDays',
  ],
} as const;

const companyAliases: Record<string, string[]> = {
  NVDA: ['nvda', 'nvidia'],
  AAPL: ['aapl', 'apple'],
  MSFT: ['msft', 'microsoft'],
  AMZN: ['amzn', 'amazon'],
  META: ['meta', 'facebook'],
  SPY: ['spy', 's&p 500', 's&p500'],
  QQQ: ['qqq', 'nasdaq 100', 'nasdaq-100'],
  GLD: ['gld', 'gold etf', 'spdr gold'],
};

function explicitlyNamedSymbol(message: string): string | null {
  const normalized = message.toLowerCase();
  for (const [symbol, aliases] of Object.entries(companyAliases)) {
    if (aliases.some((alias) => normalized.includes(alias))) return symbol;
  }
  const cashtag = message.match(/\$([a-z]{1,5})\b/i)?.[1]?.toUpperCase();
  if (cashtag) return cashtag;
  const ticker = message.match(/(?:^|\s)([A-Z]{2,5})(?=$|[\s,.?!])/i)?.[1];
  if (!ticker || ticker !== ticker.toUpperCase()) return null;
  const reserved = new Set(['AI', 'LLM', 'MCP', 'USD', 'ETF', 'NEWS']);
  return reserved.has(ticker) ? null : ticker;
}

function broadMarketRequest(message: string): boolean {
  return (
    /\b(market|best (stock|place|trade|option)|where (can|should|could) i (put|invest)|what should i (buy|invest)|opportunit(?:y|ies))\b/i.test(
      message,
    ) && !explicitlyNamedSymbol(message)
  );
}

function explicitlyNamedDirection(
  message: string,
): 'bullish' | 'bearish' | null {
  if (/\b(bullish|buy\s+(a\s+)?call|long\s+call)\b/i.test(message)) {
    return 'bullish';
  }
  if (/\b(bearish|buy\s+(a\s+)?put|long\s+put)\b/i.test(message)) {
    return 'bearish';
  }
  return null;
}

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Qwen returned an invalid response.');
  }
  return value as JsonRecord;
}

export class QwenIntentModel {
  private readonly baseUrl = (
    process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'
  ).replace(/\/$/, '');
  private readonly model = process.env.OLLAMA_MODEL_NAME ?? 'qwen3:8b';

  async interpret(
    message: string,
    hasPendingProposal: boolean,
    awaitingTradeDetails = false,
  ): Promise<CopilotIntent> {
    const normalized = message.trim().toLowerCase();
    if (broadMarketRequest(message)) {
      return {
        action: 'market_scan',
        symbol: null,
        direction: null,
        investmentDollars: null,
        maximumRiskDollars: null,
        holdingDays: null,
      };
    }
    if (
      hasPendingProposal &&
      /^(yes|confirm|execute|place it|do it)(\s+trade)?[.!]?$/i.test(normalized)
    ) {
      return {
        action: 'confirm',
        symbol: null,
        direction: null,
        investmentDollars: null,
        maximumRiskDollars: null,
        holdingDays: null,
      };
    }
    if (/^(no|cancel|stop|never mind|nevermind)[.!]?$/i.test(normalized)) {
      return {
        action: 'cancel',
        symbol: null,
        direction: null,
        investmentDollars: null,
        maximumRiskDollars: null,
        holdingDays: null,
      };
    }
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        think: false,
        format: schema,
        options: { temperature: 0, num_ctx: 4096 },
        messages: [
          {
            role: 'system',
            content: [
              'Extract a user intent for a PAPER options trading assistant.',
              'trade means the user wants an executable proposal; analyze means research or a suggestion only.',
              'market_scan means the user asks for the best opportunity across the market without naming a ticker.',
              'bullish includes calls/buy calls; bearish includes puts/buy puts.',
              'maximumRiskDollars is the maximum premium the user accepts losing, not position value.',
              'investmentDollars is the total capital allocation. holdingDays is the intended number of days.',
              'A bare yes with a pending proposal means confirm. Never invent missing values.',
              'When awaitingTradeDetails is true, a short answer supplying a dollar amount continues the trade request.',
              'Return only schema-valid JSON.',
            ].join(' '),
          },
          {
            role: 'user',
            content: JSON.stringify({
              message,
              hasPendingProposal,
              awaitingTradeDetails,
            }),
          },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Qwen returned HTTP ${response.status}.`);
    const payload = record(await response.json());
    const rawContent = record(payload.message).content;
    if (typeof rawContent !== 'string') {
      throw new Error('Qwen returned an invalid message.');
    }
    const content = rawContent;
    const parsed = record(JSON.parse(content));
    const extractedSymbol =
      typeof parsed.symbol === 'string'
        ? parsed.symbol.trim().toUpperCase()
        : null;
    const namedSymbol = explicitlyNamedSymbol(message);
    const maximumRiskDollars =
      typeof parsed.maximumRiskDollars === 'number' &&
      parsed.maximumRiskDollars > 0
        ? parsed.maximumRiskDollars
        : null;
    return {
      action: parsed.action as CopilotIntent['action'],
      symbol:
        extractedSymbol && namedSymbol === extractedSymbol
          ? extractedSymbol
          : namedSymbol,
      direction: explicitlyNamedDirection(message),
      investmentDollars:
        typeof parsed.investmentDollars === 'number' &&
        parsed.investmentDollars > 0
          ? parsed.investmentDollars
          : null,
      maximumRiskDollars,
      holdingDays:
        typeof parsed.holdingDays === 'number' && parsed.holdingDays > 0
          ? Math.round(parsed.holdingDays)
          : null,
    };
  }
}
