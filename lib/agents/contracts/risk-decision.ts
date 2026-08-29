export type ProposedTradePlan = {
  contractSymbol: string;
  quantity: number;
  maximumEntryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  maximumLoss: number;
  maximumHoldingMinutes: number;
};

export type RiskDecision =
  | {
      kind: 'approved_trade_plan';
      signalId: string;
      reviewedAt: string;
      plan: ProposedTradePlan;
      explanation: string[];
    }
  | {
      kind: 'rejected_trade';
      signalId: string;
      reviewedAt: string;
      reasons: string[];
    };
