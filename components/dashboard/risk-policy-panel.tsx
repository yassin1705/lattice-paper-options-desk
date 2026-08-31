'use client';

import { useEffect, useState } from 'react';
import { Check, Clock3, Plus, Search, Settings2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  defaultRiskPolicy,
  type HoldingHorizon,
  type RiskPolicy,
  type RiskPolicySnapshot,
  type RiskProfile,
} from '@/lib/agents/risk-manager/policy';
import type { TradableAsset } from '@/lib/dashboard/types';

export function RiskPolicyPanel() {
  const [policy, setPolicy] = useState<RiskPolicy>(() =>
    structuredClone(defaultRiskPolicy),
  );
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TradableAsset[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState<number | null>(null);

  useEffect(() => {
    async function loadPolicy() {
      try {
        const response = await fetch('/api/risk-policy', { cache: 'no-store' });
        if (!response.ok) throw new Error('Could not load the risk policy.');
        const snapshot = (await response.json()) as RiskPolicySnapshot;
        setPolicy(snapshot.policy);
        setRevision(snapshot.revision);
      } catch {
        setError(
          'Using safe defaults because the risk-policy service is unavailable.',
        );
      }
    }
    void loadPolicy();
  }, []);

  async function searchAssets() {
    const response = await fetch(`/api/assets?q=${encodeURIComponent(query)}`);
    const payload = (await response.json()) as { assets: TradableAsset[] };
    setResults(
      payload.assets.filter(
        (asset) => !policy.approvedUnderlyings.includes(asset.symbol),
      ),
    );
  }

  function addAsset(symbol: string) {
    setPolicy((current) => ({
      ...current,
      approvedUnderlyings: [...current.approvedUnderlyings, symbol],
    }));
    setResults((current) => current.filter((asset) => asset.symbol !== symbol));
  }

  function removeAsset(symbol: string) {
    setPolicy((current) => ({
      ...current,
      approvedUnderlyings: current.approvedUnderlyings.filter(
        (item) => item !== symbol,
      ),
    }));
  }

  async function savePolicy() {
    setError(null);
    const response = await fetch('/api/risk-policy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(policy),
    });
    const payload = (await response.json()) as
      | RiskPolicySnapshot
      | { error: string };
    if (!response.ok || !('policy' in payload)) {
      setError(
        'error' in payload ? payload.error : 'Could not save the risk policy.',
      );
      return;
    }
    setPolicy(payload.policy);
    setRevision(payload.revision);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1_800);
  }

  return (
    <Card className="border border-white/7 bg-[#0d1714]">
      <CardHeader className="border-b border-white/7 pb-4">
        <CardTitle className="flex items-center gap-2 text-white">
          <Settings2 className="size-4 text-emerald-300" />
          Active risk policy
        </CardTitle>
        <CardDescription className="mt-1">
          {revision ? `In-memory revision ${revision}` : 'Loading policy'} ·
          resets on server restart
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        <label htmlFor="risk-profile" className="block space-y-2">
          <span className="text-xs font-medium text-zinc-300">
            Risk profile
          </span>
          <NativeSelect
            id="risk-profile"
            className="w-full"
            value={policy.profile}
            onChange={(event) =>
              setPolicy({
                ...policy,
                profile: event.target.value as RiskProfile,
              })
            }
          >
            <NativeSelectOption value="conservative">
              Conservative
            </NativeSelectOption>
            <NativeSelectOption value="moderate">Moderate</NativeSelectOption>
            <NativeSelectOption value="experimental">
              Experimental
            </NativeSelectOption>
          </NativeSelect>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label htmlFor="maximum-trade-risk" className="space-y-2">
            <span className="text-xs font-medium text-zinc-300">
              Max trade loss
            </span>
            <div className="relative">
              <Input
                id="maximum-trade-risk"
                type="number"
                min="0.01"
                step="0.01"
                value={policy.sizing.maximumRiskPerTradePercent}
                onChange={(event) =>
                  setPolicy({
                    ...policy,
                    sizing: {
                      ...policy.sizing,
                      maximumRiskPerTradePercent: Number(event.target.value),
                    },
                  })
                }
                className="pr-7 font-mono"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-600">
                %
              </span>
            </div>
          </label>
          <label htmlFor="daily-loss-limit" className="space-y-2">
            <span className="text-xs font-medium text-zinc-300">
              Daily loss limit
            </span>
            <div className="relative">
              <Input
                id="daily-loss-limit"
                type="number"
                min="0.01"
                step="0.01"
                value={policy.dailyLossLimitPercent}
                onChange={(event) =>
                  setPolicy({
                    ...policy,
                    dailyLossLimitPercent: Number(event.target.value),
                  })
                }
                className="pr-7 font-mono"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-600">
                %
              </span>
            </div>
          </label>
        </div>

        <label htmlFor="holding-horizon" className="block space-y-2">
          <span className="text-xs font-medium text-zinc-300">
            Holding horizon
          </span>
          <NativeSelect
            id="holding-horizon"
            className="w-full"
            value={policy.holdingHorizon}
            onChange={(event) =>
              setPolicy({
                ...policy,
                holdingHorizon: event.target.value as HoldingHorizon,
              })
            }
          >
            <NativeSelectOption value="intraday">Intraday</NativeSelectOption>
            <NativeSelectOption value="swing">
              2–5 trading days
            </NativeSelectOption>
            <NativeSelectOption value="position">1–4 weeks</NativeSelectOption>
          </NativeSelect>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label htmlFor="minimum-signal-strength" className="space-y-2">
            <span className="text-xs font-medium text-zinc-300">
              Minimum signal
            </span>
            <Input
              id="minimum-signal-strength"
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={policy.entry.minimumSignalStrength}
              onChange={(event) =>
                setPolicy({
                  ...policy,
                  entry: {
                    ...policy.entry,
                    minimumSignalStrength: Number(event.target.value),
                  },
                })
              }
              className="font-mono"
            />
          </label>
          <label htmlFor="maximum-open-positions" className="space-y-2">
            <span className="text-xs font-medium text-zinc-300">
              Max open positions
            </span>
            <Input
              id="maximum-open-positions"
              type="number"
              min="1"
              step="1"
              value={policy.entry.maximumOpenPositions}
              onChange={(event) =>
                setPolicy({
                  ...policy,
                  entry: {
                    ...policy.entry,
                    maximumOpenPositions: Number(event.target.value),
                  },
                })
              }
              className="font-mono"
            />
          </label>
          <label htmlFor="position-stop-loss" className="space-y-2">
            <span className="text-xs font-medium text-zinc-300">Stop loss</span>
            <div className="relative">
              <Input
                id="position-stop-loss"
                type="number"
                min="0.01"
                step="1"
                value={policy.exit.stopLossPercent}
                onChange={(event) =>
                  setPolicy({
                    ...policy,
                    exit: {
                      ...policy.exit,
                      stopLossPercent: Number(event.target.value),
                    },
                  })
                }
                className="pr-7 font-mono"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-600">
                %
              </span>
            </div>
          </label>
          <label htmlFor="position-take-profit" className="space-y-2">
            <span className="text-xs font-medium text-zinc-300">
              Take profit
            </span>
            <div className="relative">
              <Input
                id="position-take-profit"
                type="number"
                min="0.01"
                step="1"
                value={policy.exit.takeProfitPercent}
                onChange={(event) =>
                  setPolicy({
                    ...policy,
                    exit: {
                      ...policy.exit,
                      takeProfitPercent: Number(event.target.value),
                    },
                  })
                }
                className="pr-7 font-mono"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-600">
                %
              </span>
            </div>
          </label>
          <label htmlFor="maximum-contract-spread" className="space-y-2">
            <span className="text-xs font-medium text-zinc-300">
              Maximum spread
            </span>
            <div className="relative">
              <Input
                id="maximum-contract-spread"
                type="number"
                min="0.01"
                step="0.5"
                value={policy.contract.maximumSpreadPercent}
                onChange={(event) =>
                  setPolicy({
                    ...policy,
                    contract: {
                      ...policy.contract,
                      maximumSpreadPercent: Number(event.target.value),
                    },
                  })
                }
                className="pr-7 font-mono"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-600">
                %
              </span>
            </div>
          </label>
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-zinc-300">
              Expiration range
            </legend>
            <div className="flex items-center gap-2">
              <Input
                aria-label="Minimum days to expiration"
                type="number"
                min="1"
                value={policy.contract.minimumDaysToExpiration}
                onChange={(event) =>
                  setPolicy({
                    ...policy,
                    contract: {
                      ...policy.contract,
                      minimumDaysToExpiration: Number(event.target.value),
                    },
                  })
                }
                className="font-mono"
              />
              <span className="text-xs text-zinc-600">to</span>
              <Input
                aria-label="Maximum days to expiration"
                type="number"
                min="1"
                value={policy.contract.maximumDaysToExpiration}
                onChange={(event) =>
                  setPolicy({
                    ...policy,
                    contract: {
                      ...policy.contract,
                      maximumDaysToExpiration: Number(event.target.value),
                    },
                  })
                }
                className="font-mono"
              />
            </div>
          </fieldset>
        </div>

        <div className="space-y-2">
          <span className="text-xs font-medium text-zinc-300">
            Approved underlyings
          </span>
          <div className="flex flex-wrap gap-2">
            {policy.approvedUnderlyings.map((symbol) => (
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
            <Button
              type="button"
              variant="outline"
              onClick={searchAssets}
              aria-label="Search assets"
            >
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
                    <span className="font-mono text-xs text-zinc-200">
                      {asset.symbol}
                    </span>
                    <span className="ml-2 text-xs text-zinc-600">
                      {asset.name}
                    </span>
                  </span>
                  <Plus className="size-3.5 text-emerald-300" />
                </button>
              ))}
            </div>
          )}
        </div>

        <Button
          onClick={savePolicy}
          className="w-full bg-emerald-300 text-emerald-950 hover:bg-emerald-200"
        >
          <Check className="size-4" />
          {saved ? 'Policy active' : 'Save active policy'}
        </Button>

        <div className="flex items-center gap-2 text-[11px] text-zinc-600">
          <Clock3 className="size-3.5" />
          The autonomous pipeline uses this revision on its next scan.
        </div>
        {error && <p className="text-xs text-red-300">{error}</p>}
      </CardContent>
    </Card>
  );
}
