'use client';

import { useEffect, useState } from 'react';
import { Check, Clock3, Plus, Search, Settings2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import type { TradableAsset } from '@/lib/dashboard/types';

type PolicyDraft = {
  profile: string;
  maxTradeLoss: string;
  dailyLossLimit: string;
  horizon: string;
  requireConfirmation: boolean;
  watchlist: string[];
};

const defaultPolicy: PolicyDraft = {
  profile: 'conservative',
  maxTradeLoss: '0.25',
  dailyLossLimit: '0.75',
  horizon: '2-5',
  requireConfirmation: true,
  watchlist: ['SPY', 'QQQ', 'GLD'],
};

export function RiskPolicyPanel() {
  const [policy, setPolicy] = useState(defaultPolicy);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TradableAsset[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem('lattice-policy-draft');
    if (stored) {
      try {
        setPolicy({ ...defaultPolicy, ...(JSON.parse(stored) as Partial<PolicyDraft>) });
      } catch {
        window.localStorage.removeItem('lattice-policy-draft');
      }
    }
  }, []);

  async function searchAssets() {
    const response = await fetch(`/api/assets?q=${encodeURIComponent(query)}`);
    const payload = (await response.json()) as { assets: TradableAsset[] };
    setResults(payload.assets.filter((asset) => !policy.watchlist.includes(asset.symbol)));
  }

  function addAsset(symbol: string) {
    setPolicy((current) => ({ ...current, watchlist: [...current.watchlist, symbol] }));
    setResults((current) => current.filter((asset) => asset.symbol !== symbol));
  }

  function removeAsset(symbol: string) {
    setPolicy((current) => ({
      ...current,
      watchlist: current.watchlist.filter((item) => item !== symbol),
    }));
  }

  function savePolicy() {
    window.localStorage.setItem('lattice-policy-draft', JSON.stringify(policy));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  return (
    <Card className="border border-white/7 bg-[#0d1714]">
      <CardHeader className="border-b border-white/7 pb-4">
        <CardTitle className="flex items-center gap-2 text-white">
          <Settings2 className="size-4 text-emerald-300" />
          Risk policy draft
        </CardTitle>
        <CardDescription className="mt-1">Saved locally for this device</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        <label className="block space-y-2">
          <span className="text-xs font-medium text-zinc-300">Risk profile</span>
          <NativeSelect
            className="w-full"
            value={policy.profile}
            onChange={(event) => setPolicy({ ...policy, profile: event.target.value })}
          >
            <NativeSelectOption value="conservative">Conservative</NativeSelectOption>
            <NativeSelectOption value="moderate">Moderate</NativeSelectOption>
            <NativeSelectOption value="experimental">Experimental</NativeSelectOption>
          </NativeSelect>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-2">
            <span className="text-xs font-medium text-zinc-300">Max trade loss</span>
            <div className="relative">
              <Input
                value={policy.maxTradeLoss}
                onChange={(event) => setPolicy({ ...policy, maxTradeLoss: event.target.value })}
                className="pr-7 font-mono"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-600">%</span>
            </div>
          </label>
          <label className="space-y-2">
            <span className="text-xs font-medium text-zinc-300">Daily loss limit</span>
            <div className="relative">
              <Input
                value={policy.dailyLossLimit}
                onChange={(event) => setPolicy({ ...policy, dailyLossLimit: event.target.value })}
                className="pr-7 font-mono"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-600">%</span>
            </div>
          </label>
        </div>

        <label className="block space-y-2">
          <span className="text-xs font-medium text-zinc-300">Holding horizon</span>
          <NativeSelect
            className="w-full"
            value={policy.horizon}
            onChange={(event) => setPolicy({ ...policy, horizon: event.target.value })}
          >
            <NativeSelectOption value="intraday">Intraday</NativeSelectOption>
            <NativeSelectOption value="2-5">2–5 trading days</NativeSelectOption>
            <NativeSelectOption value="1-4w">1–4 weeks</NativeSelectOption>
          </NativeSelect>
        </label>

        <div className="space-y-2">
          <span className="text-xs font-medium text-zinc-300">Approved underlyings</span>
          <div className="flex flex-wrap gap-2">
            {policy.watchlist.map((symbol) => (
              <button
                key={symbol}
                type="button"
                onClick={() => removeAsset(symbol)}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-300/15 bg-emerald-300/[0.06] px-2.5 py-1.5 font-mono text-xs text-emerald-200"
              >
                {symbol}
                <X className="size-3" />
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && searchAssets()}
                placeholder="Search Alpaca assets"
                className="pl-8"
              />
            </div>
            <Button type="button" variant="outline" onClick={searchAssets} aria-label="Search assets">
              <Search className="size-4" />
            </Button>
          </div>
          {results.length > 0 && (
            <div className="max-h-40 overflow-auto rounded-xl border border-white/7 bg-[#09110f] p-1">
              {results.map((asset) => (
                <button
                  key={asset.symbol}
                  type="button"
                  onClick={() => addAsset(asset.symbol)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-white/5"
                >
                  <span>
                    <span className="font-mono text-xs text-zinc-200">{asset.symbol}</span>
                    <span className="ml-2 text-xs text-zinc-600">{asset.name}</span>
                  </span>
                  <Plus className="size-3.5 text-emerald-300" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between rounded-xl border border-white/7 bg-white/[0.02] p-3.5">
          <div>
            <p className="text-xs font-medium text-zinc-200">Require confirmation</p>
            <p className="mt-1 text-[11px] text-zinc-600">Prepared for the execution milestone</p>
          </div>
          <Switch
            checked={policy.requireConfirmation}
            onCheckedChange={(checked) => setPolicy({ ...policy, requireConfirmation: checked })}
            aria-label="Require confirmation"
          />
        </div>

        <Button onClick={savePolicy} className="w-full bg-emerald-300 text-emerald-950 hover:bg-emerald-200">
          <Check className="size-4" />
          {saved ? 'Policy saved' : 'Save policy draft'}
        </Button>

        <div className="flex items-center gap-2 text-[11px] text-zinc-600">
          <Clock3 className="size-3.5" />
          Changes will not affect trading in this milestone.
        </div>
      </CardContent>
    </Card>
  );
}
