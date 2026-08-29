import type { DecisionAgentConfig } from '@/lib/agents/decision-maker/config';
import type {
  DataQuality,
  MarketRegime,
  SignalBlockingReason,
  SignalContribution,
  SignalDirection,
  TechnicalFeatureSnapshot,
} from '@/lib/agents/decision-maker/types';

export type ResearchTimeframe = '1Day' | '1Hour' | '15Min';

export type DecisionPeriodRequest = {
  symbol: string;
  start: string;
  end: string;
  timeframe: ResearchTimeframe;
  lookbackBars: number;
  evaluationStepBars: number;
  forwardHorizons: number[];
  feed?: string;
};

export type ForwardOutcome = {
  rawReturn: number;
  signedReturn: number;
  correct: boolean;
};

export type DecisionObservation = {
  evaluationIndex: number;
  asOf: string;
  close: number;
  eligible: boolean;
  direction: SignalDirection;
  blockingReason: SignalBlockingReason | null;
  finalScore: number;
  regime: MarketRegime;
  features: TechnicalFeatureSnapshot;
  dataQuality: DataQuality;
  contributions: SignalContribution[];
  explanation: string[];
  outcomes: Record<string, ForwardOutcome | null>;
};

export type HorizonMetrics = {
  horizonBars: number;
  labeledSignals: number;
  directionalAccuracy: number | null;
  balancedAccuracy: number | null;
  bullishAccuracy: number | null;
  bearishAccuracy: number | null;
  averageSignedReturn: number | null;
  medianSignedReturn: number | null;
  nonOverlappingAccuracy: number | null;
};

export type BacktestSummary = {
  evaluations: number;
  eligibleSignals: number;
  bullishSignals: number;
  bearishSignals: number;
  coverage: number;
  maximumConsecutiveIncorrect: number;
  noTradeReasons: Record<string, number>;
  horizons: HorizonMetrics[];
  regimes: Record<
    string,
    { evaluations: number; eligibleSignals: number; accuracy: number | null }
  >;
  scoreBuckets: Record<
    string,
    { signals: number; accuracy: number | null; averageSignedReturn: number | null }
  >;
};

export type DecisionBacktestReport = {
  generatedAt: string;
  request: DecisionPeriodRequest;
  agentConfig: DecisionAgentConfig;
  summary: BacktestSummary;
  observations: DecisionObservation[];
};
