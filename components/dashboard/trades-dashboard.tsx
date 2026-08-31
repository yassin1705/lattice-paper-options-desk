'use client';

import { useEffect, useState } from 'react';

import {
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  CalendarClock,
  CheckCircle2,
  FileText,
  FlaskConical,
  LoaderCircle,
  MessageSquareText,
  Send,
  ShieldCheck,
  Terminal,
} from 'lucide-react';

import { AppShell } from '@/components/dashboard/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useDashboardSnapshot } from '@/hooks/use-dashboard-snapshot';
import type {
  CompletedOptionTrade,
  OpenOptionPosition,
} from '@/lib/dashboard/types';
import { cn } from '@/lib/utils';

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

const signedPercent = new Intl.NumberFormat('en-US', {
  signDisplay: 'always',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const shortDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const updateTime = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  timeZone: 'UTC',
});

function formatTradeDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value || 'Unavailable'
    : shortDate.format(date);
}

function formatUpdateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Unavailable'
    : `${updateTime.format(date)} UTC`;
}

function PositionCard({ position }: { position: OpenOptionPosition }) {
  const positive = position.unrealizedProfitLoss >= 0;
  const DirectionIcon = positive ? ArrowUpRight : ArrowDownRight;

  return (
    <Card className="min-w-[280px] flex-1 border-white/8 bg-white/[0.025] shadow-none lg:min-w-[315px]">
      <CardHeader className="gap-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg text-white">
                {position.underlying}
              </CardTitle>
              <Badge
                variant="outline"
                className={cn(
                  'border-transparent text-[10px] uppercase tracking-[0.12em]',
                  position.optionType === 'call'
                    ? 'bg-emerald-300/10 text-emerald-200'
                    : 'bg-violet-300/10 text-violet-200',
                )}
              >
                {position.optionType}
              </Badge>
            </div>
            <p className="mt-1 truncate text-xs text-zinc-500">
              {position.underlyingName}
            </p>
          </div>
          <div
            className={cn(
              'flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold tabular-nums',
              positive
                ? 'bg-emerald-300/10 text-emerald-300'
                : 'bg-rose-300/10 text-rose-300',
            )}
          >
            <DirectionIcon className="size-3.5" />
            {signedPercent.format(position.unrealizedProfitLossPercent)}%
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3 border-y border-white/6 py-3">
          <PositionMetric
            label="Strike"
            value={money.format(position.strike)}
          />
          <PositionMetric label="Contracts" value={String(position.quantity)} />
          <PositionMetric
            label="Mark"
            value={money.format(position.currentPrice)}
          />
        </div>
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">
              Market value
            </p>
            <p className="mt-1 font-medium tabular-nums text-zinc-200">
              {money.format(position.marketValue)}
            </p>
          </div>
          <div className="text-right">
            <p className="flex items-center justify-end gap-1 text-[10px] uppercase tracking-[0.14em] text-zinc-600">
              <CalendarClock className="size-3" /> {position.daysToExpiration}d
              left
            </p>
            <p className="mt-1 text-xs tabular-nums text-zinc-400">
              {shortDate.format(new Date(position.expiration))}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PositionMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium tabular-nums text-zinc-200">
        {value}
      </p>
    </div>
  );
}

function ReportDrawer({ trade }: { trade: CompletedOptionTrade }) {
  return (
    <Drawer swipeDirection="right">
      <DrawerTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-zinc-400 hover:text-white"
          >
            <FileText className="size-3.5" />
            Report
          </Button>
        }
      />
      <DrawerContent className="border-white/10 bg-[#0c1512]">
        <DrawerHeader className="border-b border-white/7 p-6">
          <DrawerTitle className="text-xl text-white">Trade report</DrawerTitle>
          <DrawerDescription>{trade.contract}</DrawerDescription>
        </DrawerHeader>
        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          <div className="grid grid-cols-2 gap-4">
            <PositionMetric label="Underlying" value={trade.underlying} />
            <PositionMetric label="Status" value={trade.status} />
            <PositionMetric label="Quantity" value={String(trade.quantity)} />
            <PositionMetric
              label="Closed"
              value={formatTradeDate(trade.closedAt)}
            />
            <PositionMetric
              label="Entry price"
              value={
                trade.entryPrice === null
                  ? 'Unavailable'
                  : money.format(trade.entryPrice)
              }
            />
            <PositionMetric
              label="Exit price"
              value={
                trade.exitPrice === null
                  ? 'Unavailable'
                  : money.format(trade.exitPrice)
              }
            />
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.025] p-4">
            <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">
              Execution report
            </p>
            <p className="mt-3 text-sm leading-6 text-zinc-300">
              {trade.report}
            </p>
          </div>
          <div className="flex gap-3 rounded-xl border border-emerald-300/10 bg-emerald-300/[0.04] p-4">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-300" />
            <p className="text-xs leading-5 text-zinc-400">
              This view explains recorded activity only. It cannot submit,
              replace, or cancel orders.
            </p>
          </div>
        </div>
        <DrawerFooter className="border-t border-white/7 p-6">
          <DrawerClose
            render={<Button variant="outline">Close report</Button>}
          />
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function CompletedTradesTable({ trades }: { trades: CompletedOptionTrade[] }) {
  if (trades.length === 0) {
    return (
      <div className="grid min-h-64 place-items-center text-center">
        <div>
          <CheckCircle2 className="mx-auto size-6 text-zinc-600" />
          <p className="mt-3 text-sm font-medium text-zinc-300">
            No completed trades yet
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            Closed option orders will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-white/7 hover:bg-transparent">
            <TableHead>Closed</TableHead>
            <TableHead>Contract</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Exit</TableHead>
            <TableHead className="text-right">P&amp;L</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trades.map((trade) => {
            const positive = (trade.profitLoss ?? 0) >= 0;
            return (
              <TableRow
                key={trade.id}
                className="border-white/6 hover:bg-white/[0.025]"
              >
                <TableCell className="whitespace-nowrap text-xs text-zinc-500">
                  {formatTradeDate(trade.closedAt)}
                </TableCell>
                <TableCell>
                  <p className="font-medium text-zinc-200">
                    {trade.underlying}
                  </p>
                  <p className="mt-0.5 max-w-48 truncate text-[11px] text-zinc-600">
                    {trade.contract}
                  </p>
                </TableCell>
                <TableCell className="text-right tabular-nums text-zinc-400">
                  {trade.quantity}
                </TableCell>
                <TableCell className="text-right tabular-nums text-zinc-400">
                  {trade.exitPrice === null
                    ? '—'
                    : money.format(trade.exitPrice)}
                </TableCell>
                <TableCell
                  className={cn(
                    'text-right font-medium tabular-nums',
                    trade.profitLoss === null
                      ? 'text-zinc-600'
                      : positive
                        ? 'text-emerald-300'
                        : 'text-rose-300',
                  )}
                >
                  {trade.profitLoss === null
                    ? '—'
                    : `${money.format(trade.profitLoss)} · ${signedPercent.format(trade.returnPercent ?? 0)}%`}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className="border-white/8 bg-white/[0.03] capitalize text-zinc-400"
                  >
                    {trade.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <ReportDrawer trade={trade} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function ChatPlaceholder() {
  return (
    <Card className="flex min-h-[470px] flex-col border-white/8 bg-white/[0.025] shadow-none">
      <CardHeader className="border-b border-white/7">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-emerald-300/10 text-emerald-300">
            <Bot className="size-4" />
          </span>
          <div>
            <CardTitle className="text-sm text-white">
              Explainability chat
            </CardTitle>
            <p className="mt-1 text-[11px] text-zinc-600">
              LLM layer · coming later
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col p-4">
        <div className="flex flex-1 items-center justify-center px-5 text-center">
          <div>
            <MessageSquareText className="mx-auto size-7 text-zinc-700" />
            <p className="mt-3 text-sm font-medium text-zinc-400">
              Conversation is not enabled
            </p>
            <p className="mt-1 text-xs leading-5 text-zinc-600">
              This space will explain decisions, risk checks, and completed
              trade reports.
            </p>
          </div>
        </div>
        <div className="relative mt-4">
          <Textarea
            disabled
            aria-label="Explainability chat placeholder"
            placeholder="Ask why a trade was taken…"
            className="min-h-20 resize-none border-white/8 bg-black/15 pr-11 text-xs"
          />
          <Button
            disabled
            size="icon"
            className="absolute bottom-2 right-2 size-8"
          >
            <Send className="size-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type OrchestratorView = {
  configured: boolean;
  busy: boolean;
  mode: 'dashboard_analysis';
  executionMode: 'alpaca_cli_runner';
  lastRunAt?: string | null;
  lastRunType?: 'safe_test' | null;
  lastSummary?: {
    symbols: number;
    opportunities: number;
    approved: number;
    submitted: number;
    rejected: number;
    failed: number;
    exitsSubmitted: number;
  } | null;
  error?: string | null;
};

function AgentControls() {
  const [status, setStatus] = useState<OrchestratorView | null>(null);
  const [actionPending, setActionPending] = useState(false);

  async function loadStatus() {
    const response = await fetch('/api/orchestrator', { cache: 'no-store' });
    setStatus((await response.json()) as OrchestratorView);
  }

  useEffect(() => {
    void loadStatus();
    const interval = window.setInterval(() => void loadStatus(), 5_000);
    return () => window.clearInterval(interval);
  }, []);

  async function runSafeTest() {
    setActionPending(true);
    try {
      const response = await fetch('/api/orchestrator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test' }),
      });
      const payload = (await response.json()) as OrchestratorView & {
        error?: string;
      };
      if (!response.ok) {
        setStatus((current) => ({
          configured: current?.configured ?? false,
          busy: false,
          mode: 'dashboard_analysis',
          executionMode: 'alpaca_cli_runner',
          error: payload.error ?? 'The agent action failed.',
        }));
      } else {
        setStatus(payload);
      }
    } finally {
      setActionPending(false);
    }
  }

  const busy = actionPending || status?.busy;

  return (
    <Card className="mb-7 border-white/8 bg-white/[0.025] shadow-none">
      <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl',
              'bg-emerald-300/10 text-emerald-300',
            )}
          >
            {busy ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Terminal className="size-4" />
            )}
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-white">Order execution</p>
              <Badge
                variant="outline"
                className={cn(
                  'border-transparent text-[10px] uppercase tracking-[0.12em]',
                  'bg-emerald-300/10 text-emerald-200',
                )}
              >
                Alpaca CLI
              </Badge>
              <Badge
                variant="outline"
                className="border-sky-300/10 bg-sky-300/[0.05] text-[10px] uppercase tracking-[0.12em] text-sky-200"
              >
                Paper only
              </Badge>
            </div>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              {status?.error
                ? status.error
                : 'Orders are submitted only by the standalone CLI runner. This dashboard is monitoring and analysis-only.'}
            </p>
            {status?.lastSummary && (
              <p className="mt-1 text-[11px] text-zinc-600">
                Last safe test: {status.lastSummary.symbols} symbols ·{' '}
                {status.lastSummary.opportunities} opportunities ·{' '}
                {status.lastSummary.approved} approved ·{' '}
                {status.lastSummary.submitted} submitted
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 lg:justify-end">
          <p className="max-w-52 text-right text-[11px] leading-4 text-zinc-600">
            Start and stop the trading agent from the CLI runner.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={Boolean(busy) || !status?.configured}
            onClick={() => void runSafeTest()}
            className="border-white/10 bg-white/[0.025] text-zinc-300"
          >
            <FlaskConical className="size-3.5" />
            Test analysis
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function TradesDashboard() {
  const { snapshot, loading } = useDashboardSnapshot();

  return (
    <AppShell active="trades" connection={snapshot.connection}>
      <section className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300/70">
            Position monitor
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Options activity
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-500">
            Open positions and completed execution history from the paper
            account.
          </p>
        </div>
        <p className="text-[11px] text-zinc-600">
          {loading
            ? 'Updating account data…'
            : `Updated ${formatUpdateTime(snapshot.updatedAt)}`}
        </p>
      </section>

      <AgentControls />

      <section aria-labelledby="open-positions-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2
            id="open-positions-heading"
            className="text-sm font-medium text-zinc-200"
          >
            Open option positions
          </h2>
          <span className="text-xs tabular-nums text-zinc-600">
            {snapshot.openPositions.length} active
          </span>
        </div>
        {loading ? (
          <div className="flex gap-4 overflow-hidden">
            {[0, 1, 2].map((item) => (
              <Skeleton
                key={item}
                className="h-60 min-w-[300px] flex-1 bg-white/5"
              />
            ))}
          </div>
        ) : snapshot.openPositions.length > 0 ? (
          <div className="flex gap-4 overflow-x-auto pb-2">
            {snapshot.openPositions.map((position) => (
              <PositionCard key={position.id} position={position} />
            ))}
          </div>
        ) : (
          <Card className="grid min-h-44 place-items-center border-dashed border-white/8 bg-transparent shadow-none">
            <div className="text-center">
              <ShieldCheck className="mx-auto size-6 text-zinc-700" />
              <p className="mt-3 text-sm text-zinc-400">
                No open option positions
              </p>
            </div>
          </Card>
        )}
      </section>

      <div className="mt-7 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="overflow-hidden border-white/8 bg-white/[0.025] shadow-none">
          <CardHeader className="border-b border-white/7">
            <CardTitle className="text-sm text-white">
              Finished trades
            </CardTitle>
            <p className="text-xs text-zinc-600">
              Only terminal trade states are shown in this ledger.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <Skeleton className="m-5 h-64 bg-white/5" />
            ) : (
              <CompletedTradesTable trades={snapshot.completedTrades} />
            )}
          </CardContent>
        </Card>
        <ChatPlaceholder />
      </div>
    </AppShell>
  );
}
