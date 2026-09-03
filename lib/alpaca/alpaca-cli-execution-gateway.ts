import { execFile } from 'node:child_process';

import type {
  ExecutionOrderRequest,
  ExecutionReceipt,
} from '@/lib/agents/execution/contracts';
import type { PaperOrderGateway } from '@/lib/agents/execution/ports';
import { parseOptionSymbol } from '@/lib/alpaca/option-symbol';

type JsonRecord = Record<string, unknown>;

export type AlpacaCliCommandRunner = (
  args: string[],
) => Promise<unknown>;

export type AlpacaCliExecutionOptions = {
  apiKey: string;
  secretKey: string;
  binaryPath?: string;
  expectedAccountId?: string;
  minimumOptionsLevel?: number;
  timeoutMs?: number;
  commandRunner?: AlpacaCliCommandRunner;
};

function record(value: unknown, name: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Alpaca CLI returned an invalid ${name} response.`);
  }
  return value as JsonRecord;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function boolean(value: unknown): boolean {
  return value === true || value === 'true';
}

function parseJson(stdout: string): unknown {
  const value = stdout.trim();
  if (!value) throw new Error('Alpaca CLI returned no JSON output.');
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error('Alpaca CLI returned malformed JSON output.');
  }
}

function createCommandRunner(
  options: AlpacaCliExecutionOptions,
): AlpacaCliCommandRunner {
  const binaryPath = options.binaryPath ?? 'alpaca';
  const timeoutMs = options.timeoutMs ?? 30_000;
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(
        binaryPath,
        args,
        {
          env: {
            ...process.env,
            ALPACA_API_KEY: options.apiKey,
            ALPACA_SECRET_KEY: options.secretKey,
            ALPACA_LIVE_TRADE: 'false',
            ALPACA_OUTPUT: 'json',
            ALPACA_QUIET: 'true',
          },
          timeout: timeoutMs,
          maxBuffer: 1_048_576,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error) {
            const detail = stderr.trim().slice(0, 500);
            reject(
              new Error(
                `Alpaca CLI command failed${detail ? `: ${detail}` : '.'}`,
              ),
            );
            return;
          }
          try {
            resolve(parseJson(stdout));
          } catch (parseError) {
            reject(parseError);
          }
        },
      );
    });
}

function receipt(value: unknown): ExecutionReceipt {
  const order = record(value, 'order');
  const alpacaOrderId = text(order.id);
  const clientOrderId = text(order.client_order_id);
  if (!alpacaOrderId || !clientOrderId) {
    throw new Error('Alpaca CLI order response is missing its identifiers.');
  }
  return {
    alpacaOrderId,
    clientOrderId,
    status: text(order.status) || 'unknown',
    submittedAt: text(order.submitted_at) || null,
  };
}

export class AlpacaCliExecutionGateway implements PaperOrderGateway {
  private readonly run: AlpacaCliCommandRunner;
  private readonly minimumOptionsLevel: number;

  constructor(private readonly options: AlpacaCliExecutionOptions) {
    if (!options.apiKey || !options.secretKey) {
      throw new Error('Alpaca paper credentials are required by the CLI.');
    }
    this.minimumOptionsLevel = options.minimumOptionsLevel ?? 2;
    this.run = options.commandRunner ?? createCommandRunner(options);
  }

  async submitOrder(order: ExecutionOrderRequest): Promise<ExecutionReceipt> {
    this.validateOrder(order);
    const optionOrder = Boolean(parseOptionSymbol(order.symbol));
    await this.verifyPaperAccount(optionOrder);

    const orders = await this.run([
      'order',
      'list',
      '--status',
      'all',
      '--asset-class',
      optionOrder ? 'us_option' : 'us_equity',
      '--limit',
      '500',
      '--quiet',
    ]);
    const existing = (Array.isArray(orders) ? orders : []).find(
      (candidate) =>
        candidate &&
        typeof candidate === 'object' &&
        (candidate as JsonRecord).client_order_id === order.clientOrderId,
    );
    if (existing) return receipt(existing);

    const submitArguments = [
      'order',
      'submit',
      '--symbol',
      order.symbol,
      '--qty',
      String(order.quantity),
      '--side',
      order.side,
      '--type',
      order.type,
      '--limit-price',
      order.limitPrice.toFixed(2),
      '--time-in-force',
      order.timeInForce,
    ];
    if (order.positionIntent) {
      submitArguments.push('--position-intent', order.positionIntent);
    }
    submitArguments.push(
      '--client-order-id',
      order.clientOrderId,
      '--quiet',
    );
    const created = await this.run(submitArguments);
    return receipt(created);
  }

  private validateOrder(order: ExecutionOrderRequest): void {
    const optionOrder = Boolean(parseOptionSymbol(order.symbol));
    if (!optionOrder && !/^[A-Z][A-Z0-9.-]{0,9}$/.test(order.symbol)) {
      throw new Error('The CLI execution gateway requires a valid symbol.');
    }
    if (
      !Number.isFinite(order.quantity) ||
      order.quantity <= 0 ||
      (optionOrder && !Number.isInteger(order.quantity))
    ) {
      throw new Error(
        optionOrder
          ? 'The CLI execution gateway requires a positive whole-contract quantity.'
          : 'The CLI execution gateway requires a positive share quantity.',
      );
    }
    if (!Number.isFinite(order.limitPrice) || order.limitPrice <= 0) {
      throw new Error('The CLI execution gateway requires a positive limit price.');
    }
  }

  private async verifyPaperAccount(requireOptions: boolean): Promise<void> {
    const account = record(
      await this.run(['account', 'get', '--quiet']),
      'account',
    );
    const accountId = text(account.account_number);
    const expectedAccountId = this.options.expectedAccountId?.trim();
    if (expectedAccountId && accountId !== expectedAccountId) {
      throw new Error('The Alpaca CLI is connected to the wrong paper account.');
    }
    if (text(account.status).toUpperCase() !== 'ACTIVE') {
      throw new Error('The Alpaca paper account is not active.');
    }
    if (boolean(account.account_blocked) || boolean(account.trading_blocked)) {
      throw new Error('The Alpaca paper account is blocked from trading.');
    }
    const optionsLevel = number(
      account.options_trading_level ?? account.options_approved_level,
    );
    if (requireOptions && optionsLevel < this.minimumOptionsLevel) {
      throw new Error(
        `The Alpaca paper account requires options level ${this.minimumOptionsLevel} or higher.`,
      );
    }
  }
}
