import type {
  ExecutionOrderRequest,
  ExecutionReceipt,
} from '@/lib/agents/execution/contracts';
import type { PaperOrderGateway } from '@/lib/agents/execution/ports';

type AlpacaOrder = Record<string, unknown>;

export type AlpacaPaperExecutionOptions = {
  apiKey: string;
  secretKey: string;
  tradingBaseUrl?: string;
  fetcher?: typeof fetch;
};

export class AlpacaExecutionError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'AlpacaExecutionError';
  }
}

function paperBaseUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'paper-api.alpaca.markets'
  ) {
    throw new Error('Execution is restricted to the Alpaca paper endpoint.');
  }
  return url.origin;
}

function receipt(value: unknown): ExecutionReceipt {
  const order =
    value && typeof value === 'object' ? (value as AlpacaOrder) : {};
  const text = (candidate: unknown, fallback = '') =>
    typeof candidate === 'string' || typeof candidate === 'number'
      ? String(candidate)
      : fallback;
  return {
    alpacaOrderId: text(order.id),
    clientOrderId: text(order.client_order_id),
    status: text(order.status, 'unknown'),
    submittedAt:
      typeof order.submitted_at === 'string' ? order.submitted_at : null,
  };
}

export class AlpacaPaperExecutionGateway implements PaperOrderGateway {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: AlpacaPaperExecutionOptions) {
    this.baseUrl = paperBaseUrl(
      options.tradingBaseUrl ?? 'https://paper-api.alpaca.markets',
    );
    this.fetcher = options.fetcher ?? fetch;
  }

  async submitOrder(order: ExecutionOrderRequest): Promise<ExecutionReceipt> {
    const existing = await this.request(
      `/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(order.clientOrderId)}`,
      { method: 'GET' },
      true,
    );
    if (existing) return receipt(existing);

    const created = await this.request('/v2/orders', {
      method: 'POST',
      body: JSON.stringify({
        symbol: order.symbol,
        qty: String(order.quantity),
        side: order.side,
        type: order.type,
        time_in_force: order.timeInForce,
        limit_price: order.limitPrice.toFixed(2),
        client_order_id: order.clientOrderId,
        position_intent: order.positionIntent,
      }),
    });
    return receipt(created);
  }

  private async request(
    path: string,
    init: RequestInit,
    allowNotFound = false,
  ): Promise<unknown> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'APCA-API-KEY-ID': this.options.apiKey,
        'APCA-API-SECRET-KEY': this.options.secretKey,
        'Content-Type': 'application/json',
      },
    });
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      throw new AlpacaExecutionError(
        `Alpaca paper order request failed (${response.status})${body ? `: ${body}` : '.'}`,
        response.status,
      );
    }
    return response.json();
  }
}
