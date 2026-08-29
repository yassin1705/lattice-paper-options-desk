import type {
  MarketRegime,
  SelectedContract,
  SignalContribution,
  ThesisType,
} from '@/lib/agents/decision-maker/types';

export function dominantThesis(contributions: SignalContribution[]): ThesisType {
  const technical = contributions.filter(
    (item): item is SignalContribution & { strategy: ThesisType } => item.strategy !== 'sentiment',
  );
  return [...technical].sort(
    (left, right) => Math.abs(right.weightedScore) - Math.abs(left.weightedScore),
  )[0]?.strategy ?? 'trend_following';
}

export function buildTradeExplanation(
  direction: 'bullish' | 'bearish',
  regime: MarketRegime,
  contributions: SignalContribution[],
  selectedContract: SelectedContract,
): { thesis: string[]; invalidationConditions: string[] } {
  const dominant = [...contributions]
    .filter((item) => item.strategy !== 'sentiment')
    .sort((left, right) => Math.abs(right.weightedScore) - Math.abs(left.weightedScore))[0];
  const thesis = [
    `Market regime classified as ${regime.replaceAll('_', ' ')}.`,
    ...(dominant?.evidence ?? []).slice(0, 3),
    ...selectedContract.selectionReasons.slice(0, 2),
  ];
  const invalidationConditions =
    direction === 'bullish'
      ? [
          'Short SMA crosses below the long SMA.',
          'Momentum becomes negative at the next evaluation.',
          'The option quote becomes stale or exceeds the configured spread limit.',
        ]
      : [
          'Short SMA crosses above the long SMA.',
          'Momentum becomes positive at the next evaluation.',
          'The option quote becomes stale or exceeds the configured spread limit.',
        ];
  return { thesis, invalidationConditions };
}
