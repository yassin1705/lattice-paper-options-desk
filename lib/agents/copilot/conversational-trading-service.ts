import { randomUUID } from 'node:crypto';

import type { OpportunityMessage } from '@/lib/agents/contracts/decision-message';
import type { RiskDecision } from '@/lib/agents/contracts/risk-decision';
import type { ScanDescriptor } from '@/lib/agents/contracts/scan';
import { AlpacaMcpClient } from '@/lib/agents/copilot/alpaca-mcp-client';
import {
  QwenConversationAgent,
  type CopilotToolName,
  type CopilotToolResult,
} from '@/lib/agents/copilot/qwen-conversation-agent';
import {
  LocalCopilotStore,
  type CopilotSessionContext,
} from '@/lib/agents/copilot/local-copilot-store';
import { QwenIntentModel } from '@/lib/agents/copilot/qwen-intent-model';
import {
  QwenMarketRankingModel,
  type MarketRankingInput,
} from '@/lib/agents/copilot/qwen-market-ranking-model';
import type {
  CopilotAccountSummary,
  CopilotProposal,
  CopilotResponse,
  MarketScan,
} from '@/lib/agents/copilot/types';
import { LocalSqliteDecisionLedger } from '@/lib/agents/decision-ledger/local-sqlite-decision-ledger';
import { ExecutionManager } from '@/lib/agents/execution/execution-manager';
import {
  defaultNewsStocks,
  defaultNewsStrategyConfig,
} from '@/lib/agents/news/config';
import { NewsDecisionAgent } from '@/lib/agents/news/news-decision-agent';
import { OllamaNewsModel } from '@/lib/agents/news/ollama-news-model';
import { HttpNewsStrategySettingsProvider } from '@/lib/agents/news/settings';
import type { NewsStockConfig, NewsStory } from '@/lib/agents/news/types';
import { ExplainableRiskManager } from '@/lib/agents/risk-manager/explainable-risk-manager';
import { HttpRiskPolicyProvider } from '@/lib/agents/risk-manager/http-policy-provider';
import type { RiskPolicy } from '@/lib/agents/risk-manager/policy';
import { AlpacaCliExecutionGateway } from '@/lib/alpaca/alpaca-cli-execution-gateway';
import { AlpacaHttpReadGateway } from '@/lib/alpaca/alpaca-http-read-gateway';

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : fallback;
}

export function isExplicitTradeConfirmation(message: string): boolean {
  return /^(yes|confirm|execute|place it|do it)(\s+(the\s+)?(trade|proposal))?[.!]?$/i.test(
    message.trim(),
  );
}

function accountSummary(value: unknown): CopilotAccountSummary {
  const account = record(value);
  const level = Number(
    account.options_trading_level ?? account.options_approved_level,
  );
  return {
    status: text(account.status, 'UNKNOWN'),
    equity: number(account.equity ?? account.portfolio_value),
    cash: number(account.cash),
    buyingPower: number(account.buying_power),
    optionsBuyingPower: number(account.options_buying_power),
    optionsTradingLevel: Number.isFinite(level) ? level : null,
    tradingBlocked:
      account.trading_blocked === true || account.account_blocked === true,
  };
}

function stockConfig(symbol: string): NewsStockConfig {
  const configured = defaultNewsStocks.find((stock) => stock.symbol === symbol);
  if (configured) return configured;
  return {
    symbol,
    companyName: symbol,
    aliases: [symbol],
    topics: [],
    officialFeedUrls: [],
    enabled: true,
  };
}

function storiesFromMcp(value: unknown, symbol: string): NewsStory[] {
  const items = record(value).news;
  if (!Array.isArray(items)) return [];
  return items.map((item, index) => {
    const article = record(item);
    const id = text(article.id, `${symbol}-${index}`);
    return {
      storyId: `alpaca:${id}`,
      articleIds: [id],
      sourceIds: ['alpaca'],
      publishers: [text(article.source, 'Alpaca News')],
      symbols: Array.isArray(article.symbols)
        ? article.symbols.map(String).map((value) => value.toUpperCase())
        : [symbol],
      title: text(article.headline),
      summary: text(article.summary),
      content:
        typeof article.content === 'string' && article.content
          ? article.content
          : null,
      url: typeof article.url === 'string' ? article.url : null,
      publishedAt: text(article.created_at, new Date().toISOString()),
    };
  });
}

function capRisk(
  decision: RiskDecision,
  maximumRiskDollars: number,
): RiskDecision {
  if (decision.kind !== 'approved_trade_plan') return decision;
  const lossPerContract = decision.plan.maximumLoss / decision.plan.quantity;
  const quantity = Math.min(
    decision.plan.quantity,
    Math.floor(maximumRiskDollars / lossPerContract),
  );
  if (quantity < 1) {
    return {
      kind: 'rejected_trade',
      signalId: decision.signalId,
      strategyId: decision.strategyId,
      reviewedAt: decision.reviewedAt,
      policyRevision: decision.policyRevision,
      rules: [
        ...decision.rules,
        {
          ruleId: 'user_maximum_loss',
          outcome: 'fail',
          observedValue: lossPerContract,
          configuredLimit: maximumRiskDollars,
          explanation: `One contract can lose up to $${lossPerContract.toFixed(2)}, above the user's $${maximumRiskDollars.toFixed(2)} limit.`,
        },
      ],
      reasons: [
        `No contract fits the requested maximum loss of $${maximumRiskDollars.toFixed(2)}.`,
      ],
    };
  }
  return {
    ...decision,
    plan: {
      ...decision.plan,
      quantity,
      maximumLoss: Math.round(lossPerContract * quantity * 100) / 100,
    },
    rules: [
      ...decision.rules,
      {
        ruleId: 'user_maximum_loss',
        outcome: 'pass',
        observedValue: Math.round(lossPerContract * quantity * 100) / 100,
        configuredLimit: maximumRiskDollars,
        explanation:
          'The proposal stays within the maximum loss supplied in the conversation.',
      },
    ],
  };
}

function response(
  sessionId: string,
  executionAllowed: boolean,
  reply: string,
  state: CopilotResponse['state'],
  proposal: CopilotProposal | null = null,
  mcpTools: string[] = [],
  marketScan: MarketScan | null = null,
): CopilotResponse {
  return {
    sessionId,
    reply,
    state,
    executionAllowed,
    qwenConnected: true,
    mcpConnected: mcpTools.length > 0,
    mcpTools,
    proposal,
    marketScan,
  };
}

export class ConversationalTradingService {
  private readonly mcp = new AlpacaMcpClient();
  private readonly store = new LocalCopilotStore();
  private readonly intentModel = new QwenIntentModel();
  private readonly conversationAgent = new QwenConversationAgent();
  private readonly marketRankingModel = new QwenMarketRankingModel();
  private readonly newsModel = new OllamaNewsModel();
  private readonly decisionLedger = new LocalSqliteDecisionLedger();
  private readonly alpaca: AlpacaHttpReadGateway;
  private readonly risk: ExplainableRiskManager;
  private readonly policyProvider: HttpRiskPolicyProvider;
  private readonly newsSettingsProvider: HttpNewsStrategySettingsProvider;

  constructor() {
    const apiKey = process.env.ALPACA_API_KEY;
    const secretKey = process.env.ALPACA_SECRET_KEY;
    if (!apiKey || !secretKey)
      throw new Error('Alpaca paper credentials are not configured.');
    this.alpaca = new AlpacaHttpReadGateway({
      apiKey,
      secretKey,
      tradingBaseUrl:
        process.env.ALPACA_API_BASE_URL ?? 'https://paper-api.alpaca.markets',
      marketDataBaseUrl:
        process.env.ALPACA_DATA_BASE_URL ?? 'https://data.alpaca.markets',
    });
    const dashboardUrl =
      process.env.LOCAL_DASHBOARD_URL ?? 'http://localhost:3000';
    this.policyProvider = new HttpRiskPolicyProvider(dashboardUrl);
    this.newsSettingsProvider = new HttpNewsStrategySettingsProvider(
      dashboardUrl,
    );
    this.risk = new ExplainableRiskManager(this.alpaca, this.policyProvider);
  }

  async handle(
    rawSessionId: string | undefined,
    message: string,
    executionAllowed: boolean,
  ): Promise<CopilotResponse> {
    const sessionId = rawSessionId?.trim() || randomUUID();
    const context = this.store.getSession(sessionId);
    this.store.saveSession(sessionId, context);
    const history = this.store.recentMessages(sessionId);
    this.store.appendMessage(sessionId, 'user', message);
    const pending = this.store.latestPending(sessionId);
    if (pending && isExplicitTradeConfirmation(message)) {
      const confirmed = await this.confirm(
        sessionId,
        pending,
        executionAllowed,
      );
      this.store.appendMessage(sessionId, 'assistant', confirmed.reply);
      return confirmed;
    }
    const result = await this.conversationAgent.respond(
      history,
      message,
      context,
      (name, argumentsValue) =>
        this.executeConversationTool(
          sessionId,
          message,
          executionAllowed,
          name,
          argumentsValue,
        ),
    );
    const base =
      result.response ??
      response(sessionId, executionAllowed, result.reply, 'ready');
    const finalResponse = {
      ...base,
      sessionId,
      reply: result.reply,
      qwenConnected: true,
    };
    this.store.appendMessage(sessionId, 'assistant', finalResponse.reply);
    return finalResponse;
  }

  private async executeConversationTool(
    sessionId: string,
    rawUserMessage: string,
    executionAllowed: boolean,
    name: CopilotToolName,
    argumentsValue: JsonRecord,
  ): Promise<CopilotToolResult> {
    let result: CopilotResponse;
    if (name === 'get_account_summary') {
      result = await this.handleStructured(
        sessionId,
        'Show the paper account status',
        executionAllowed,
      );
    } else if (name === 'analyze_market') {
      const requested = argumentsValue.symbols;
      if (requested !== undefined && !Array.isArray(requested)) {
        throw new Error('symbols must be an array of ticker symbols.');
      }
      const symbols = requested
        ? await Promise.all(
            requested.slice(0, 12).map((symbol) =>
              this.validateToolSymbol(symbol, rawUserMessage),
            ),
          )
        : [];
      const uniqueSymbols = [...new Set(symbols)];
      result = await this.analyzeMarket(
        sessionId,
        executionAllowed,
        uniqueSymbols.length ? uniqueSymbols : null,
      );
      if (uniqueSymbols.length === 1) {
        const previous = this.store.getSession(sessionId);
        this.store.saveSession(sessionId, {
          ...previous,
          symbol: uniqueSymbols[0],
          tradeRequested: false,
        });
      }
    } else if (name === 'prepare_trade') {
      const previous = this.store.getSession(sessionId);
      const symbol = await this.validateToolSymbol(
        argumentsValue.symbol ?? previous.symbol,
        rawUserMessage,
      );
      const [policySnapshot, rawAccount] = await Promise.all([
        this.policyProvider.getPolicy(),
        this.mcp.call('get_account_info'),
      ]);
      const account = accountSummary(rawAccount);
      const policy = policySnapshot.policy;
      const explicitInstrument = this.explicitInstrument(rawUserMessage);
      const instrument =
        explicitInstrument ??
        previous.instrument ??
        (argumentsValue.instrument === 'option' &&
        /\b(option|call|put)\b/i.test(rawUserMessage)
          ? 'option'
          : 'stock');
      const configuredInvestment =
        instrument === 'option'
          ? Math.min(
              account.optionsBuyingPower || account.buyingPower,
              account.equity *
                (policy.sizing.maximumOptionPremiumPercent / 100),
            )
          : Math.min(
              account.buyingPower,
              account.equity *
                (policy.sizing.maximumRiskPerTradePercent / 100),
            );
      const requestedInvestment = this.optionalPositiveNumber(
        argumentsValue.investmentDollars,
      );
      const suppliedInvestment =
        requestedInvestment &&
        this.conversationSupportsNumber(
          sessionId,
          rawUserMessage,
          requestedInvestment,
          'investment',
        )
          ? requestedInvestment
          : null;
      const investment =
        suppliedInvestment ?? previous.investmentDollars ?? configuredInvestment;
      if (!Number.isFinite(investment) || investment <= 0) {
        throw new Error(
          'The configured account and risk policy do not provide a positive capital allocation.',
        );
      }
      const configuredMaximumLoss = Math.min(
        investment,
        account.equity * (policy.sizing.maximumRiskPerTradePercent / 100),
        instrument === 'option'
          ? account.equity *
              (policy.sizing.maximumOptionPremiumPercent / 100)
          : account.buyingPower,
        instrument === 'option'
          ? account.optionsBuyingPower || account.buyingPower
          : account.buyingPower,
      );
      const requestedMaximumLoss = this.optionalPositiveNumber(
        argumentsValue.maximumRiskDollars,
      );
      const suppliedMaximumLoss =
        requestedMaximumLoss &&
        this.conversationSupportsNumber(
          sessionId,
          rawUserMessage,
          requestedMaximumLoss,
          'risk',
        )
          ? requestedMaximumLoss
          : null;
      const switchingInstrument = previous.instrument !== instrument;
      const maximumLoss =
        suppliedMaximumLoss ??
        (switchingInstrument ? null : previous.maximumRiskDollars) ??
        configuredMaximumLoss;
      const requestedHoldingDays = this.optionalPositiveNumber(
        argumentsValue.holdingDays,
      );
      const suppliedHoldingDays =
        requestedHoldingDays &&
        this.conversationSupportsNumber(
          sessionId,
          rawUserMessage,
          requestedHoldingDays,
          'holding',
        )
          ? requestedHoldingDays
          : null;
      const configuredHoldingDays = Math.max(
        1,
        Math.round(policy.exit.maximumHoldingMinutes / 1_440),
      );
      const holdingDays =
        suppliedHoldingDays ?? previous.holdingDays ?? configuredHoldingDays;
      const explicitDirection = this.explicitTradeDirection(rawUserMessage);
      const directionValue =
        argumentsValue.direction === 'bullish' ||
        argumentsValue.direction === 'bearish'
          ? argumentsValue.direction
          : explicitDirection ?? previous.direction;
      const defaultedFields = new Set(previous.defaultedFields);
      if (suppliedInvestment) defaultedFields.delete('investmentDollars');
      else if (!previous.investmentDollars)
        defaultedFields.add('investmentDollars');
      if (suppliedMaximumLoss)
        defaultedFields.delete('maximumRiskDollars');
      else if (!previous.maximumRiskDollars || switchingInstrument)
        defaultedFields.add('maximumRiskDollars');
      if (suppliedHoldingDays) defaultedFields.delete('holdingDays');
      else if (!previous.holdingDays) defaultedFields.add('holdingDays');
      this.store.saveSession(sessionId, {
        ...previous,
        symbol,
        instrument,
        direction: directionValue,
        investmentDollars: investment,
        maximumRiskDollars: maximumLoss,
        holdingDays: Math.round(holdingDays),
        tradeRequested: true,
        defaultedFields: [...defaultedFields],
      });
      if (instrument === 'stock') {
        result = await this.prepareStockTrade(
          sessionId,
          executionAllowed,
          symbol,
          investment,
          maximumLoss,
          Math.round(holdingDays),
          account,
          policySnapshot.revision,
          policy,
          [...defaultedFields],
        );
      } else {
        const direction = directionValue ? ` ${directionValue}` : '';
        result = await this.handleStructured(
          sessionId,
          `Prepare a${direction} ${symbol} paper option trade with $${investment} capital, maximum acceptable loss $${maximumLoss}, and hold ${Math.round(holdingDays)} days`,
          executionAllowed,
        );
      }
    } else if (name === 'cancel_trade_proposal') {
      result = await this.handleStructured(
        sessionId,
        'cancel',
        executionAllowed,
      );
    } else {
      if (!isExplicitTradeConfirmation(rawUserMessage)) {
        throw new Error(
          'Explicit confirmation is required in the latest user message.',
        );
      }
      result = await this.handleStructured(sessionId, 'yes', executionAllowed);
    }
    return {
      response: result,
      content: {
        state: result.state,
        reply: result.reply,
        marketScan: result.marketScan
          ? {
              observedAt: result.marketScan.observedAt,
              universe: result.marketScan.universe,
              marketSummary: result.marketScan.marketSummary,
              executionThresholdMet: !result.marketScan.noTrade,
              candidates: result.marketScan.candidates,
            }
          : null,
        proposal: result.proposal ?? null,
        executionAllowed: result.executionAllowed,
        mcpTools: result.mcpTools,
      },
    };
  }

  private optionalPositiveNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private conversationSupportsNumber(
    sessionId: string,
    currentMessage: string,
    expected: number,
    kind: 'investment' | 'risk' | 'holding',
  ): boolean {
    const messages = [
      ...this.store
        .recentMessages(sessionId, 20)
        .filter((message) => message.role === 'user')
        .map((message) => message.content),
      currentMessage,
    ];
    return messages.some((message) => {
      const values = message.match(/\d+(?:[.,]\d+)?/g) ?? [];
      const containsExpected = values.some(
        (value) =>
          Math.abs(Number(value.replace(',', '.')) - expected) < 0.000_001,
      );
      if (!containsExpected) return false;
      if (kind === 'risk') {
        return /\b(max(?:imum)?\s*(?:risk|loss)|risk(?:ing)?|acceptable\s+loss|lose)\b/i.test(
          message,
        );
      }
      if (kind === 'holding') return /\b(day|days|week|weeks)\b/i.test(message);
      return /\b(invest|investment|capital|budget|usd|dollars?)\b|\$/i.test(
        message,
      );
    });
  }

  private explicitInstrument(message: string): 'stock' | 'option' | null {
    if (/\b(option|call|put)\b/i.test(message)) return 'option';
    if (/\b(stock|share|shares|fractional)\b/i.test(message)) return 'stock';
    if (/\b(invest|buy|purchase)\b/i.test(message)) return 'stock';
    return null;
  }

  private explicitTradeDirection(
    message: string,
  ): 'bullish' | 'bearish' | null {
    if (/\b(buy|long)\s+(an?\s+)?put\b|\bbearish\b/i.test(message)) {
      return 'bearish';
    }
    if (
      /\b(buy|purchase|long|proceed|go ahead)\b/i.test(message) &&
      !/\b(sell|short)\b/i.test(message)
    ) {
      return 'bullish';
    }
    return null;
  }

  private async validateToolSymbol(
    value: unknown,
    rawUserMessage: string,
  ): Promise<string> {
    const symbol = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) {
      throw new Error('Ask the user for a valid ticker symbol.');
    }
    const [policy, news] = await Promise.all([
      this.policyProvider.getPolicy(),
      this.newsSettingsProvider.getSettings(),
    ]);
    const configured = new Set([
      ...policy.policy.approvedUnderlyings,
      ...news.settings.symbols,
    ]);
    const explicitlyPresent = new RegExp(
      `(?:^|[^A-Z0-9])\\$?${symbol}(?:$|[^A-Z0-9])`,
      'i',
    ).test(rawUserMessage);
    if (!configured.has(symbol) && !explicitlyPresent) {
      throw new Error(
        `Ticker ${symbol} was not explicitly named and is outside the configured universe. Ask the user for the ticker.`,
      );
    }
    return symbol;
  }

  private async handleStructured(
    rawSessionId: string | undefined,
    message: string,
    executionAllowed: boolean,
  ): Promise<CopilotResponse> {
    const sessionId = rawSessionId?.trim() || randomUUID();
    const pending = this.store.latestPending(sessionId);
    const previousContext = this.store.getSession(sessionId);
    const intent = await this.intentModel.interpret(
      message,
      Boolean(pending),
      previousContext.tradeRequested,
    );

    if (intent.action === 'confirm')
      return this.confirm(sessionId, pending, executionAllowed);
    if (intent.action === 'cancel') {
      if (pending) {
        pending.status = 'cancelled';
        this.store.updateProposal(pending);
      }
      this.store.saveSession(sessionId, {
        symbol: null,
        instrument: null,
        direction: null,
        investmentDollars: null,
        maximumRiskDollars: null,
        holdingDays: null,
        tradeRequested: false,
        defaultedFields: [],
      });
      return response(
        sessionId,
        executionAllowed,
        pending
          ? 'The pending paper trade was cancelled.'
          : 'There is no pending trade to cancel.',
        'completed',
      );
    }
    if (intent.action === 'market_scan') {
      return this.analyzeMarket(sessionId, executionAllowed);
    }

    const context: CopilotSessionContext = {
      ...previousContext,
      symbol: intent.symbol ?? previousContext.symbol,
      direction: intent.direction ?? previousContext.direction,
      investmentDollars:
        intent.investmentDollars ?? previousContext.investmentDollars,
      maximumRiskDollars:
        intent.maximumRiskDollars ?? previousContext.maximumRiskDollars,
      holdingDays: intent.holdingDays ?? previousContext.holdingDays,
      tradeRequested:
        intent.action === 'trade'
          ? true
          : intent.action === 'analyze'
            ? false
            : previousContext.tradeRequested,
    };
    this.store.saveSession(sessionId, context);

    if (intent.action === 'help') {
      return response(
        sessionId,
        executionAllowed,
        'Ask me to compare the configured market universe, analyze a named ticker, check the paper account, or prepare a fractional-stock or options paper trade. Example: “Find the best current opportunity,” or “Invest $100 in NVDA stock for one day.”',
        'ready',
      );
    }
    if (intent.action === 'account') {
      const account = accountSummary(await this.mcp.call('get_account_info'));
      return response(
        sessionId,
        executionAllowed,
        `Paper account: ${account.status}; equity $${account.equity.toFixed(2)}; cash $${account.cash.toFixed(2)}; options buying power $${account.optionsBuyingPower.toFixed(2)}.`,
        'completed',
        null,
        ['get_account_info'],
      );
    }
    if (!context.symbol) {
      return response(
        sessionId,
        executionAllowed,
        'Which stock symbol should I analyze?',
        'collecting',
      );
    }

    const tools = [
      'get_account_info',
      'get_clock',
      'get_news',
      'get_stock_snapshot',
    ];
    const [rawAccount, , rawNews, stockSnapshot] = await Promise.all([
      this.mcp.call('get_account_info'),
      this.mcp.call('get_clock'),
      this.mcp.call('get_news', {
        symbols: context.symbol,
        limit: 10,
        include_content: false,
      }),
      this.mcp.call('get_stock_snapshot', {
        symbols: context.symbol,
        feed: 'iex',
      }),
    ]);
    const account = accountSummary(rawAccount);
    const stories = storiesFromMcp(rawNews, context.symbol);
    if (!stories.length) {
      return response(
        sessionId,
        executionAllowed,
        `Alpaca MCP returned no recent ${context.symbol} news, so I will not infer a direction or prepare a trade.`,
        'completed',
        null,
        tools,
      );
    }
    const now = new Date();
    const runId = `copilot:${randomUUID()}`;
    const validUntil = new Date(now.getTime() + 30 * 60_000).toISOString();
    const agent = new NewsDecisionAgent(this.newsModel, {
      ...defaultNewsStrategyConfig,
      minimumConfidence: 0,
      minimumRelevance: 0,
      minimumImpact: 'medium',
    });
    const acquisition = {
      collectedAt: now.toISOString(),
      articlesReceived: stories.length,
      duplicatesRemoved: 0,
      stories,
      sourceReports: [
        {
          sourceId: 'alpaca' as const,
          status: 'available' as const,
          articlesReceived: stories.length,
          error: null,
        },
      ],
    };
    let decision;
    try {
      decision = await agent.evaluateStock(
        acquisition,
        stockConfig(context.symbol),
        runId,
        now.toISOString(),
        validUntil,
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes('news model returned')
      ) {
        throw error;
      }
      decision = await agent.evaluateStock(
        acquisition,
        stockConfig(context.symbol),
        `${runId}:retry`,
        now.toISOString(),
        validUntil,
      );
    }
    const snapshot = record(stockSnapshot)[context.symbol];
    const latestPrice = number(
      record(record(snapshot).latestTrade).p ||
        record(record(snapshot).dailyBar).c,
    );
    const directionText =
      decision.kind === 'opportunity'
        ? `${decision.direction} (${Math.round(decision.analysis.signalStrength * 100)}% evidence score)`
        : 'neutral';
    const analysisReply = `${context.symbol} news reads ${directionText}. ${decision.explanation.join(' ')}${latestPrice ? ` Latest MCP trade: $${latestPrice.toFixed(2)}.` : ''}`;

    if (!context.tradeRequested) {
      return response(
        sessionId,
        executionAllowed,
        `${analysisReply} Ask me to prepare the paper trade if you want an exact option proposal.`,
        'completed',
        null,
        tools,
      );
    }
    const missingTradeDetails = [
      !context.investmentDollars ? 'total capital allocation' : null,
      !context.maximumRiskDollars ? 'maximum acceptable loss' : null,
      !context.holdingDays ? 'intended holding period in days' : null,
    ].filter(Boolean);
    if (missingTradeDetails.length) {
      return response(
        sessionId,
        executionAllowed,
        `${analysisReply} Before I can prepare an option, tell me your ${missingTradeDetails.join(', ')}.`,
        'collecting',
        null,
        tools,
      );
    }
    const userDirectedDecision: OpportunityMessage | null =
      decision.kind === 'opportunity'
        ? decision
        : context.direction
          ? {
              ...decision,
              kind: 'opportunity',
              direction: context.direction,
              suggestedAction:
                context.direction === 'bullish' ? 'buy_call' : 'buy_put',
              thesisType: 'sentiment',
              horizon: `${context.holdingDays}-day user-directed trade`,
              explanation: [
                ...decision.explanation,
                `The ${context.direction} direction was explicitly supplied by the user; the news evidence itself remains neutral.`,
              ],
            }
          : null;
    if (!userDirectedDecision) {
      return response(
        sessionId,
        executionAllowed,
        `${analysisReply} The evidence is not strong enough for an executable proposal.`,
        'completed',
        null,
        tools,
      );
    }
    if (
      decision.kind === 'opportunity' &&
      context.direction &&
      context.direction !== decision.direction
    ) {
      return response(
        sessionId,
        executionAllowed,
        `${analysisReply} This conflicts with your requested ${context.direction} direction, so I will not prepare the order.`,
        'completed',
        null,
        tools,
      );
    }

    const scan: ScanDescriptor = {
      scanId: runId,
      scheduledAt: now.toISOString(),
      startedAt: now.toISOString(),
      validUntil,
      timeframe: '1Hour',
      lookbackBars: 100,
    };
    const riskDecision = capRisk(
      await this.risk.assess(userDirectedDecision, scan, {
        userDirected: decision.kind === 'no_opportunity',
        proposalOnly: true,
      }),
      Math.min(context.maximumRiskDollars!, context.investmentDollars!),
    );
    if (riskDecision.kind !== 'approved_trade_plan') {
      return response(
        sessionId,
        executionAllowed,
        `${analysisReply} Risk manager rejected the trade: ${riskDecision.reasons.join(' ')}`,
        'completed',
        null,
        tools,
      );
    }

    if (pending) {
      pending.status = 'superseded';
      this.store.updateProposal(pending);
    }
    const proposal: CopilotProposal = {
      id: `cp-${randomUUID().slice(0, 8)}`,
      sessionId,
      createdAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() +
          Number(process.env.COPILOT_PROPOSAL_TTL_MINUTES ?? 10) * 60_000,
      ).toISOString(),
      status: 'awaiting_confirmation',
      symbol: context.symbol,
      instrument: 'option',
      direction: userDirectedDecision.direction,
      investmentDollars: context.investmentDollars!,
      maximumRiskDollars: context.maximumRiskDollars!,
      holdingDays: context.holdingDays!,
      summary: analysisReply,
      evidence: userDirectedDecision.explanation,
      risks: riskDecision.rules
        .filter((rule) => rule.outcome === 'warning')
        .map((rule) => rule.explanation),
      account,
      riskDecision,
      stockPlan: null,
      executionProposal: null,
      mcpTools: tools,
    };
    this.store.saveProposal(proposal);
    this.store.saveSession(sessionId, { ...context, tradeRequested: false });
    const plan = riskDecision.plan;
    const publicNote = executionAllowed
      ? ''
      : ' This public demo can analyze and propose, but execution requires localhost.';
    const configuredDefaults = context.defaultedFields
      .map((field) => {
        if (field === 'investmentDollars')
          return `capital allocation $${proposal.investmentDollars.toFixed(2)}`;
        if (field === 'maximumRiskDollars')
          return `maximum accepted loss $${proposal.maximumRiskDollars.toFixed(2)}`;
        return `holding period ${proposal.holdingDays} day${proposal.holdingDays === 1 ? '' : 's'}`;
      })
      .join(', ');
    const defaultsNote = configuredDefaults
      ? ` Configured defaults applied: ${configuredDefaults}.`
      : '';
    const userDirectedNote =
      decision.kind === 'no_opportunity'
        ? ' This is a user-directed speculative trade because the current news evidence is neutral.'
        : '';
    return response(
      sessionId,
      executionAllowed,
      `Proposal ${proposal.id}: buy ${plan.quantity} ${plan.contractSymbol} at no more than $${plan.maximumEntryPrice.toFixed(2)} for an intended ${proposal.holdingDays}-day hold. Capital allocation: $${proposal.investmentDollars.toFixed(2)}; maximum premium loss: $${plan.maximumLoss.toFixed(2)}; stop $${plan.stopLossPrice.toFixed(2)}; target $${plan.takeProfitPrice.toFixed(2)}. Account equity is $${account.equity.toFixed(2)} and options buying power is $${account.optionsBuyingPower.toFixed(2)}.${defaultsNote}${userDirectedNote} This expires in 10 minutes.${publicNote} Are you sure? Reply “yes” to submit this paper order.`,
      'awaiting_confirmation',
      proposal,
      tools,
    );
  }

  private async prepareStockTrade(
    sessionId: string,
    executionAllowed: boolean,
    symbol: string,
    requestedInvestment: number,
    maximumRiskDollars: number,
    holdingDays: number,
    account: CopilotAccountSummary,
    policyRevision: number,
    policy: RiskPolicy,
    defaultedFields: CopilotSessionContext['defaultedFields'],
  ): Promise<CopilotResponse> {
    if (!policy.approvedUnderlyings.includes(symbol)) {
      return response(
        sessionId,
        executionAllowed,
        `${symbol} is not in the configured approved-underlyings list, so I cannot prepare the stock order.`,
        'completed',
      );
    }
    if (account.tradingBlocked || account.status !== 'ACTIVE') {
      return response(
        sessionId,
        executionAllowed,
        'The Alpaca paper account is not currently eligible to trade.',
        'completed',
      );
    }
    const affordableInvestment = Math.min(
      requestedInvestment,
      account.buyingPower,
      account.cash > 0 ? account.cash : account.buyingPower,
    );
    if (affordableInvestment <= 0) {
      return response(
        sessionId,
        executionAllowed,
        'The paper account does not have enough available buying power for this stock proposal.',
        'completed',
      );
    }
    const stopRate = policy.exit.stopLossPercent / 100;
    const riskSizedInvestment = Math.min(
      affordableInvestment,
      maximumRiskDollars / stopRate,
    );
    const [rawClock, rawSnapshot] = await Promise.all([
      this.mcp.call('get_clock'),
      this.mcp.call('get_stock_snapshot', {
        symbols: symbol,
        feed: 'iex',
      }),
    ]);
    const clock = record(rawClock);
    const snapshot = record(record(rawSnapshot)[symbol]);
    const referencePrice = number(
      record(snapshot.latestTrade).p || record(snapshot.dailyBar).c,
    );
    if (referencePrice <= 0) {
      return response(
        sessionId,
        executionAllowed,
        `A current ${symbol} price was not available, so I could not size the fractional-share proposal.`,
        'completed',
        null,
        ['get_account_info', 'get_clock', 'get_stock_snapshot'],
      );
    }
    const limitPrice = Math.round(referencePrice * 1.005 * 100) / 100;
    const quantity =
      Math.floor((riskSizedInvestment / limitPrice) * 1_000_000) / 1_000_000;
    if (quantity <= 0) {
      return response(
        sessionId,
        executionAllowed,
        `The configured allocation is too small to create a fractional ${symbol} order.`,
        'completed',
      );
    }
    const estimatedNotional = Math.round(quantity * limitPrice * 100) / 100;
    const estimatedStopLossDollars =
      Math.round(estimatedNotional * stopRate * 100) / 100;
    const stockPlan = {
      quantity,
      referencePrice,
      limitPrice,
      estimatedNotional,
      stopLossPrice:
        Math.round(referencePrice * (1 - stopRate) * 100) / 100,
      takeProfitPrice:
        Math.round(
          referencePrice * (1 + policy.exit.takeProfitPercent / 100) * 100,
        ) / 100,
      estimatedStopLossDollars,
    };
    const pending = this.store.latestPending(sessionId);
    if (pending) {
      pending.status = 'superseded';
      this.store.updateProposal(pending);
    }
    const now = new Date();
    const proposal: CopilotProposal = {
      id: `cp-${randomUUID().slice(0, 8)}`,
      sessionId,
      createdAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() +
          Number(process.env.COPILOT_PROPOSAL_TTL_MINUTES ?? 10) * 60_000,
      ).toISOString(),
      status: 'awaiting_confirmation',
      symbol,
      instrument: 'stock',
      direction: 'bullish',
      investmentDollars: requestedInvestment,
      maximumRiskDollars,
      holdingDays,
      summary: `User-directed fractional ${symbol} stock purchase.`,
      evidence: [
        'The user selected the symbol and requested a stock investment.',
      ],
      risks: [
        'This user-directed proposal is not an agent recommendation.',
        'A stop price limits planned risk but cannot guarantee the fill price.',
      ],
      account,
      riskDecision: null,
      stockPlan,
      executionProposal: null,
      mcpTools: ['get_account_info', 'get_clock', 'get_stock_snapshot'],
    };
    this.store.saveProposal(proposal);
    const context = this.store.getSession(sessionId);
    this.store.saveSession(sessionId, { ...context, tradeRequested: false });
    const defaults = defaultedFields.length
      ? ` Configured defaults applied: ${defaultedFields.join(', ')}.`
      : '';
    const marketNote =
      clock.is_open === true
        ? ''
        : ` The market is closed, so execution will remain blocked until ${text(clock.next_open, 'the next market session')}.`;
    const publicNote = executionAllowed
      ? ''
      : ' The public demo cannot submit orders; confirmation requires localhost.';
    return response(
      sessionId,
      executionAllowed,
      `Proposal ${proposal.id}: buy approximately ${quantity.toFixed(6)} fractional ${symbol} shares at a limit of $${limitPrice.toFixed(2)}, using about $${estimatedNotional.toFixed(2)}. Planned stop $${stockPlan.stopLossPrice.toFixed(2)} (estimated loss $${estimatedStopLossDollars.toFixed(2)}); target $${stockPlan.takeProfitPrice.toFixed(2)}; intended hold ${holdingDays} day${holdingDays === 1 ? '' : 's'}. Account equity is $${account.equity.toFixed(2)} and stock buying power is $${account.buyingPower.toFixed(2)}.${defaults}${marketNote}${publicNote} Are you sure? Reply “yes” to submit this paper order.`,
      'awaiting_confirmation',
      proposal,
      proposal.mcpTools,
    );
  }

  private async analyzeMarket(
    sessionId: string,
    executionAllowed: boolean,
    requestedSymbols: string[] | null = null,
  ): Promise<CopilotResponse> {
    const [policy, newsSettings] = await Promise.all([
      this.policyProvider.getPolicy(),
      this.newsSettingsProvider.getSettings(),
    ]);
    const configuredUniverse = [
      ...new Set([
        ...newsSettings.settings.symbols,
        ...policy.policy.approvedUnderlyings,
      ]),
    ];
    const universe = (requestedSymbols ?? configuredUniverse).slice(0, 12);
    if (!universe.length) {
      return response(
        sessionId,
        executionAllowed,
        'The configured market universe is empty. Add news stocks or risk-approved underlyings first.',
        'completed',
      );
    }

    const tools = [
      'get_account_info',
      'get_clock',
      'get_news',
      'get_stock_snapshot',
    ];
    const [rawAccount, rawClock, rawNews, rawSnapshots] = await Promise.all([
      this.mcp.call('get_account_info'),
      this.mcp.call('get_clock'),
      this.mcp.call('get_news', {
        symbols: universe.join(','),
        limit: 50,
        include_content: false,
      }),
      this.mcp.call('get_stock_snapshot', {
        symbols: universe.join(','),
        feed: 'iex',
      }),
    ]);
    const account = accountSummary(rawAccount);
    const clock = record(rawClock);
    const snapshots = record(rawSnapshots);
    const decisions = this.decisionLedger.list(250);
    const rankingInput: MarketRankingInput = {
      observedAt: new Date().toISOString(),
      symbols: universe.map((symbol) => {
        const snapshot = record(snapshots[symbol]);
        const daily = record(snapshot.dailyBar);
        const previous = record(snapshot.prevDailyBar);
        const latestPrice = number(record(snapshot.latestTrade).p || daily.c);
        const previousClose = number(previous.c);
        const dailyChangePercent =
          latestPrice && previousClose
            ? ((latestPrice - previousClose) / previousClose) * 100
            : null;
        const seenStrategies = new Set<string>();
        const agentSignals = decisions
          .filter((decision) => decision.symbol === symbol)
          .filter((decision) => {
            if (seenStrategies.has(decision.strategyId)) return false;
            seenStrategies.add(decision.strategyId);
            return true;
          })
          .slice(0, 2)
          .map((decision) => ({
            strategy: decision.strategyId,
            direction: decision.direction,
            confidence: decision.confidence,
            outcome: decision.riskOutcome ?? decision.decisionKind,
            createdAt: decision.createdAt,
          }));
        const headlines = storiesFromMcp(rawNews, symbol)
          .filter((story) => story.symbols.includes(symbol))
          .slice(0, 4)
          .map((story) => ({
            title: story.title,
            summary: story.summary,
            publishedAt: story.publishedAt,
          }));
        return {
          symbol,
          latestPrice: latestPrice || null,
          dailyChangePercent,
          headlines,
          agentSignals,
        };
      }),
    };
    const rankedScan = await this.marketRankingModel.rank(rankingInput);
    const scan: MarketScan =
      rankedScan.noTrade && rankedScan.candidates.length === 0
        ? {
            ...rankedScan,
            candidates: [...rankingInput.symbols]
              .sort((left, right) => {
                const informationScore = (
                  item: (typeof rankingInput.symbols)[number],
                ) =>
                  item.headlines.length * 2 +
                  item.agentSignals.length +
                  Math.min(3, Math.abs(item.dailyChangePercent ?? 0));
                return informationScore(right) - informationScore(left);
              })
              .slice(0, 3)
              .map((item) => ({
                symbol: item.symbol,
                direction: 'neutral' as const,
                confidence: Math.min(
                  0.54,
                  Math.max(
                    0.2,
                    ...item.agentSignals.map((signal) =>
                      signal.confidence === null ? 0 : signal.confidence,
                    ),
                  ),
                ),
                latestPrice: item.latestPrice,
                dailyChangePercent: item.dailyChangePercent,
                rationale: [
                  `${item.headlines.length} recent relevant headline${item.headlines.length === 1 ? '' : 's'} available for review.`,
                  item.agentSignals.length
                    ? `${item.agentSignals.length} recent internal agent signal${item.agentSignals.length === 1 ? '' : 's'} available, without enough agreement for execution.`
                    : 'No recent internal agent agreement is available.',
                ],
                risks: ['Direction remains insufficiently confirmed.'],
              })),
          }
        : rankedScan;
    const marketStatus = clock.is_open === true ? 'open' : 'closed';
    const ranked = scan.candidates
      .map((candidate, index) => {
        const move =
          candidate.dailyChangePercent === null
            ? ''
            : `, daily move ${candidate.dailyChangePercent >= 0 ? '+' : ''}${candidate.dailyChangePercent.toFixed(2)}%`;
        return `${index + 1}. ${candidate.symbol}: ${candidate.direction}, ${Math.round(candidate.confidence * 100)}% confidence${move}. ${candidate.rationale.join(' ')}`;
      })
      .join(' ');
    const focused = universe.length === 1;
    const conclusion = focused
      ? `Decision and explanation: ${ranked}`
      : scan.noTrade
        ? `Nothing currently clears the 55% execution-confidence floor. The strongest watchlist for deeper research is: ${ranked}`
        : `Top comparative opportunities: ${ranked}`;
    const scopeText = focused
      ? `I analyzed ${universe[0]}`
      : `I compared ${universe.join(', ')}`;
    return response(
      sessionId,
      executionAllowed,
      `${scopeText} using fresh Alpaca MCP news and prices plus the latest technical/news agent decisions, with Qwen producing the decision and explanation. The market is ${marketStatus}. ${scan.marketSummary} ${conclusion} Paper equity is $${account.equity.toFixed(2)}. This is research, not an automatic order. To prepare a candidate, name its ticker and trade details.`,
      'completed',
      null,
      tools,
      scan,
    );
  }

  private async confirm(
    sessionId: string,
    proposal: CopilotProposal | null,
    executionAllowed: boolean,
  ): Promise<CopilotResponse> {
    if (!proposal)
      return response(
        sessionId,
        executionAllowed,
        'There is no pending proposal to confirm.',
        'completed',
      );
    if (!executionAllowed)
      return response(
        sessionId,
        false,
        'Confirmation is blocked in the public demo. Open localhost to submit the paper order.',
        'awaiting_confirmation',
        proposal,
        proposal.mcpTools,
      );
    if (new Date(proposal.expiresAt).getTime() <= Date.now()) {
      proposal.status = 'failed';
      this.store.updateProposal(proposal);
      return response(
        sessionId,
        true,
        'That proposal expired. Ask me to analyze it again so prices and account risk can be refreshed.',
        'completed',
        proposal,
      );
    }
    const account = accountSummary(await this.mcp.call('get_account_info'));
    const clock = record(await this.mcp.call('get_clock'));
    const tools = [...proposal.mcpTools];
    if (account.tradingBlocked || account.status !== 'ACTIVE') {
      return response(
        sessionId,
        true,
        'The refreshed paper account is not eligible to trade, so nothing was submitted.',
        'completed',
        proposal,
        tools,
      );
    }
    if (clock.is_open !== true) {
      return response(
        sessionId,
        true,
        `The options market is closed. Nothing was submitted; it next opens at ${text(clock.next_open, 'the next market session')}.`,
        'awaiting_confirmation',
        proposal,
        tools,
      );
    }
    const manager = new ExecutionManager(
      new AlpacaCliExecutionGateway({
        apiKey: process.env.ALPACA_API_KEY!,
        secretKey: process.env.ALPACA_SECRET_KEY!,
        binaryPath: process.env.ALPACA_CLI_PATH ?? 'alpaca',
        expectedAccountId: process.env.ALPACA_ACCOUNT_ID,
      }),
      true,
    );
    if (proposal.instrument === 'stock') {
      const plan = proposal.stockPlan;
      if (!plan) {
        return response(
          sessionId,
          true,
          'The stored stock proposal is incomplete, so nothing was submitted.',
          'completed',
          proposal,
          tools,
        );
      }
      const snapshot = record(
        await this.mcp.call('get_stock_snapshot', {
          symbols: proposal.symbol,
          feed: 'iex',
        }),
      );
      tools.push('get_stock_snapshot');
      const latest = record(record(snapshot)[proposal.symbol]);
      const latestPrice = number(
        record(latest.latestTrade).p || record(latest.dailyBar).c,
      );
      if (!latestPrice || latestPrice > plan.limitPrice) {
        proposal.status = 'failed';
        this.store.updateProposal(proposal);
        return response(
          sessionId,
          true,
          latestPrice
            ? `The refreshed ${proposal.symbol} price is $${latestPrice.toFixed(2)}, above the approved $${plan.limitPrice.toFixed(2)} limit. Nothing was submitted; request a fresh proposal.`
            : `A refreshed ${proposal.symbol} price was unavailable. Nothing was submitted.`,
          'completed',
          proposal,
          tools,
        );
      }
      proposal.executionProposal = await manager.processStockEntry({
        symbol: proposal.symbol,
        quantity: plan.quantity,
        limitPrice: plan.limitPrice,
        sourceReference: proposal.id,
        policyRevision: (await this.policyProvider.getPolicy()).revision,
      });
      proposal.status =
        proposal.executionProposal.status === 'submitted'
          ? 'submitted'
          : 'failed';
      this.store.updateProposal(proposal);
      const execution = proposal.executionProposal;
      return response(
        sessionId,
        true,
        execution.status === 'submitted'
          ? `Fractional ${proposal.symbol} paper order submitted. Alpaca order ${execution.receipt?.alpacaOrderId ?? execution.id} is ${execution.receipt?.status ?? 'accepted'}.`
          : `The paper stock order was not submitted: ${execution.error ?? 'execution failed'}.`,
        'completed',
        proposal,
        tools,
      );
    }
    if (
      !proposal.riskDecision ||
      proposal.riskDecision.kind !== 'approved_trade_plan'
    ) {
      return response(
        sessionId,
        true,
        'The stored proposal is not approved by the risk manager.',
        'completed',
        proposal,
        tools,
      );
    }
    const contract = proposal.riskDecision.plan.contractSymbol;
    const quote = record(
      await this.mcp.call('get_option_latest_quote', {
        symbols: contract,
        feed: 'indicative',
      }),
    );
    tools.push('get_option_latest_quote');
    const quoteData = record(quote)[contract] ?? record(quote).quotes;
    const ask = number(record(quoteData).ask_price ?? record(quoteData).ap);
    if (ask && ask > proposal.riskDecision.plan.maximumEntryPrice) {
      proposal.status = 'failed';
      this.store.updateProposal(proposal);
      return response(
        sessionId,
        true,
        `The refreshed ask is $${ask.toFixed(2)}, above the approved $${proposal.riskDecision.plan.maximumEntryPrice.toFixed(2)} limit. Nothing was submitted; request a fresh proposal.`,
        'completed',
        proposal,
        tools,
      );
    }
    proposal.executionProposal = await manager.processEntry(
      proposal.riskDecision,
    );
    proposal.status =
      proposal.executionProposal?.status === 'submitted'
        ? 'submitted'
        : 'failed';
    this.store.updateProposal(proposal);
    const execution = proposal.executionProposal;
    return response(
      sessionId,
      true,
      execution?.status === 'submitted'
        ? `Paper order submitted. Alpaca order ${execution.receipt?.alpacaOrderId ?? execution.id} is ${execution.receipt?.status ?? 'accepted'}.`
        : `The paper order was not submitted: ${execution?.error ?? 'execution failed'}.`,
      'completed',
      proposal,
      tools,
    );
  }
}

let service: ConversationalTradingService | null = null;

export function getConversationalTradingService(): ConversationalTradingService {
  service ??= new ConversationalTradingService();
  return service;
}
