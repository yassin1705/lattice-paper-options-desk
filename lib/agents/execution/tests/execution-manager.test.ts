import { describe, expect, it, vi } from 'vitest';

import type { RiskDecision } from '@/lib/agents/contracts/risk-decision';
import { ExecutionManager } from '@/lib/agents/execution/execution-manager';
import type { PaperOrderGateway } from '@/lib/agents/execution/ports';
import { AlpacaCliExecutionGateway } from '@/lib/alpaca/alpaca-cli-execution-gateway';
import { AlpacaPaperExecutionGateway } from '@/lib/alpaca/alpaca-paper-execution-gateway';

function approvedDecision(): RiskDecision & { kind: 'approved_trade_plan' } {
  return {
    kind: 'approved_trade_plan',
    signalId: 'decision:SPY:2026-08-30T12:00:00.000Z',
    reviewedAt: '2026-08-30T12:01:00.000Z',
    policyRevision: 4,
    plan: {
      contractSymbol: 'SPY260918C00600000',
      quantity: 1,
      maximumEntryPrice: 2.35,
      stopLossPrice: 1.76,
      takeProfitPrice: 3.29,
      maximumLoss: 235,
      maximumHoldingMinutes: 1_950,
    },
    rules: [],
    explanation: [],
  };
}

function gateway() {
  const submitOrder = vi.fn(async (order) => ({
    alpacaOrderId: 'paper-order-1',
    clientOrderId: order.clientOrderId,
    status: 'accepted',
    submittedAt: '2026-08-30T12:02:00.000Z',
  }));
  return { gateway: { submitOrder } satisfies PaperOrderGateway, submitOrder };
}

describe('ExecutionManager', () => {
  it('does not create a proposal for a rejected risk decision', async () => {
    const fake = gateway();
    const manager = new ExecutionManager(fake.gateway, true);
    const proposal = await manager.processEntry({
      kind: 'rejected_trade',
      signalId: 'rejected',
      reviewedAt: '2026-08-30T12:01:00.000Z',
      policyRevision: 4,
      rules: [],
      reasons: ['Risk limit reached.'],
    });

    expect(proposal).toBeNull();
    expect(fake.submitOrder).not.toHaveBeenCalled();
  });

  it('keeps a proposal ready when execution is disabled', async () => {
    const fake = gateway();
    const manager = new ExecutionManager(fake.gateway, false);
    const proposal = await manager.processEntry(approvedDecision());

    expect(proposal?.status).toBe('ready');
    expect(fake.submitOrder).not.toHaveBeenCalled();
  });

  it('submits an enabled autonomous proposal only once', async () => {
    const fake = gateway();
    const manager = new ExecutionManager(fake.gateway, true);
    const submitted = await manager.processEntry(approvedDecision());
    const duplicate = await manager.processEntry(approvedDecision());

    expect(submitted?.status).toBe('submitted');
    expect(duplicate).toEqual(submitted);
    expect(fake.submitOrder).toHaveBeenCalledTimes(1);
    expect(fake.submitOrder.mock.calls[0]?.[0]).toMatchObject({
      side: 'buy',
      positionIntent: 'buy_to_open',
      type: 'limit',
      timeInForce: 'day',
    });
  });
});

describe('AlpacaPaperExecutionGateway', () => {
  it('rejects a non-paper trading endpoint', () => {
    expect(
      () =>
        new AlpacaPaperExecutionGateway({
          apiKey: 'key',
          secretKey: 'secret',
          tradingBaseUrl: 'https://api.alpaca.markets',
        }),
    ).toThrow('Execution is restricted to the Alpaca paper endpoint.');
  });

  it('checks the client order ID before creating an order', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(
        Response.json({
          id: 'paper-order-1',
          client_order_id: 'agent-entry-r4-test',
          status: 'accepted',
          submitted_at: '2026-08-30T12:02:00.000Z',
        }),
      );
    const gateway = new AlpacaPaperExecutionGateway({
      apiKey: 'key',
      secretKey: 'secret',
      fetcher,
    });
    await gateway.submitOrder({
      symbol: 'SPY260918C00600000',
      quantity: 1,
      side: 'buy',
      positionIntent: 'buy_to_open',
      type: 'limit',
      timeInForce: 'day',
      limitPrice: 2.35,
      clientOrderId: 'agent-entry-r4-test',
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toContain(
      '/v2/orders:by_client_order_id?client_order_id=agent-entry-r4-test',
    );
    expect(fetcher.mock.calls[1]?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({
      side: 'buy',
      position_intent: 'buy_to_open',
      limit_price: '2.35',
    });
  });
});

describe('AlpacaCliExecutionGateway', () => {
  it('preflights the paper account and submits an exact option limit order', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        account_number: 'competition-paper',
        status: 'ACTIVE',
        options_trading_level: 3,
        trading_blocked: false,
        account_blocked: false,
      })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        id: 'cli-paper-order-1',
        client_order_id: 'agent-entry-r4-test',
        status: 'accepted',
        submitted_at: '2026-08-31T14:32:00.000Z',
      });
    const gateway = new AlpacaCliExecutionGateway({
      apiKey: 'key',
      secretKey: 'secret',
      expectedAccountId: 'competition-paper',
      commandRunner: run,
    });

    const result = await gateway.submitOrder({
      symbol: 'SPY260918C00600000',
      quantity: 1,
      side: 'buy',
      positionIntent: 'buy_to_open',
      type: 'limit',
      timeInForce: 'day',
      limitPrice: 2.35,
      clientOrderId: 'agent-entry-r4-test',
    });

    expect(result.alpacaOrderId).toBe('cli-paper-order-1');
    expect(run).toHaveBeenNthCalledWith(1, ['account', 'get', '--quiet']);
    expect(run).toHaveBeenNthCalledWith(
      3,
      expect.arrayContaining([
        'order',
        'submit',
        '--symbol',
        'SPY260918C00600000',
        '--position-intent',
        'buy_to_open',
      ]),
    );
  });

  it('rejects execution when the CLI account does not match', async () => {
    const gateway = new AlpacaCliExecutionGateway({
      apiKey: 'key',
      secretKey: 'secret',
      expectedAccountId: 'expected-paper',
      commandRunner: vi.fn(async () => ({
        account_number: 'other-paper',
        status: 'ACTIVE',
        options_trading_level: 3,
      })),
    });

    await expect(
      gateway.submitOrder({
        symbol: 'SPY260918C00600000',
        quantity: 1,
        side: 'buy',
        positionIntent: 'buy_to_open',
        type: 'limit',
        timeInForce: 'day',
        limitPrice: 2.35,
        clientOrderId: 'agent-entry-r4-test',
      }),
    ).rejects.toThrow('wrong paper account');
  });
});
