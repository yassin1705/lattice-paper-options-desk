import Link from 'next/link';
import { Activity, CircleDollarSign, SlidersHorizontal } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { ConnectionStatus } from '@/lib/dashboard/types';

type AppShellProps = {
  active: 'account' | 'trades';
  children: React.ReactNode;
  connection?: {
    status: ConnectionStatus;
    label: string;
  };
};

const navigation = [
  { href: '/account', label: 'Account', id: 'account' as const, icon: SlidersHorizontal },
  { href: '/trades', label: 'Trades', id: 'trades' as const, icon: Activity },
];

export function AppShell({ active, children, connection }: AppShellProps) {
  const connected = connection?.status === 'connected';
  const errored = connection?.status === 'error';

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-white/7 bg-[#09110f]/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-8">
            <Link href="/account" className="flex items-center gap-2.5" aria-label="Lattice home">
              <span className="grid size-9 place-items-center rounded-xl border border-emerald-300/20 bg-emerald-300/10 text-emerald-300">
                <CircleDollarSign className="size-5" />
              </span>
              <div>
                <p className="text-sm font-semibold tracking-[0.18em] text-white">LATTICE</p>
                <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Paper options desk</p>
              </div>
            </Link>

            <nav className="hidden items-center gap-1 rounded-xl border border-white/7 bg-white/[0.025] p-1 sm:flex">
              {navigation.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    className={cn(
                      'flex h-8 items-center gap-2 rounded-lg px-3 text-xs font-medium transition-colors',
                      active === item.id
                        ? 'bg-white/9 text-white'
                        : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200',
                    )}
                  >
                    <Icon className="size-3.5" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div
            className={cn(
              'flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium',
              connected
                ? 'border-emerald-300/15 bg-emerald-300/[0.06] text-emerald-200'
                : errored
                  ? 'border-rose-300/15 bg-rose-300/[0.06] text-rose-200'
                  : 'border-amber-300/15 bg-amber-300/[0.06] text-amber-200',
            )}
          >
            <span
              className={cn(
                'size-1.5 rounded-full',
                connected ? 'bg-emerald-300' : errored ? 'bg-rose-300' : 'bg-amber-300',
              )}
            />
            {connection?.label ?? 'Mock mode'}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 py-7 sm:px-6 lg:px-8">{children}</main>

      <nav className="fixed inset-x-4 bottom-4 z-40 flex items-center justify-center gap-1 rounded-2xl border border-white/10 bg-[#0d1714]/95 p-1.5 shadow-2xl backdrop-blur sm:hidden">
        {navigation.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.id}
              href={item.href}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-xl py-2 text-xs font-medium',
                active === item.id ? 'bg-white/10 text-white' : 'text-zinc-500',
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
