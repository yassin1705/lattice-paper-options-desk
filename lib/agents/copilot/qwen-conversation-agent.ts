import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CopilotResponse } from '@/lib/agents/copilot/types';
import type {
  CopilotSessionContext,
  StoredCopilotMessage,
} from '@/lib/agents/copilot/local-copilot-store';

type JsonRecord = Record<string, unknown>;

export type CopilotToolName =
  | 'get_account_summary'
  | 'analyze_market'
  | 'prepare_trade'
  | 'cancel_trade_proposal'
  | 'confirm_paper_trade';

export type CopilotToolResult = {
  content: unknown;
  response?: CopilotResponse;
};

export type CopilotToolExecutor = (
  name: CopilotToolName,
  argumentsValue: JsonRecord,
) => Promise<CopilotToolResult>;

type OllamaMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_name?: string;
  tool_calls?: Array<{
    function?: { name?: string; arguments?: JsonRecord };
  }>;
};

const tools = [
  {
    type: 'function',
    function: {
      name: 'get_account_summary',
      description:
        'Read the current Alpaca paper account equity, cash, buying power, status, and options permissions.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_market',
      description:
        'Analyze stocks with fresh news and prices plus recent technical/news agent signals, using Qwen for the decision and explanation. Omit symbols to analyze and rank the full configured universe; pass one or more symbols for focused analysis.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          symbols: {
            type: 'array',
            items: { type: 'string' },
            maxItems: 12,
            description:
              'Optional explicit tickers such as ["NVDA"] or ["NVDA", "AAPL"]. Omit for the full configured universe.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'prepare_trade',
      description:
        'Start or continue a paper trade draft for fractional stock or options. Default to stock for ordinary buy/invest requests; use option only when the user explicitly requests an option, call, or put. Supply only values grounded in the conversation. Omitted values come from the saved draft or configured risk defaults. This never submits an order.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          symbol: { type: 'string' },
          instrument: {
            type: 'string',
            enum: ['stock', 'option'],
          },
          investmentDollars: { type: 'number', minimum: 1 },
          maximumRiskDollars: { type: 'number', minimum: 1 },
          holdingDays: { type: 'integer', minimum: 1, maximum: 365 },
          direction: {
            type: ['string', 'null'],
            enum: ['bullish', 'bearish', null],
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_trade_proposal',
      description: 'Cancel the current pending paper-trade proposal.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'confirm_paper_trade',
      description:
        'Confirm the current pending paper proposal. The backend independently requires explicit confirmation and performs final safety checks.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
] as const;

const authoritativeTradeTools = new Set<CopilotToolName>([
  'prepare_trade',
  'cancel_trade_proposal',
  'confirm_paper_trade',
]);

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function skillInstructions(): string {
  return readFileSync(
    join(process.cwd(), 'skills', 'trading-assistant', 'SKILL.md'),
    'utf8',
  );
}

function naturalize(reply: string): string {
  return reply
    .replace(
      /no trade currently clears the 55% execution-confidence floor/gi,
      'nothing currently clears the 55% execution-confidence floor',
    )
    .replace(/\bno trade\b/gi, 'nothing currently qualifies for execution');
}

export class QwenConversationAgent {
  private readonly baseUrl = (
    process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'
  ).replace(/\/$/, '');
  private readonly model = process.env.OLLAMA_MODEL_NAME ?? 'qwen3:8b';
  private readonly instructions = skillInstructions();

  async respond(
    history: StoredCopilotMessage[],
    userMessage: string,
    context: CopilotSessionContext,
    execute: CopilotToolExecutor,
  ): Promise<{ reply: string; response?: CopilotResponse }> {
    const messages: OllamaMessage[] = [
      { role: 'system', content: this.instructions },
      {
        role: 'system',
        content: [
          'Authoritative saved trade draft:',
          JSON.stringify(context),
          'When tradeRequested is true, or the user says buy, invest, proceed, prepare, place, or execute for the saved/explicit symbol, call prepare_trade with the new details. Continue the draft; do not call analyze_market again unless the user explicitly asks to refresh the analysis. Ordinary buy/invest language means fractional stock; choose option only when the user explicitly says option, call, or put. A plain buy instruction is bullish. Never copy an investment amount into maximumRiskDollars unless the user explicitly describes that number as maximum risk or acceptable loss.',
        ].join(' '),
      },
      ...history.map((message) => ({ ...message })),
      { role: 'user', content: userMessage },
    ];
    let latestResponse: CopilotResponse | undefined;
    let callsMade = 0;

    for (let round = 0; round < 4; round += 1) {
      const message = await this.complete(messages);
      const calls = message.tool_calls ?? [];
      if (!calls.length) {
        const reply = naturalize(message.content.trim());
        return {
          reply:
            reply ||
            'I could not form a reliable response. Could you rephrase that?',
          response: latestResponse,
        };
      }
      messages.push(message);
      for (const call of calls) {
        callsMade += 1;
        if (callsMade > 6) {
          messages.push({
            role: 'tool',
            tool_name: call.function?.name,
            content: JSON.stringify({
              error:
                'Tool-call limit reached. Ask the user to narrow the request.',
            }),
          });
          continue;
        }
        const name = call.function?.name;
        if (!name || !tools.some((tool) => tool.function.name === name)) {
          messages.push({
            role: 'tool',
            tool_name: name,
            content: JSON.stringify({ error: 'Unknown tool.' }),
          });
          continue;
        }
        try {
          const result = await execute(
            name as CopilotToolName,
            record(call.function?.arguments),
          );
          latestResponse = result.response ?? latestResponse;
          if (
            result.response &&
            authoritativeTradeTools.has(name as CopilotToolName)
          ) {
            return {
              reply: result.response.reply,
              response: result.response,
            };
          }
          messages.push({
            role: 'tool',
            tool_name: name,
            content: JSON.stringify(result.content).slice(0, 24_000),
          });
        } catch (error) {
          messages.push({
            role: 'tool',
            tool_name: name,
            content: JSON.stringify({
              error: error instanceof Error ? error.message : 'Tool failed.',
            }),
          });
        }
      }
    }
    return {
      reply:
        latestResponse?.reply ??
        'I reached the analysis limit for this message. Please narrow the request.',
      response: latestResponse,
    };
  }

  private async complete(messages: OllamaMessage[]): Promise<OllamaMessage> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Number(process.env.OLLAMA_TIMEOUT_MS ?? 300_000),
    );
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          think: false,
          options: { temperature: 0.2, num_ctx: 8_192 },
          tools,
          messages,
        }),
      });
      if (!response.ok)
        throw new Error(`Qwen returned HTTP ${response.status}.`);
      const payload = record(await response.json());
      const rawMessage = record(payload.message);
      return {
        role: 'assistant',
        content:
          typeof rawMessage.content === 'string' ? rawMessage.content : '',
        tool_calls: Array.isArray(rawMessage.tool_calls)
          ? (rawMessage.tool_calls as OllamaMessage['tool_calls'])
          : undefined,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
