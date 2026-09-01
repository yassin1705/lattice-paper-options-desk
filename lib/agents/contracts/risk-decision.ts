export type ProposedTradePlan = {
  contractSymbol: string;
  quantity: number;
  maximumEntryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  maximumLoss: number;
  maximumHoldingMinutes: number;
};

export type RiskRuleResult = {
  ruleId: string;
  outcome: 'pass' | 'fail' | 'warning';
  observedValue: number | string | boolean | null;
  configuredLimit: number | string | boolean | null;
  explanation: string;
};

export type RiskDecision =
  | {
      kind: 'approved_trade_plan';
      signalId: string;
      strategyId: 'technical' | 'news_llm';
      reviewedAt: string;
      policyRevision: number;
      plan: ProposedTradePlan;
      rules: RiskRuleResult[];
      explanation: string[];
    }
  | {
      kind: 'rejected_trade';
      signalId: string;
      strategyId: 'technical' | 'news_llm';
      reviewedAt: string;
      policyRevision: number;
      rules: RiskRuleResult[];
      reasons: string[];
    };

export type PositionRiskDecision =
  | {
      kind: 'hold_position';
      contractSymbol: string;
      reviewedAt: string;
      policyRevision: number;
      rules: RiskRuleResult[];
      reasons: string[];
    }
  | {
      kind: 'exit_position';
      contractSymbol: string;
      quantity: number;
      reviewedAt: string;
      policyRevision: number;
      proposedLimitPrice: number | null;
      rules: RiskRuleResult[];
      reasons: string[];
    };
