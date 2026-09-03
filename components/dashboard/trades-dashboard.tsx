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
  Play,
  Send,
  ShieldCheck,
  Square,
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
  OpenStockPosition,
} from '@/lib/dashboard/types';
import type {
  CopilotProposal,
  CopilotResponse,
} from '@/lib/agents/copilot/types';
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

const originPresentation: Record<
  CompletedOptionTrade['origin'],
  { label: string; className: string }
> = {
  technical: {
    label: 'Technical',
    className: 'border-sky-300/10 bg-sky-300/[0.06] text-sky-200',
  },
  news_llm: {
    label: 'News LLM',
    className: 'border-violet-300/10 bg-violet-300/[0.06] text-violet-200',
  },
  combined: {
    label: 'Technical + News',
    className: 'border-emerald-300/10 bg-emerald-300/[0.06] text-emerald-200',
  },
  manual: {
    label: 'Manual',
    className: 'border-amber-300/10 bg-amber-300/[0.06] text-amber-200',
  },
  unknown: {
    label: 'Unknown',
    className: 'border-white/8 bg-white/[0.03] text-zinc-400',
  },
};

function OriginBadge({ origin }: { origin: CompletedOptionTrade['origin'] }) {
  const presentation = originPresentation[origin];
  return (
    <Badge variant="outline" className={presentation.className}>
      {presentation.label}
    </Badge>
  );
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

function StockPositionCard({ position }: { position: OpenStockPosition }) {
  const positive = position.unrealizedProfitLoss >= 0;
  const DirectionIcon = positive ? ArrowUpRight : ArrowDownRight;

  return (
    <Card className="min-w-[280px] flex-1 border-white/8 bg-white/[0.025] shadow-none lg:min-w-[315px]">
      <CardHeader className="gap-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg text-white">
                {position.symbol}
              </CardTitle>
              <Badge
                variant="outline"
                className={cn(
                  'border-transparent text-[10px] uppercase tracking-[0.12em]',
                  position.side === 'long'
                    ? 'bg-emerald-300/10 text-emerald-200'
                    : 'bg-rose-300/10 text-rose-200',
                )}
              >
                {position.side}
              </Badge>
            </div>
            <p className="mt-1 truncate text-xs text-zinc-500">
              {position.name}
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
            label="Shares"
            value={position.quantity.toLocaleString('en-US', {
              maximumFractionDigits: 6,
            })}
          />
          <PositionMetric
            label="Average"
            value={money.format(position.averageEntryPrice)}
          />
          <PositionMetric
            label="Current"
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
            <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">
              Unrealized P&amp;L
            </p>
            <p
              className={cn(
                'mt-1 text-xs font-medium tabular-nums',
                positive ? 'text-emerald-300' : 'text-rose-300',
              )}
            >
              {money.format(position.unrealizedProfitLoss)}
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
            <PositionMetric
              label="Trade origin"
              value={originPresentation[trade.origin].label}
            />
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
            <TableHead>Origin</TableHead>
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
                <TableCell className="whitespace-nowrap">
                  <OriginBadge origin={trade.origin} />
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

type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string };

function ProposalSummary({ proposal }: { proposal: CopilotProposal }) {
  if (proposal.instrument === 'stock' && proposal.stockPlan) {
    const plan = proposal.stockPlan;
    return (
      <div className="rounded-xl border border-emerald-300/15 bg-emerald-300/[0.04] p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-emerald-200">{proposal.id}</p>
          <Badge
            variant="outline"
            className="border-emerald-300/15 text-[10px] text-emerald-200"
          >
            {proposal.status.replaceAll('_', ' ')}
          </Badge>
        </div>
        <p className="mt-2 text-xs leading-5 text-zinc-300">
          Buy {plan.quantity.toFixed(6)} fractional {proposal.symbol} shares ·
          limit {money.format(plan.limitPrice)}
        </p>
        <p className="mt-1 text-[11px] text-zinc-500">
          About {money.format(plan.estimatedNotional)} · planned stop{' '}
          {money.format(plan.stopLossPrice)} · target{' '}
          {money.format(plan.takeProfitPrice)}
        </p>
      </div>
    );
  }
  if (
    !proposal.riskDecision ||
    proposal.riskDecision.kind !== 'approved_trade_plan'
  )
    return null;
  const plan = proposal.riskDecision.plan;
  return (
    <div className="rounded-xl border border-emerald-300/15 bg-emerald-300/[0.04] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-emerald-200">{proposal.id}</p>
        <Badge
          variant="outline"
          className="border-emerald-300/15 text-[10px] text-emerald-200"
        >
          {proposal.status.replaceAll('_', ' ')}
        </Badge>
      </div>
      <p className="mt-2 text-xs leading-5 text-zinc-300">
        Buy {plan.quantity} {plan.contractSymbol} · limit{' '}
        {money.format(plan.maximumEntryPrice)}
      </p>
      <p className="mt-1 text-[11px] text-zinc-500">
        Max loss {money.format(plan.maximumLoss)} · stop{' '}
        {money.format(plan.stopLossPrice)} · target{' '}
        {money.format(plan.takeProfitPrice)}
      </p>
    </div>
  );
}

function TradingCopilot() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Ask me to analyze the configured market, research a ticker, or prepare a risk-checked fractional-stock or options paper trade.',
    },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [lastResponse, setLastResponse] = useState<CopilotResponse | null>(
    null,
  );

  async function sendMessage(text = input) {
    const message = text.trim();
    if (!message || sending) return;
    setInput('');
    setSending(true);
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: 'user', content: message },
    ]);
    try {
      const requestSessionId =
        sessionId ??
        window.sessionStorage.getItem('trading-copilot-session') ??
        undefined;
      const response = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: requestSessionId, message }),
      });
      const payload = (await response.json()) as CopilotResponse & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error ?? 'Trading copilot failed.');
      setSessionId(payload.sessionId);
      window.sessionStorage.setItem(
        'trading-copilot-session',
        payload.sessionId,
      );
      setLastResponse(payload);
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: 'assistant', content: payload.reply },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content:
            error instanceof Error
              ? error.message
              : 'The trading copilot is unavailable.',
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="flex min-h-[470px] flex-col border-white/8 bg-white/[0.025] shadow-none">
      <CardHeader className="border-b border-white/7">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-emerald-300/10 text-emerald-300">
              <Bot className="size-4" />
            </span>
            <div>
              <CardTitle className="text-sm text-white">
                Trading copilot
              </CardTitle>
              <p className="mt-1 text-[11px] text-zinc-600">
                Qwen · Alpaca MCP · paper only
              </p>
            </div>
          </div>
          <span
            className={cn(
              'size-2 rounded-full',
              lastResponse?.qwenConnected ? 'bg-emerald-300' : 'bg-zinc-700',
            )}
            title={
              lastResponse?.qwenConnected
                ? lastResponse.mcpConnected
                  ? 'Qwen connected · Alpaca MCP used for this answer'
                  : 'Qwen connected · Alpaca MCP available on demand'
                : 'Connection checked on first request'
            }
          />
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col p-4">
        <div className="flex max-h-80 min-h-64 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                'max-w-[90%] rounded-xl px-3 py-2 text-xs leading-5',
                message.role === 'user'
                  ? 'ml-auto bg-emerald-300 text-emerald-950'
                  : 'bg-white/[0.05] text-zinc-300',
              )}
            >
              {message.content}
            </div>
          ))}
          {sending && (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <LoaderCircle className="size-3.5 animate-spin" />
              Qwen is checking fresh MCP data…
            </div>
          )}
          {lastResponse?.proposal && (
            <ProposalSummary proposal={lastResponse.proposal} />
          )}
        </div>
        {lastResponse?.mcpTools.length ? (
          <p className="mt-3 text-[10px] leading-4 text-zinc-600">
            MCP evidence: {lastResponse.mcpTools.join(' · ')}
          </p>
        ) : null}
        <div className="relative mt-4">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
            disabled={sending}
            aria-label="Message the trading copilot"
            placeholder="Analyze NVDA or invest $100 in a paper trade…"
            className="min-h-20 resize-none border-white/8 bg-black/15 pr-11 text-sm"
          />
          <Button
            disabled={sending || !input.trim()}
            size="icon"
            aria-label="Send message"
            onClick={() => void sendMessage()}
            className="absolute bottom-2 right-2 size-8"
          >
            {sending ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
          </Button>
        </div>
        {lastResponse?.state === 'awaiting_confirmation' && (
          <Button
            type="button"
            variant="outline"
            disabled={sending}
            onClick={() => void sendMessage('yes')}
            className="mt-2 border-emerald-300/20 bg-emerald-300/[0.05] text-emerald-200"
          >
            Confirm paper trade
          </Button>
        )}
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
  runner?: {
    state: 'stopped' | 'starting' | 'running' | 'stopping' | 'failed';
    pid: number | null;
    startedAt: string | null;
    stoppedAt: string | null;
    error: string | null;
  };
  technicalStrategy?: {
    enabled: boolean;
    revision: number;
    updatedAt: string;
  };
};

function AgentControls() {
  const [status, setStatus] = useState<OrchestratorView | null>(null);
  const [actionPending, setActionPending] = useState(false);

  async function loadStatus() {
    const response = await fetch('/api/orchestrator', { cache: 'no-store' });
    setStatus((await response.json()) as OrchestratorView);
  }

  useEffect(() => {
    const refresh = () => void loadStatus();
    queueMicrotask(refresh);
    const interval = window.setInterval(refresh, 5_000);
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
          runner: current?.runner,
        }));
      } else {
        setStatus(payload);
      }
    } finally {
      setActionPending(false);
    }
  }

  async function controlRunner(action: 'start' | 'stop') {
    setActionPending(true);
    try {
      const response = await fetch('/api/orchestrator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const payload = (await response.json()) as OrchestratorView & {
        error?: string;
      };
      if (!response.ok) {
        setStatus((current) =>
          current
            ? { ...current, error: payload.error ?? 'Agent action failed.' }
            : payload,
        );
      } else {
        setStatus(payload);
      }
    } finally {
      setActionPending(false);
    }
  }

  const busy = actionPending || status?.busy;
  const technicalEnabled = status?.technicalStrategy?.enabled ?? false;
  const technicalRunning =
    technicalEnabled &&
    (status?.runner?.state === 'running' ||
      status?.runner?.state === 'starting');

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
              <Badge
                variant="outline"
                className={cn(
                  'border-transparent text-[10px] uppercase tracking-[0.12em]',
                  technicalRunning
                    ? 'bg-emerald-300/10 text-emerald-200'
                    : technicalEnabled && status?.runner?.state === 'failed'
                      ? 'bg-rose-300/10 text-rose-200'
                      : 'bg-white/5 text-zinc-400',
                )}
              >
                {technicalRunning
                  ? 'Technical running'
                  : technicalEnabled && status?.runner?.state === 'failed'
                    ? 'Technical failed'
                    : 'Technical stopped'}
              </Badge>
            </div>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              {status?.error
                ? status.error
                : status?.runner?.error
                  ? status.runner.error
                  : 'The technical agent runs locally and submits only paper orders through Alpaca CLI.'}
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
            Starts the technical agent locally. Enabled news analysis joins the
            same runner automatically.
          </p>
          <Button
            type="button"
            variant={technicalRunning ? 'destructive' : 'default'}
            disabled={Boolean(busy) || !status?.configured}
            onClick={() =>
              void controlRunner(technicalRunning ? 'stop' : 'start')
            }
          >
            {technicalRunning ? (
              <Square className="size-3.5" />
            ) : (
              <Play className="size-3.5" />
            )}
            {technicalRunning
              ? 'Stop technical agent'
              : technicalEnabled
                ? 'Restart technical agent'
                : 'Start technical agent'}
          </Button>
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
            Trading activity
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

      <section className="mb-7" aria-labelledby="open-stock-positions-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2
            id="open-stock-positions-heading"
            className="text-sm font-medium text-zinc-200"
          >
            Open stock positions
          </h2>
          <span className="text-xs tabular-nums text-zinc-600">
            {snapshot.openStockPositions.length} active
          </span>
        </div>
        {loading ? (
          <div className="flex gap-4 overflow-hidden">
            {[0, 1].map((item) => (
              <Skeleton
                key={item}
                className="h-60 min-w-[300px] flex-1 bg-white/5"
              />
            ))}
          </div>
        ) : snapshot.openStockPositions.length > 0 ? (
          <div className="flex gap-4 overflow-x-auto pb-2">
            {snapshot.openStockPositions.map((position) => (
              <StockPositionCard key={position.id} position={position} />
            ))}
          </div>
        ) : (
          <Card className="grid min-h-36 place-items-center border-dashed border-white/8 bg-transparent shadow-none">
            <div className="text-center">
              <ShieldCheck className="mx-auto size-6 text-zinc-700" />
              <p className="mt-3 text-sm text-zinc-400">
                No open stock positions
              </p>
            </div>
          </Card>
        )}
      </section>

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
        <TradingCopilot />
      </div>
    </AppShell>
  );
}
