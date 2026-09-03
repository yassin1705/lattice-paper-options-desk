import type { ExecutionProposal } from '@/lib/agents/execution/contracts';
import type { RiskDecision } from '@/lib/agents/contracts/risk-decision';

export type CopilotIntent = {
  action:
    | 'market_scan'
    | 'analyze'
    | 'trade'
    | 'account'
    | 'confirm'
    | 'cancel'
    | 'help';
  symbol: string | null;
  direction: 'bullish' | 'bearish' | null;
  investmentDollars: number | null;
  maximumRiskDollars: number | null;
  holdingDays: number | null;
};

export type MarketCandidate = {
  symbol: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  latestPrice: number | null;
  dailyChangePercent: number | null;
  rationale: string[];
  risks: string[];
};

export type MarketScan = {
  observedAt: string;
  universe: string[];
  marketSummary: string;
  noTrade: boolean;
  candidates: MarketCandidate[];
};

export type CopilotAccountSummary = {
  status: string;
  equity: number;
  cash: number;
  buyingPower: number;
  optionsBuyingPower: number;
  optionsTradingLevel: number | null;
  tradingBlocked: boolean;
};

export type CopilotProposal = {
  id: string;
  sessionId: string;
  createdAt: string;
  expiresAt: string;
  status:
    | 'awaiting_confirmation'
    | 'superseded'
    | 'cancelled'
    | 'submitted'
    | 'failed';
  symbol: string;
  instrument: 'stock' | 'option';
  direction: 'bullish' | 'bearish';
  investmentDollars: number;
  maximumRiskDollars: number;
  holdingDays: number;
  summary: string;
  evidence: string[];
  risks: string[];
  account: CopilotAccountSummary;
  riskDecision: RiskDecision | null;
  stockPlan: {
    quantity: number;
    referencePrice: number;
    limitPrice: number;
    estimatedNotional: number;
    stopLossPrice: number;
    takeProfitPrice: number;
    estimatedStopLossDollars: number;
  } | null;
  executionProposal: ExecutionProposal | null;
  mcpTools: string[];
};

export type CopilotResponse = {
  sessionId: string;
  reply: string;
  state:
    | 'ready'
    | 'collecting'
    | 'awaiting_confirmation'
    | 'completed'
    | 'error';
  executionAllowed: boolean;
  qwenConnected: boolean;
  mcpConnected: boolean;
  mcpTools: string[];
  proposal: CopilotProposal | null;
  marketScan?: MarketScan | null;
};
