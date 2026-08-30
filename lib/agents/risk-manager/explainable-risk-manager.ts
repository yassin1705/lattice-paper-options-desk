import { parseOptionSymbol } from '@/lib/alpaca/option-symbol';
import type { AlpacaReadGateway, OptionContract } from '@/lib/alpaca/types';
import type { OpportunityMessage } from '@/lib/agents/contracts/decision-message';
import type {
  PositionRiskDecision,
  RiskDecision,
  RiskRuleResult,
} from '@/lib/agents/contracts/risk-decision';
import type { ScanDescriptor } from '@/lib/agents/contracts/scan';
import type { RiskManagerPort } from '@/lib/agents/ports';
import {
  buildOptionCandidates,
  selectRiskContract,
} from '@/lib/agents/risk-manager/contract-selector';
import { buildEntryRiskFeatures } from '@/lib/agents/risk-manager/feature-builder';
import type { RiskPolicyProvider } from '@/lib/agents/risk-manager/policy-provider';
import { evaluateEntryRules } from '@/lib/agents/risk-manager/rules/entry-rules';
import type { BaseRiskSnapshot } from '@/lib/agents/risk-manager/types';

function dateOffset(now: Date, days: number): string {
  const value = new Date(now);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function roundPrice(value: number): number {
  return Math.max(0.01, Math.round(value * 100) / 100);
}

function failedRules(rules: RiskRuleResult[]): RiskRuleResult[] {
  return rules.filter((rule) => rule.outcome === 'fail');
}

function exitRule(
  ruleId: string,
  triggered: boolean,
  observedValue: RiskRuleResult['observedValue'],
  configuredLimit: RiskRuleResult['configuredLimit'],
  holdExplanation: string,
  exitExplanation: string,
): RiskRuleResult {
  return {
    ruleId,
    outcome: triggered ? 'fail' : 'pass',
    observedValue,
    configuredLimit,
    explanation: triggered ? exitExplanation : holdExplanation,
  };
}

export class ExplainableRiskManager implements RiskManagerPort {
  private readonly scanSnapshots = new Map<string, Promise<BaseRiskSnapshot>>();
  private readonly latestSignals = new Map<string, OpportunityMessage>();

  constructor(
    private readonly alpaca: AlpacaReadGateway,
    private readonly policyProvider: RiskPolicyProvider,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async assess(
    signal: OpportunityMessage,
    scan: ScanDescriptor,
  ): Promise<RiskDecision> {
    this.latestSignals.set(signal.analysis.symbol, signal);
    const now = this.clock();
    const snapshot = await this.snapshotForScan(scan);
    const policy = snapshot.policySnapshot.policy;
    const features = buildEntryRiskFeatures(signal, snapshot, now);
    const rules = evaluateEntryRules(features, snapshot, policy);
    if (failedRules(rules).length > 0)
      return this.rejection(signal, snapshot, rules, now);

    const type = signal.direction === 'bullish' ? 'call' : 'put';
    const expirationDateGte = dateOffset(
      now,
      policy.contract.minimumDaysToExpiration,
    );
    const expirationDateLte = dateOffset(
      now,
      policy.contract.maximumDaysToExpiration,
    );
    const [contracts, markets] = await Promise.all([
      this.alpaca.getOptionContracts({
        underlyingSymbols: [signal.analysis.symbol],
        status: 'active',
        type,
        expirationDateGte,
        expirationDateLte,
        limit: 1_000,
      }),
      this.alpaca.getOptionChain(signal.analysis.symbol, {
        feed: 'indicative',
        type,
        expirationDateGte,
        expirationDateLte,
        limit: 1_000,
      }),
    ]);
    const selection = selectRiskContract(
      buildOptionCandidates(contracts, markets, now),
      signal,
      policy,
    );
    rules.push(...selection.rules);
    if (!selection.candidate)
      return this.rejection(signal, snapshot, rules, now);

    const candidate = selection.candidate;
    const entryPrice = candidate.market.askPrice ?? candidate.midpoint;
    const multiplier = candidate.contract.multiplier || 100;
    const lossPerContract = entryPrice * multiplier;
    const equity = snapshot.account.equity;
    const tradeBudget =
      equity * (policy.sizing.maximumRiskPerTradePercent / 100);
    const premiumBudget =
      equity * (policy.sizing.maximumOptionPremiumPercent / 100);
    const portfolioLimit =
      equity * (policy.sizing.maximumPortfolioRiskPercent / 100);
    const portfolioRemaining = Math.max(
      0,
      portfolioLimit - features.portfolioPremiumAtRisk,
    );
    const availableBudget = Math.min(
      tradeBudget,
      premiumBudget,
      portfolioRemaining,
      snapshot.account.optionsBuyingPower,
    );
    const quantity = Math.min(
      policy.sizing.maximumContractsPerTrade,
      Math.floor(availableBudget / lossPerContract),
    );
    rules.push({
      ruleId: 'position_size',
      outcome: quantity >= 1 ? 'pass' : 'fail',
      observedValue: quantity,
      configuredLimit: policy.sizing.maximumContractsPerTrade,
      explanation:
        quantity >= 1
          ? 'At least one contract fits all configured risk and buying-power budgets.'
          : 'No contract fits the trade, premium, portfolio, and buying-power budgets.',
    });
    if (quantity < 1) return this.rejection(signal, snapshot, rules, now);

    return {
      kind: 'approved_trade_plan',
      signalId: signal.messageId,
      reviewedAt: now.toISOString(),
      policyRevision: snapshot.policySnapshot.revision,
      plan: {
        contractSymbol: candidate.contract.symbol,
        quantity,
        maximumEntryPrice: roundPrice(entryPrice),
        stopLossPrice: roundPrice(
          entryPrice * (1 - policy.exit.stopLossPercent / 100),
        ),
        takeProfitPrice: roundPrice(
          entryPrice * (1 + policy.exit.takeProfitPercent / 100),
        ),
        maximumLoss: roundPrice(lossPerContract * quantity),
        maximumHoldingMinutes: policy.exit.maximumHoldingMinutes,
      },
      rules,
      explanation: [
        `Approved ${quantity} contract${quantity === 1 ? '' : 's'} within the full-premium loss budget.`,
        policy.requireManualConfirmation
          ? 'Manual confirmation is required before any future execution step.'
          : 'The policy does not require manual confirmation.',
      ],
    };
  }

  async superviseOpenPositions(
    scan: ScanDescriptor,
  ): Promise<PositionRiskDecision[]> {
    const now = this.clock();
    const snapshot = await this.snapshotForScan(scan);
    const positions = snapshot.positions.filter(
      (position) => position.assetClass === 'us_option',
    );
    if (!positions.length) return [];
    const contracts = await Promise.all(
      positions.map((position) =>
        this.alpaca.getOptionContract(position.symbol),
      ),
    );
    const markets = await this.alpaca.getOptionSnapshots(
      positions.map((position) => position.symbol),
      'indicative',
    );
    const contractBySymbol = new Map(
      contracts
        .filter((contract): contract is OptionContract => contract !== null)
        .map((contract) => [contract.symbol, contract]),
    );
    const marketBySymbol = new Map(
      markets.map((market) => [market.symbol, market]),
    );
    return positions.map((position) => {
      const parsed = parseOptionSymbol(position.symbol);
      const contract = contractBySymbol.get(position.symbol);
      const market = marketBySymbol.get(position.symbol);
      const policy = snapshot.policySnapshot.policy;
      const returnPercent = position.averageEntryPrice
        ? ((position.currentPrice - position.averageEntryPrice) /
            position.averageEntryPrice) *
          100
        : 0;
      const daysToExpiration = contract
        ? Math.max(
            0,
            Math.ceil(
              (new Date(`${contract.expirationDate}T20:00:00.000Z`).getTime() -
                now.getTime()) /
                86_400_000,
            ),
          )
        : null;
      const entryAt = snapshot.orders
        .filter(
          (order) =>
            order.symbol === position.symbol &&
            order.side === 'buy' &&
            order.status === 'filled' &&
            order.filledAt,
        )
        .map((order) => new Date(order.filledAt!).getTime())
        .filter(Number.isFinite)
        .sort((left, right) => right - left)[0];
      const holdingMinutes =
        entryAt === undefined
          ? null
          : Math.max(0, (now.getTime() - entryAt) / 60_000);
      const latestSignal = parsed
        ? this.latestSignals.get(parsed.underlying)
        : undefined;
      const expectedDirection = parsed?.type === 'call' ? 'bullish' : 'bearish';
      const oppositeSignal =
        Boolean(latestSignal) &&
        now.getTime() <= new Date(latestSignal!.validUntil).getTime() &&
        latestSignal!.direction !== expectedDirection &&
        policy.exit.exitOnOppositeSignal;
      const accountDailyProfitLossPercent =
        snapshot.account.lastEquity > 0
          ? ((snapshot.account.equity - snapshot.account.lastEquity) /
              snapshot.account.lastEquity) *
            100
          : 0;
      const dailyLossReached =
        accountDailyProfitLossPercent <= -policy.dailyLossLimitPercent;
      const minutesToClose = snapshot.marketClock.nextClose
        ? Math.max(
            0,
            (new Date(snapshot.marketClock.nextClose).getTime() -
              now.getTime()) /
              60_000,
          )
        : null;
      const intradayCloseTriggered =
        policy.holdingHorizon === 'intraday' &&
        policy.exit.closeIntradayPositionsBeforeMarketClose &&
        minutesToClose !== null &&
        minutesToClose <= policy.entry.minutesBeforeCloseToStopEntries;
      const rules: RiskRuleResult[] = [
        exitRule(
          'position_stop_loss',
          returnPercent <= -policy.exit.stopLossPercent,
          returnPercent,
          -policy.exit.stopLossPercent,
          'The position remains above its stop-loss threshold.',
          'The position reached its configured stop-loss threshold.',
        ),
        exitRule(
          'position_take_profit',
          returnPercent >= policy.exit.takeProfitPercent,
          returnPercent,
          policy.exit.takeProfitPercent,
          'The position remains below its take-profit threshold.',
          'The position reached its configured take-profit threshold.',
        ),
        exitRule(
          'expiration_safety',
          daysToExpiration !== null &&
            daysToExpiration <= policy.exit.exitBeforeExpirationDays,
          daysToExpiration,
          policy.exit.exitBeforeExpirationDays,
          'The contract is outside the expiration exit window.',
          'The contract entered the configured expiration exit window.',
        ),
        exitRule(
          'maximum_holding_time',
          holdingMinutes !== null &&
            holdingMinutes >= policy.exit.maximumHoldingMinutes,
          holdingMinutes,
          policy.exit.maximumHoldingMinutes,
          'The maximum holding time has not been reached.',
          'The maximum holding time has been reached.',
        ),
        exitRule(
          'opposite_signal',
          oppositeSignal,
          latestSignal?.direction ?? null,
          expectedDirection,
          'No fresh opposite decision signal is active.',
          'A fresh decision signal opposes the open option position.',
        ),
        exitRule(
          'account_daily_loss',
          dailyLossReached,
          accountDailyProfitLossPercent,
          -policy.dailyLossLimitPercent,
          'The account daily loss limit has not been reached.',
          'The account daily loss limit requires reducing open risk.',
        ),
        exitRule(
          'intraday_market_close',
          intradayCloseTriggered,
          minutesToClose,
          policy.entry.minutesBeforeCloseToStopEntries,
          'The position does not require an intraday market-close exit.',
          'The intraday policy requires closing before the market-close cutoff.',
        ),
      ];
      const triggers = failedRules(rules);
      if (!triggers.length) {
        return {
          kind: 'hold_position' as const,
          contractSymbol: position.symbol,
          reviewedAt: now.toISOString(),
          policyRevision: snapshot.policySnapshot.revision,
          rules,
          reasons: ['No configured exit condition is active.'],
        };
      }
      return {
        kind: 'exit_position' as const,
        contractSymbol: position.symbol,
        quantity: position.availableQuantity,
        reviewedAt: now.toISOString(),
        policyRevision: snapshot.policySnapshot.revision,
        proposedLimitPrice: market?.bidPrice ?? (position.currentPrice || null),
        rules,
        reasons: triggers.map((rule) => rule.explanation),
      };
    });
  }

  private snapshotForScan(scan: ScanDescriptor): Promise<BaseRiskSnapshot> {
    const existing = this.scanSnapshots.get(scan.scanId);
    if (existing) return existing;
    const snapshot = Promise.all([
      this.alpaca.getAccount(),
      this.alpaca.getOpenPositions(),
      this.alpaca.getOrders({
        status: 'all',
        assetClass: 'us_option',
        direction: 'desc',
        limit: 500,
      }),
      this.alpaca.getClock(),
      this.policyProvider.getPolicy(),
    ]).then(([account, positions, orders, marketClock, policySnapshot]) => ({
      observedAt: this.clock().toISOString(),
      account,
      positions,
      orders,
      marketClock,
      policySnapshot,
    }));
    this.scanSnapshots.set(scan.scanId, snapshot);
    if (this.scanSnapshots.size > 4) {
      const oldest = this.scanSnapshots.keys().next().value;
      if (oldest) this.scanSnapshots.delete(oldest);
    }
    return snapshot;
  }

  private rejection(
    signal: OpportunityMessage,
    snapshot: BaseRiskSnapshot,
    rules: RiskRuleResult[],
    now: Date,
  ): RiskDecision {
    return {
      kind: 'rejected_trade',
      signalId: signal.messageId,
      reviewedAt: now.toISOString(),
      policyRevision: snapshot.policySnapshot.revision,
      rules,
      reasons: failedRules(rules).map((rule) => rule.explanation),
    };
  }
}
