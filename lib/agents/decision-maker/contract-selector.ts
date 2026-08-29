import type { DecisionContext } from '@/lib/agents/types';
import type { DecisionAgentConfig } from '@/lib/agents/decision-maker/config';
import type { SelectedContract } from '@/lib/agents/decision-maker/types';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function daysToExpiration(expirationDate: string, observedAt: string): number {
  const expiration = new Date(`${expirationDate}T20:00:00Z`).getTime();
  const observed = new Date(observedAt).getTime();
  if (!Number.isFinite(expiration) || !Number.isFinite(observed)) return -1;
  return Math.max(0, Math.ceil((expiration - observed) / 86_400_000));
}

export function selectContract(
  context: DecisionContext,
  direction: 'bullish' | 'bearish',
  config: DecisionAgentConfig,
  analyzedUnderlyingPrice?: number,
): SelectedContract | null {
  const desiredType = direction === 'bullish' ? 'call' : 'put';
  const underlyingPrice =
    analyzedUnderlyingPrice ??
    context.underlying.latestPrice ??
    context.underlying.bars.at(-1)?.close ??
    0;
  if (underlyingPrice <= 0) return null;

  const candidates = context.optionChain.flatMap(({ contract, market }) => {
    if (
      !contract ||
      contract.status !== 'active' ||
      !contract.tradable ||
      contract.type !== desiredType ||
      new Date(market.observedAt).getTime() > new Date(context.observedAt).getTime() ||
      market.bidPrice === null ||
      market.askPrice === null ||
      market.bidPrice < 0 ||
      market.askPrice <= market.bidPrice
    ) {
      return [];
    }

    const dte = daysToExpiration(contract.expirationDate, context.observedAt);
    const mid = (market.bidPrice + market.askPrice) / 2;
    const spreadPercent = mid > 0 ? ((market.askPrice - market.bidPrice) / mid) * 100 : Infinity;
    const moneynessPercent =
      (Math.abs(contract.strikePrice - underlyingPrice) / underlyingPrice) * 100;
    const volume = market.volume ?? 0;
    const openInterest = market.openInterest ?? contract.openInterest ?? 0;
    const absoluteDelta = market.delta === null ? null : Math.abs(market.delta);
    const rules = config.contractSelection;

    if (
      dte < rules.minimumDaysToExpiration ||
      dte > rules.maximumDaysToExpiration ||
      spreadPercent > rules.maximumSpreadPercent ||
      volume < rules.minimumVolume ||
      openInterest < rules.minimumOpenInterest ||
      moneynessPercent > rules.maximumMoneynessPercent ||
      (absoluteDelta !== null &&
        (absoluteDelta < rules.minimumAbsoluteDelta ||
          absoluteDelta > rules.maximumAbsoluteDelta))
    ) {
      return [];
    }

    const spreadScore = clamp01(1 - spreadPercent / rules.maximumSpreadPercent);
    const dteSpan = Math.max(
      1,
      Math.max(
        rules.targetDaysToExpiration - rules.minimumDaysToExpiration,
        rules.maximumDaysToExpiration - rules.targetDaysToExpiration,
      ),
    );
    const dteScore = clamp01(1 - Math.abs(dte - rules.targetDaysToExpiration) / dteSpan);
    const deltaScore =
      absoluteDelta === null
        ? 0.35
        : clamp01(
            1 -
              Math.abs(absoluteDelta - rules.targetAbsoluteDelta) /
                Math.max(0.01, rules.maximumAbsoluteDelta - rules.minimumAbsoluteDelta),
          );
    const moneynessScore = clamp01(1 - moneynessPercent / rules.maximumMoneynessPercent);
    const liquidityScore = clamp01(
      (Math.log10(volume + 1) + Math.log10(openInterest + 1)) / 6,
    );
    const selectionScore =
      spreadScore * 0.3 +
      deltaScore * 0.25 +
      dteScore * 0.2 +
      liquidityScore * 0.15 +
      moneynessScore * 0.1;

    return [
      {
        contract,
        market,
        daysToExpiration: dte,
        moneynessPercent,
        spreadPercent,
        selectionScore,
        selectionReasons: [
          `${dte} days to expiration.`,
          `${spreadPercent.toFixed(2)}% bid–ask spread.`,
          `Volume ${volume.toLocaleString()} and open interest ${openInterest.toLocaleString()}.`,
          absoluteDelta === null
            ? 'Delta unavailable; candidate received a selection penalty.'
            : `Absolute delta ${absoluteDelta.toFixed(2)}.`,
        ],
      } satisfies SelectedContract,
    ];
  });

  return candidates.sort((left, right) => right.selectionScore - left.selectionScore)[0] ?? null;
}
