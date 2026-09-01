import type {
  MarketRegime,
  SentimentSignal,
  SignalBlockingReason,
  SignalContribution,
  SignalDirection,
  TechnicalFeatureSnapshot,
  ThesisType,
} from '@/lib/agents/decision-maker/types';

export const decisionMessageSchemaVersion = '1' as const;

export type DecisionDataQuality = {
  sufficient: boolean;
  stale: boolean;
  observationsReceived: number;
  observationsRequired: number;
  latestObservationAt: string | null;
  warnings: string[];
};

export type DecisionMessageAnalysisBase = {
  symbol: string;
  marketObservedAt: string;
  latestPrice: number | null;
  signalStrength: number;
  dataQuality: DecisionDataQuality;
};

export type TechnicalDecisionMessageAnalysis = DecisionMessageAnalysisBase & {
  kind: 'technical';
  regime: MarketRegime;
  signedScore: number;
  features: TechnicalFeatureSnapshot;
  contributions: SignalContribution[];
  sentiment: SentimentSignal;
};

export type NewsDecisionMessageAnalysis = DecisionMessageAnalysisBase & {
  kind: 'news';
  relevance: number;
  impact: 'low' | 'medium' | 'high';
  horizon: 'intraday' | 'one_day' | 'three_days' | 'long_term';
  eventTypes: string[];
  sourceIds: string[];
  storyIds: string[];
  model: {
    provider: string;
    name: string;
    promptVersion: string;
  };
};

export type DecisionMessageAnalysis =
  | TechnicalDecisionMessageAnalysis
  | NewsDecisionMessageAnalysis;

type DecisionMessageBase = {
  schemaVersion: typeof decisionMessageSchemaVersion;
  messageId: string;
  contextId: string;
  scanId: string;
  generatedAt: string;
  validUntil: string;
  agent: {
    name: string;
    version: string;
  };
  strategy: {
    id: 'technical' | 'news_llm';
    frequencyMinutes: number;
  };
  analysis: DecisionMessageAnalysis;
};

export type OpportunityMessage = DecisionMessageBase & {
  kind: 'opportunity';
  direction: Exclude<SignalDirection, 'neutral'>;
  suggestedAction: 'buy_call' | 'buy_put';
  thesisType: ThesisType | 'sentiment';
  horizon: string;
  explanation: string[];
};

export type NoOpportunityMessage = DecisionMessageBase & {
  kind: 'no_opportunity';
  reason: SignalBlockingReason | 'neutral_signal';
  explanation: string[];
};

export type DecisionAgentMessage = OpportunityMessage | NoOpportunityMessage;
