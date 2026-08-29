import type {
  DataQuality,
  MarketRegime,
  SentimentSignal,
  SignalBlockingReason,
  SignalContribution,
  SignalDirection,
  TechnicalFeatureSnapshot,
  ThesisType,
} from '@/lib/agents/decision-maker/types';

export const decisionMessageSchemaVersion = '1' as const;

export type DecisionMessageAnalysis = {
  symbol: string;
  marketObservedAt: string;
  latestPrice: number;
  regime: MarketRegime;
  signedScore: number;
  signalStrength: number;
  features: TechnicalFeatureSnapshot;
  contributions: SignalContribution[];
  dataQuality: DataQuality;
  sentiment: SentimentSignal;
};

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
