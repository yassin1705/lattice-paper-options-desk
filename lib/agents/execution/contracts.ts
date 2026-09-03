export type ExecutionOrderRequest = {
  symbol: string;
  quantity: number;
  side: 'buy' | 'sell';
  positionIntent?: 'buy_to_open' | 'sell_to_close';
  type: 'limit';
  timeInForce: 'day';
  limitPrice: number;
  clientOrderId: string;
};

export type ExecutionReceipt = {
  alpacaOrderId: string;
  clientOrderId: string;
  status: string;
  submittedAt: string | null;
};

export type ExecutionProposal = {
  id: string;
  source: 'entry' | 'exit';
  sourceReference: string;
  policyRevision: number;
  createdAt: string;
  status: 'ready' | 'submitted' | 'failed';
  order: ExecutionOrderRequest;
  receipt: ExecutionReceipt | null;
  error: string | null;
};

export type StockEntryRequest = {
  symbol: string;
  quantity: number;
  limitPrice: number;
  sourceReference: string;
  policyRevision: number;
};

export type ExecutionStatus = {
  enabled: boolean;
  environment: 'paper';
  proposals: ExecutionProposal[];
};
