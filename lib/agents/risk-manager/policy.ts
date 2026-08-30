export type RiskProfile = 'conservative' | 'moderate' | 'experimental';
export type HoldingHorizon = 'intraday' | 'swing' | 'position';

export type RiskPolicy = {
  schemaVersion: '1';
  profile: RiskProfile;
  approvedUnderlyings: string[];
  holdingHorizon: HoldingHorizon;
  dailyLossLimitPercent: number;
  requireManualConfirmation: boolean;
  entry: {
    minimumSignalStrength: number;
    allowedDirections: Array<'bullish' | 'bearish'>;
    maximumTradesPerDay: number;
    maximumOpenPositions: number;
    maximumPositionsPerSymbol: number;
    cooldownMinutes: number;
    minutesBeforeCloseToStopEntries: number;
  };
  sizing: {
    maximumRiskPerTradePercent: number;
    maximumPortfolioRiskPercent: number;
    maximumOptionPremiumPercent: number;
    maximumContractsPerTrade: number;
  };
  contract: {
    minimumDaysToExpiration: number;
    maximumDaysToExpiration: number;
    targetDelta: number;
    minimumDelta: number;
    maximumDelta: number;
    maximumSpreadPercent: number;
    minimumVolume: number;
    minimumOpenInterest: number;
  };
  exit: {
    stopLossPercent: number;
    takeProfitPercent: number;
    maximumHoldingMinutes: number;
    exitBeforeExpirationDays: number;
    exitOnOppositeSignal: boolean;
    closeIntradayPositionsBeforeMarketClose: boolean;
  };
};

export type RiskPolicySnapshot = {
  revision: number;
  updatedAt: string;
  policy: RiskPolicy;
};

export const defaultRiskPolicy: RiskPolicy = {
  schemaVersion: '1',
  profile: 'conservative',
  approvedUnderlyings: ['SPY', 'QQQ', 'GLD'],
  holdingHorizon: 'swing',
  dailyLossLimitPercent: 0.75,
  requireManualConfirmation: true,
  entry: {
    minimumSignalStrength: 0.4,
    allowedDirections: ['bullish', 'bearish'],
    maximumTradesPerDay: 3,
    maximumOpenPositions: 3,
    maximumPositionsPerSymbol: 1,
    cooldownMinutes: 240,
    minutesBeforeCloseToStopEntries: 45,
  },
  sizing: {
    maximumRiskPerTradePercent: 0.25,
    maximumPortfolioRiskPercent: 2,
    maximumOptionPremiumPercent: 0.5,
    maximumContractsPerTrade: 3,
  },
  contract: {
    minimumDaysToExpiration: 7,
    maximumDaysToExpiration: 45,
    targetDelta: 0.5,
    minimumDelta: 0.25,
    maximumDelta: 0.7,
    maximumSpreadPercent: 12,
    minimumVolume: 10,
    minimumOpenInterest: 100,
  },
  exit: {
    stopLossPercent: 25,
    takeProfitPercent: 40,
    maximumHoldingMinutes: 1_950,
    exitBeforeExpirationDays: 3,
    exitOnOppositeSignal: true,
    closeIntradayPositionsBeforeMarketClose: false,
  },
};

function finiteNumber(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}

function wholeNumber(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const number = finiteNumber(value, name, minimum, maximum);
  if (!Number.isInteger(number))
    throw new Error(`${name} must be a whole number.`);
  return number;
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function validateRiskPolicy(value: unknown): RiskPolicy {
  const policy = object(value, 'Risk policy');
  const entry = object(policy.entry, 'Entry policy');
  const sizing = object(policy.sizing, 'Sizing policy');
  const contract = object(policy.contract, 'Contract policy');
  const exit = object(policy.exit, 'Exit policy');
  const profile = policy.profile;
  if (!['conservative', 'moderate', 'experimental'].includes(String(profile))) {
    throw new Error('Risk profile is invalid.');
  }
  const holdingHorizon = policy.holdingHorizon;
  if (!['intraday', 'swing', 'position'].includes(String(holdingHorizon))) {
    throw new Error('Holding horizon is invalid.');
  }
  if (!Array.isArray(policy.approvedUnderlyings)) {
    throw new Error('Approved underlyings must be a list.');
  }
  const approvedUnderlyings = [
    ...new Set(
      policy.approvedUnderlyings
        .filter((symbol): symbol is string => typeof symbol === 'string')
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  if (!approvedUnderlyings.length)
    throw new Error('At least one underlying must be approved.');
  if (!Array.isArray(entry.allowedDirections)) {
    throw new Error('Allowed directions must be a list.');
  }
  const allowedDirections = entry.allowedDirections.filter(
    (direction): direction is 'bullish' | 'bearish' =>
      direction === 'bullish' || direction === 'bearish',
  );
  if (!allowedDirections.length)
    throw new Error('At least one direction must be allowed.');

  const minimumDaysToExpiration = wholeNumber(
    contract.minimumDaysToExpiration,
    'Minimum days to expiration',
    1,
    365,
  );
  const maximumDaysToExpiration = wholeNumber(
    contract.maximumDaysToExpiration,
    'Maximum days to expiration',
    minimumDaysToExpiration,
    730,
  );
  const minimumDelta = finiteNumber(
    contract.minimumDelta,
    'Minimum delta',
    0.01,
    0.99,
  );
  const maximumDelta = finiteNumber(
    contract.maximumDelta,
    'Maximum delta',
    minimumDelta,
    0.99,
  );

  return {
    schemaVersion: '1',
    profile: profile as RiskProfile,
    approvedUnderlyings,
    holdingHorizon: holdingHorizon as HoldingHorizon,
    dailyLossLimitPercent: finiteNumber(
      policy.dailyLossLimitPercent,
      'Daily loss limit',
      0.01,
      100,
    ),
    requireManualConfirmation: Boolean(policy.requireManualConfirmation),
    entry: {
      minimumSignalStrength: finiteNumber(
        entry.minimumSignalStrength,
        'Minimum signal strength',
        0,
        1,
      ),
      allowedDirections: [...new Set(allowedDirections)],
      maximumTradesPerDay: wholeNumber(
        entry.maximumTradesPerDay,
        'Maximum daily trades',
        1,
        100,
      ),
      maximumOpenPositions: wholeNumber(
        entry.maximumOpenPositions,
        'Maximum open positions',
        1,
        100,
      ),
      maximumPositionsPerSymbol: wholeNumber(
        entry.maximumPositionsPerSymbol,
        'Maximum positions per symbol',
        1,
        20,
      ),
      cooldownMinutes: wholeNumber(
        entry.cooldownMinutes,
        'Cooldown',
        0,
        43_200,
      ),
      minutesBeforeCloseToStopEntries: wholeNumber(
        entry.minutesBeforeCloseToStopEntries,
        'Entry cutoff',
        0,
        1_440,
      ),
    },
    sizing: {
      maximumRiskPerTradePercent: finiteNumber(
        sizing.maximumRiskPerTradePercent,
        'Maximum trade risk',
        0.01,
        100,
      ),
      maximumPortfolioRiskPercent: finiteNumber(
        sizing.maximumPortfolioRiskPercent,
        'Maximum portfolio risk',
        0.01,
        100,
      ),
      maximumOptionPremiumPercent: finiteNumber(
        sizing.maximumOptionPremiumPercent,
        'Maximum option premium',
        0.01,
        100,
      ),
      maximumContractsPerTrade: wholeNumber(
        sizing.maximumContractsPerTrade,
        'Maximum contracts',
        1,
        10_000,
      ),
    },
    contract: {
      minimumDaysToExpiration,
      maximumDaysToExpiration,
      targetDelta: finiteNumber(
        contract.targetDelta,
        'Target delta',
        minimumDelta,
        maximumDelta,
      ),
      minimumDelta,
      maximumDelta,
      maximumSpreadPercent: finiteNumber(
        contract.maximumSpreadPercent,
        'Maximum spread',
        0.01,
        100,
      ),
      minimumVolume: wholeNumber(
        contract.minimumVolume,
        'Minimum volume',
        0,
        10_000_000,
      ),
      minimumOpenInterest: wholeNumber(
        contract.minimumOpenInterest,
        'Minimum open interest',
        0,
        100_000_000,
      ),
    },
    exit: {
      stopLossPercent: finiteNumber(
        exit.stopLossPercent,
        'Stop loss',
        0.01,
        100,
      ),
      takeProfitPercent: finiteNumber(
        exit.takeProfitPercent,
        'Take profit',
        0.01,
        10_000,
      ),
      maximumHoldingMinutes: wholeNumber(
        exit.maximumHoldingMinutes,
        'Maximum holding time',
        1,
        525_600,
      ),
      exitBeforeExpirationDays: wholeNumber(
        exit.exitBeforeExpirationDays,
        'Expiration exit window',
        0,
        maximumDaysToExpiration,
      ),
      exitOnOppositeSignal: Boolean(exit.exitOnOppositeSignal),
      closeIntradayPositionsBeforeMarketClose: Boolean(
        exit.closeIntradayPositionsBeforeMarketClose,
      ),
    },
  };
}
