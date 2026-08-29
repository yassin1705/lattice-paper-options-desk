'use client';

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { CloudOff, Cloud, ShieldCheck, TriangleAlert, WalletCards } from 'lucide-react';

import { AppShell } from '@/components/dashboard/app-shell';
import { RiskPolicyPanel } from '@/components/dashboard/risk-policy-panel';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { useDashboardSnapshot } from '@/hooks/use-dashboard-snapshot';

const chartConfig = {
  equity: { label: 'Account equity', color: '#6ee7b7' },
} satisfies ChartConfig;

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

const percent = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
  signDisplay: 'always',
});

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-white/7 bg-white/[0.025] p-4">
      <p className="text-[11px] uppercase tracking-[0.12em] text-zinc-500">{label}</p>
      <p className="mt-2 font-mono text-xl font-medium tracking-tight text-white">{value}</p>
      <p className="mt-1 text-xs text-zinc-600">{detail}</p>
    </div>
  );
}

export function AccountDashboard() {
  const { snapshot, loading } = useDashboardSnapshot();
  const { account, connection, equityHistory } = snapshot;
  const startEquity = equityHistory[0]?.equity ?? account.equity;
  const totalChange = account.equity - startEquity;
  const totalChangePercent = startEquity ? (totalChange / startEquity) * 100 : 0;
  const ConnectionIcon =
    connection.status === 'connected' ? Cloud : connection.status === 'error' ? TriangleAlert : CloudOff;

  return (
    <AppShell active="account" connection={connection}>
      <section className="mb-7 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs text-emerald-300">
            <ShieldCheck className="size-4" />
            Read-only workspace
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">Account & policy</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
            Monitor the competition ledger and prepare the limits the risk manager will enforce later.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-white/7 bg-white/[0.025] px-4 py-3">
          <span className="grid size-9 place-items-center rounded-lg bg-white/5 text-zinc-300">
            <ConnectionIcon className="size-4" />
          </span>
          <div>
            <p className="text-xs font-medium text-zinc-200">{connection.label}</p>
            <p className="mt-0.5 text-[11px] text-zinc-600">
              {loading ? 'Checking the paper account…' : connection.detail}
            </p>
          </div>
        </div>
      </section>

      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Account equity"
          value={currency.format(account.equity)}
          detail={`Competition start: ${currency.format(startEquity)}`}
        />
        <Stat
          label="Buying power"
          value={currency.format(account.buyingPower)}
          detail={snapshot.isMock ? 'Mock paper account' : 'Alpaca paper account'}
        />
        <Stat
          label="Today’s P&L"
          value={`${account.todayProfitLoss >= 0 ? '+' : ''}${currency.format(account.todayProfitLoss)}`}
          detail={`${percent.format(account.todayProfitLossPercent)}% since prior close`}
        />
        <Stat
          label="Open risk"
          value={currency.format(account.openRisk)}
          detail={`${account.equity ? ((account.openRisk / account.equity) * 100).toFixed(2) : '0.00'}% of equity`}
        />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,.8fr)]">
        <Card className="border border-white/7 bg-[#0d1714] shadow-[0_24px_70px_rgba(0,0,0,.18)]">
          <CardHeader className="border-b border-white/7 pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-white">Daily account balance</CardTitle>
                <CardDescription className="mt-1">
                  One value per trading day · {snapshot.isMock ? 'mock history' : 'Alpaca portfolio history'}
                </CardDescription>
              </div>
              <div className="text-right">
                <p className="font-mono text-lg text-white">{currency.format(account.equity)}</p>
                <p className={totalChange >= 0 ? 'text-xs text-emerald-300' : 'text-xs text-rose-300'}>
                  {totalChange >= 0 ? '+' : ''}{currency.format(totalChange)} · {percent.format(totalChangePercent)}%
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-5">
            <ChartContainer config={chartConfig} className="h-[330px] w-full aspect-auto">
              <AreaChart data={equityHistory} margin={{ left: 4, right: 12, top: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6ee7b7" stopOpacity={0.22} />
                    <stop offset="90%" stopColor="#6ee7b7" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="rgba(255,255,255,.055)" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tickMargin={12} />
                <YAxis
                  domain={['dataMin - 300', 'dataMax + 200']}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`}
                  width={44}
                />
                <ChartTooltip
                  cursor={{ stroke: 'rgba(110,231,183,.3)' }}
                  content={
                    <ChartTooltipContent
                      indicator="line"
                      formatter={(value) => (
                        <div className="flex min-w-40 items-center justify-between gap-4">
                          <span className="text-zinc-500">Equity</span>
                          <span className="font-mono text-white">{currency.format(Number(value))}</span>
                        </div>
                      )}
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="equity"
                  stroke="#6ee7b7"
                  strokeWidth={2}
                  fill="url(#equityFill)"
                  activeDot={{ r: 4, fill: '#6ee7b7', stroke: '#0d1714', strokeWidth: 2 }}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <RiskPolicyPanel />
      </div>

      <div className="mt-5 flex items-center gap-2 rounded-xl border border-white/7 bg-white/[0.02] px-4 py-3 text-xs text-zinc-500">
        <WalletCards className="size-4 text-zinc-400" />
        {snapshot.isMock
          ? 'Connect a dedicated $100,000 Alpaca paper account to replace all representative data.'
          : `Connected read-only to paper account ${account.accountNumber ?? ''}.`}
      </div>
    </AppShell>
  );
}
