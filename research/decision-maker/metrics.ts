import type {
  BacktestSummary,
  DecisionObservation,
  HorizonMetrics,
} from '@/research/decision-maker/types';

function average(values: number[]): number | null {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function accuracy(values: boolean[]): number | null {
  return values.length ? values.filter(Boolean).length / values.length : null;
}

function horizonMetrics(
  observations: DecisionObservation[],
  horizon: number,
): HorizonMetrics {
  const key = String(horizon);
  const labeled = observations.filter(
    (observation) => observation.eligible && observation.outcomes[key] !== null,
  );
  const bullish = labeled.filter((observation) => observation.direction === 'bullish');
  const bearish = labeled.filter((observation) => observation.direction === 'bearish');
  const bullishAccuracy = accuracy(
    bullish.map((observation) => observation.outcomes[key]?.correct ?? false),
  );
  const bearishAccuracy = accuracy(
    bearish.map((observation) => observation.outcomes[key]?.correct ?? false),
  );
  const balanced =
    bullishAccuracy !== null && bearishAccuracy !== null
      ? (bullishAccuracy + bearishAccuracy) / 2
      : bullishAccuracy ?? bearishAccuracy;
  const nonOverlapping: DecisionObservation[] = [];
  let nextAllowedIndex = -1;
  for (const observation of labeled) {
    if (observation.evaluationIndex < nextAllowedIndex) continue;
    nonOverlapping.push(observation);
    nextAllowedIndex = observation.evaluationIndex + horizon;
  }

  return {
    horizonBars: horizon,
    labeledSignals: labeled.length,
    directionalAccuracy: accuracy(
      labeled.map((observation) => observation.outcomes[key]?.correct ?? false),
    ),
    balancedAccuracy: balanced,
    bullishAccuracy,
    bearishAccuracy,
    averageSignedReturn: average(
      labeled.flatMap((observation) => {
        const value = observation.outcomes[key]?.signedReturn;
        return value === undefined ? [] : [value];
      }),
    ),
    medianSignedReturn: median(
      labeled.flatMap((observation) => {
        const value = observation.outcomes[key]?.signedReturn;
        return value === undefined ? [] : [value];
      }),
    ),
    nonOverlappingAccuracy: accuracy(
      nonOverlapping.map((observation) => observation.outcomes[key]?.correct ?? false),
    ),
  };
}

function maximumConsecutiveIncorrect(
  observations: DecisionObservation[],
  primaryHorizon: number,
): number {
  let maximum = 0;
  let current = 0;
  const key = String(primaryHorizon);
  for (const observation of observations) {
    const outcome = observation.outcomes[key];
    if (!observation.eligible || !outcome) continue;
    current = outcome.correct ? 0 : current + 1;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}

export function summarizeBacktest(
  observations: DecisionObservation[],
  horizons: number[],
): BacktestSummary {
  const primaryHorizon = horizons.at(-1) ?? 1;
  const primaryKey = String(primaryHorizon);
  const eligible = observations.filter((observation) => observation.eligible);
  const noTradeReasons: Record<string, number> = {};
  for (const observation of observations.filter((item) => !item.eligible)) {
    const reason = observation.blockingReason ?? 'neutral';
    noTradeReasons[reason] = (noTradeReasons[reason] ?? 0) + 1;
  }

  const regimes: BacktestSummary['regimes'] = {};
  for (const observation of observations) {
    const group = (regimes[observation.regime] ??= {
      evaluations: 0,
      eligibleSignals: 0,
      accuracy: null,
    });
    group.evaluations += 1;
    if (observation.eligible) group.eligibleSignals += 1;
  }
  for (const [regime, group] of Object.entries(regimes)) {
    const values = observations
      .filter((item) => item.regime === regime && item.eligible && item.outcomes[primaryKey])
      .map((item) => item.outcomes[primaryKey]?.correct ?? false);
    group.accuracy = accuracy(values);
  }

  const bucketDefinitions = [
    { label: '0.00–0.20', minimum: 0, maximum: 0.2 },
    { label: '0.20–0.30', minimum: 0.2, maximum: 0.3 },
    { label: '0.30–0.40', minimum: 0.3, maximum: 0.4 },
    { label: '0.40–0.55', minimum: 0.4, maximum: 0.55 },
    { label: '0.55+', minimum: 0.55, maximum: Infinity },
  ];
  const scoreBuckets: BacktestSummary['scoreBuckets'] = {};
  for (const bucket of bucketDefinitions) {
    const values = eligible.filter((observation) => {
      const score = Math.abs(observation.finalScore);
      return score >= bucket.minimum && score < bucket.maximum;
    });
    const outcomes = values.flatMap((observation) => {
      const outcome = observation.outcomes[primaryKey];
      return outcome ? [outcome] : [];
    });
    scoreBuckets[bucket.label] = {
      signals: outcomes.length,
      accuracy: accuracy(outcomes.map((outcome) => outcome.correct)),
      averageSignedReturn: average(outcomes.map((outcome) => outcome.signedReturn)),
    };
  }

  return {
    evaluations: observations.length,
    eligibleSignals: eligible.length,
    bullishSignals: eligible.filter((item) => item.direction === 'bullish').length,
    bearishSignals: eligible.filter((item) => item.direction === 'bearish').length,
    coverage: observations.length ? eligible.length / observations.length : 0,
    maximumConsecutiveIncorrect: maximumConsecutiveIncorrect(observations, primaryHorizon),
    noTradeReasons,
    horizons: horizons.map((horizon) => horizonMetrics(observations, horizon)),
    regimes,
    scoreBuckets,
  };
}
