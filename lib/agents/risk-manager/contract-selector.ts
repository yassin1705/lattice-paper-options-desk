import type { OptionContract, OptionMarketSnapshot } from '@/lib/alpaca/types';
import type { OpportunityMessage } from '@/lib/agents/contracts/decision-message';
import type { RiskRuleResult } from '@/lib/agents/contracts/risk-decision';
import type { RiskPolicy } from '@/lib/agents/risk-manager/policy';
import type { OptionCandidate } from '@/lib/agents/risk-manager/types';

function daysToExpiration(expirationDate: string, now: Date): number {
  const expiration = new Date(`${expirationDate}T20:00:00.000Z`).getTime();
  return Math.max(0, Math.ceil((expiration - now.getTime()) / 86_400_000));
}

export function buildOptionCandidates(
  contracts: OptionContract[],
  markets: OptionMarketSnapshot[],
  now: Date,
): OptionCandidate[] {
  const marketBySymbol = new Map(
    markets.map((market) => [market.symbol, market]),
  );
  return contracts.flatMap((contract) => {
    const market = marketBySymbol.get(contract.symbol);
    const bid = market?.bidPrice;
    const ask = market?.askPrice;
    const delta = market?.delta;
    if (
      !market ||
      bid == null ||
      ask == null ||
      delta == null ||
      bid <= 0 ||
      ask < bid
    )
      return [];
    const midpoint = (bid + ask) / 2;
    return [
      {
        contract,
        market,
        daysToExpiration: daysToExpiration(contract.expirationDate, now),
        absoluteDelta: Math.abs(delta),
        midpoint,
        spreadPercent: midpoint > 0 ? ((ask - bid) / midpoint) * 100 : Infinity,
        volume: market.volume ?? 0,
        openInterest: market.openInterest ?? contract.openInterest ?? 0,
      },
    ];
  });
}

function passedRule(
  ruleId: string,
  observedValue: number | string,
  configuredLimit: number | string,
  explanation: string,
): RiskRuleResult {
  return {
    ruleId,
    outcome: 'pass',
    observedValue,
    configuredLimit,
    explanation,
  };
}

export function selectRiskContract(
  candidates: OptionCandidate[],
  signal: OpportunityMessage,
  policy: RiskPolicy,
  maximumLossPerContract = Infinity,
): { candidate: OptionCandidate | null; rules: RiskRuleResult[] } {
  const requiredType = signal.direction === 'bullish' ? 'call' : 'put';
  const eligible = candidates.filter(
    (candidate) =>
      candidate.contract.type === requiredType &&
      candidate.contract.tradable &&
      candidate.daysToExpiration >= policy.contract.minimumDaysToExpiration &&
      candidate.daysToExpiration <= policy.contract.maximumDaysToExpiration &&
      candidate.absoluteDelta >= policy.contract.minimumDelta &&
      candidate.absoluteDelta <= policy.contract.maximumDelta &&
      candidate.spreadPercent <= policy.contract.maximumSpreadPercent &&
      candidate.volume >= policy.contract.minimumVolume &&
      candidate.openInterest >= policy.contract.minimumOpenInterest &&
      (candidate.market.askPrice ?? candidate.midpoint) *
        (candidate.contract.multiplier || 100) <=
        maximumLossPerContract,
  );
  const selected = [...eligible].sort((left, right) => {
    const leftScore =
      Math.abs(left.absoluteDelta - policy.contract.targetDelta) +
      left.spreadPercent / 100;
    const rightScore =
      Math.abs(right.absoluteDelta - policy.contract.targetDelta) +
      right.spreadPercent / 100;
    return leftScore - rightScore;
  })[0];
  if (!selected) {
    return {
      candidate: null,
      rules: [
        {
          ruleId: 'liquid_contract_available',
          outcome: 'fail',
          observedValue: eligible.length,
          configuredLimit: 'at least 1',
          explanation:
            'No option contract passed type, tradability, expiration, delta, spread, volume, open-interest, and affordability limits.',
        },
      ],
    };
  }

  return {
    candidate: selected,
    rules: [
      passedRule(
        'contract_type',
        selected.contract.type,
        requiredType,
        'The contract matches the signal direction.',
      ),
      passedRule(
        'days_to_expiration',
        selected.daysToExpiration,
        `${policy.contract.minimumDaysToExpiration}–${policy.contract.maximumDaysToExpiration}`,
        'Days to expiration are inside the configured range.',
      ),
      passedRule(
        'contract_delta',
        selected.absoluteDelta,
        `${policy.contract.minimumDelta}–${policy.contract.maximumDelta}`,
        'Absolute delta is inside the configured range.',
      ),
      passedRule(
        'contract_spread',
        selected.spreadPercent,
        policy.contract.maximumSpreadPercent,
        'The bid/ask spread is within the configured maximum.',
      ),
      passedRule(
        'contract_volume',
        selected.volume,
        policy.contract.minimumVolume,
        'Contract volume meets the configured minimum.',
      ),
      passedRule(
        'contract_open_interest',
        selected.openInterest,
        policy.contract.minimumOpenInterest,
        'Open interest meets the configured minimum.',
      ),
      passedRule(
        'contract_affordability',
        (selected.market.askPrice ?? selected.midpoint) *
          (selected.contract.multiplier || 100),
        maximumLossPerContract,
        'One contract fits the configured trade, premium, portfolio, and buying-power budgets.',
      ),
    ],
  };
}
