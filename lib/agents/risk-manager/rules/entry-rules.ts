import type { RiskRuleResult } from '@/lib/agents/contracts/risk-decision';
import type { RiskPolicy } from '@/lib/agents/risk-manager/policy';
import type {
  BaseRiskSnapshot,
  EntryRiskFeatures,
} from '@/lib/agents/risk-manager/types';

function rule(
  ruleId: string,
  passed: boolean,
  observedValue: RiskRuleResult['observedValue'],
  configuredLimit: RiskRuleResult['configuredLimit'],
  passExplanation: string,
  failExplanation: string,
): RiskRuleResult {
  return {
    ruleId,
    outcome: passed ? 'pass' : 'fail',
    observedValue,
    configuredLimit,
    explanation: passed ? passExplanation : failExplanation,
  };
}

export function evaluateEntryRules(
  features: EntryRiskFeatures,
  snapshot: BaseRiskSnapshot,
  policy: RiskPolicy,
): RiskRuleResult[] {
  const signal = features.signal;
  const marketOpen = snapshot.marketClock.isOpen;
  const accountAvailable =
    !snapshot.account.accountBlocked && !snapshot.account.tradingBlocked;
  const dailyLossAllowed =
    features.dailyProfitLossPercent > -policy.dailyLossLimitPercent;
  const cooldownPassed =
    features.minutesSinceLastEntry === null ||
    features.minutesSinceLastEntry >= policy.entry.cooldownMinutes;
  const cutoffPassed =
    features.minutesToClose === null ||
    features.minutesToClose > policy.entry.minutesBeforeCloseToStopEntries;

  return [
    rule(
      'signal_freshness',
      !features.signalExpired,
      features.now,
      signal.validUntil,
      'The decision signal is still valid.',
      'The decision signal expired before risk review.',
    ),
    rule(
      'approved_underlying',
      policy.approvedUnderlyings.includes(signal.analysis.symbol),
      signal.analysis.symbol,
      policy.approvedUnderlyings.join(', '),
      'The underlying is approved by the user.',
      'The underlying is not in the user-approved watchlist.',
    ),
    rule(
      'allowed_direction',
      policy.entry.allowedDirections.includes(signal.direction),
      signal.direction,
      policy.entry.allowedDirections.join(', '),
      'The signal direction is enabled.',
      'The user policy disables this signal direction.',
    ),
    rule(
      'minimum_signal_strength',
      signal.analysis.signalStrength >= policy.entry.minimumSignalStrength,
      signal.analysis.signalStrength,
      policy.entry.minimumSignalStrength,
      'Signal strength meets the configured minimum.',
      'Signal strength is below the configured minimum.',
    ),
    rule(
      'data_quality',
      signal.analysis.dataQuality.sufficient &&
        !signal.analysis.dataQuality.stale,
      signal.analysis.dataQuality.stale ? 'stale' : 'fresh',
      'fresh and sufficient',
      'The signal uses fresh, sufficient market data.',
      'The signal market data is stale or insufficient.',
    ),
    rule(
      'market_open',
      marketOpen,
      marketOpen,
      true,
      'The market is open.',
      'New entries are disabled while the market is closed.',
    ),
    rule(
      'entry_cutoff',
      cutoffPassed,
      features.minutesToClose,
      policy.entry.minutesBeforeCloseToStopEntries,
      'Enough market time remains for a new entry.',
      'The market is too close to closing for a new entry.',
    ),
    rule(
      'account_available',
      accountAvailable,
      accountAvailable,
      true,
      'The account is available for trading.',
      'Alpaca reports that the account or trading is blocked.',
    ),
    rule(
      'daily_loss_limit',
      dailyLossAllowed,
      features.dailyProfitLossPercent,
      -policy.dailyLossLimitPercent,
      'The daily loss limit has not been reached.',
      'The configured daily loss limit has been reached.',
    ),
    rule(
      'maximum_open_positions',
      features.openOptionPositions.length < policy.entry.maximumOpenPositions,
      features.openOptionPositions.length,
      policy.entry.maximumOpenPositions,
      'The portfolio has room for another option position.',
      'The maximum number of open option positions has been reached.',
    ),
    rule(
      'maximum_symbol_positions',
      features.sameUnderlyingPositions.length <
        policy.entry.maximumPositionsPerSymbol,
      features.sameUnderlyingPositions.length,
      policy.entry.maximumPositionsPerSymbol,
      'The underlying position limit allows another entry.',
      'The maximum number of positions for this underlying has been reached.',
    ),
    rule(
      'pending_symbol_order',
      features.pendingSameUnderlyingOrders.length === 0,
      features.pendingSameUnderlyingOrders.length,
      0,
      'No related option order is pending.',
      'A related option order is already pending.',
    ),
    rule(
      'maximum_daily_trades',
      features.optionTradesToday < policy.entry.maximumTradesPerDay,
      features.optionTradesToday,
      policy.entry.maximumTradesPerDay,
      'The daily trade-count limit allows another entry.',
      'The maximum number of daily entries has been reached.',
    ),
    rule(
      'symbol_cooldown',
      cooldownPassed,
      features.minutesSinceLastEntry,
      policy.entry.cooldownMinutes,
      'The symbol cooldown has passed.',
      'The symbol is still inside its post-entry cooldown.',
    ),
  ];
}
