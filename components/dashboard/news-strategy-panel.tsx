'use client';

import { useEffect, useState } from 'react';
import { Bot, Check, Clock3, Cpu, Plus, Search, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  defaultNewsStrategySettings,
  type NewsStrategySettings,
  type NewsStrategySettingsView,
} from '@/lib/agents/news/settings';
import type { TradableAsset } from '@/lib/dashboard/types';
import { cn } from '@/lib/utils';

const suggestedSymbols = ['NVDA', 'AAPL', 'MSFT', 'AMZN', 'META'];

function statusTone(status: NewsStrategySettingsView['ollama']['status']) {
  return status === 'connected'
    ? 'bg-emerald-300'
    : status === 'model_missing'
      ? 'bg-amber-300'
      : 'bg-rose-300';
}

export function NewsStrategyPanel() {
  const [view, setView] = useState<NewsStrategySettingsView | null>(null);
  const [settings, setSettings] = useState<NewsStrategySettings>(() =>
    structuredClone(defaultNewsStrategySettings),
  );
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TradableAsset[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const response = await fetch('/api/news-strategy', {
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Could not load news settings.');
      const payload = (await response.json()) as NewsStrategySettingsView;
      setView(payload);
      setSettings(payload.settings);
      setError(null);
    } catch {
      setError('The local news-strategy service is unavailable.');
    }
  }

  useEffect(() => {
    const refresh = () => void load();
    queueMicrotask(refresh);
    const interval = window.setInterval(refresh, 15_000);
    return () => window.clearInterval(interval);
  }, []);

  async function persist(next: NewsStrategySettings) {
    setSaving(true);
    setSettings(next);
    setError(null);
    try {
      const response = await fetch('/api/news-strategy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      const payload = (await response.json()) as
        | NewsStrategySettingsView
        | { error: string };
      if (!response.ok || !('settings' in payload)) {
        throw new Error(
          'error' in payload ? payload.error : 'Could not save news settings.',
        );
      }
      setView(payload);
      setSettings(payload.settings);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1_500);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not save news settings.',
      );
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function searchAssets() {
    const response = await fetch(`/api/assets?q=${encodeURIComponent(query)}`);
    const payload = (await response.json()) as { assets: TradableAsset[] };
    setResults(
      payload.assets.filter(
        (asset) => !settings.symbols.includes(asset.symbol),
      ),
    );
  }

  function addSymbol(symbol: string) {
    if (settings.symbols.includes(symbol)) return;
    void persist({ ...settings, symbols: [...settings.symbols, symbol] });
    setResults((current) => current.filter((item) => item.symbol !== symbol));
  }

  function removeSymbol(symbol: string) {
    if (settings.symbols.length <= 1) return;
    void persist({
      ...settings,
      symbols: settings.symbols.filter((item) => item !== symbol),
    });
  }

  const modelStatus = view?.ollama.status ?? 'unavailable';
  const remainingSuggestions = suggestedSymbols.filter(
    (symbol) => !settings.symbols.includes(symbol),
  );

  return (
    <Card className="border border-white/7 bg-[#0d1714]">
      <CardHeader className="border-b border-white/7 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-white">
              <Bot className="size-4 text-sky-300" />
              News strategy
            </CardTitle>
            <CardDescription className="mt-1">
              Independent low-frequency LLM decisions
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-zinc-400">
              {settings.enabled ? 'Enabled' : 'Disabled'}
            </span>
            <Switch
              aria-label="Enable automatic news strategy"
              checked={settings.enabled}
              disabled={saving || !view}
              onCheckedChange={(enabled) =>
                void persist({ ...settings, enabled })
              }
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        <div className="rounded-xl border border-white/7 bg-white/[0.025] p-3">
          <div className="flex items-start gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/5 text-zinc-300">
              <Cpu className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-medium text-zinc-200">
                  Ollama · {settings.modelName}
                </p>
                <Badge
                  variant="outline"
                  className="border-white/8 bg-white/[0.025] text-[10px] text-zinc-400"
                >
                  <span
                    className={cn(
                      'size-1.5 rounded-full',
                      statusTone(modelStatus),
                    )}
                  />
                  {modelStatus === 'connected'
                    ? 'Ready'
                    : modelStatus === 'model_missing'
                      ? 'Model missing'
                      : 'Offline'}
                </Badge>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-zinc-600">
                {view?.ollama.detail ?? 'Checking the local model…'}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/7 bg-white/[0.02] p-3">
            <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">
              Frequency
            </p>
            <p className="mt-1 font-mono text-sm text-zinc-200">
              Every {settings.frequencyMinutes / 60} hours
            </p>
          </div>
          <div className="rounded-xl border border-white/7 bg-white/[0.02] p-3">
            <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">
              Lookback
            </p>
            <p className="mt-1 font-mono text-sm text-zinc-200">
              {settings.lookbackHours} hours
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-zinc-300">
              News stocks
            </span>
            <span className="text-[10px] text-zinc-600">
              {settings.symbols.length}/20
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {settings.symbols.map((symbol) => (
              <button
                key={symbol}
                type="button"
                disabled={saving || settings.symbols.length <= 1}
                onClick={() => removeSymbol(symbol)}
                className="flex items-center gap-1.5 rounded-lg border border-sky-300/15 bg-sky-300/[0.06] px-2.5 py-1.5 font-mono text-xs text-sky-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {symbol}
                <X className="size-3" />
              </button>
            ))}
          </div>

          {remainingSuggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="mr-1 text-[10px] text-zinc-600">Suggested</span>
              {remainingSuggestions.map((symbol) => (
                <button
                  key={symbol}
                  type="button"
                  disabled={saving}
                  onClick={() => addSymbol(symbol)}
                  className="rounded-md border border-white/7 bg-white/[0.02] px-2 py-1 font-mono text-[10px] text-zinc-500 hover:text-zinc-200"
                >
                  + {symbol}
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) =>
                  event.key === 'Enter' && void searchAssets()
                }
                placeholder="Search optionable stocks"
                className="pl-8"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void searchAssets()}
              aria-label="Search news stocks"
            >
              <Search className="size-4" />
            </Button>
          </div>
          {results.length > 0 && (
            <div className="max-h-36 overflow-auto rounded-xl border border-white/7 bg-[#09110f] p-1">
              {results.map((asset) => (
                <button
                  key={asset.symbol}
                  type="button"
                  disabled={saving}
                  onClick={() => addSymbol(asset.symbol)}
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
                  <Plus className="size-3.5 text-sky-300" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <span className="text-xs font-medium text-zinc-300">Sources</span>
          <div className="flex flex-wrap gap-1.5">
            {(view?.sources ?? []).map((source) => (
              <span
                key={source.sourceId}
                title={source.detail}
                className="flex items-center gap-1.5 rounded-full border border-white/7 bg-white/[0.02] px-2 py-1 text-[10px] text-zinc-500"
              >
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    source.configured ? 'bg-emerald-300' : 'bg-zinc-700',
                  )}
                />
                {source.label}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-start gap-2 text-[11px] leading-4 text-zinc-600">
          {saved ? (
            <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-300" />
          ) : (
            <Clock3 className="mt-0.5 size-3.5 shrink-0" />
          )}
          {saved
            ? 'Configuration updated.'
            : settings.enabled
              ? 'News analysis is enabled and repeats automatically on schedule.'
              : 'Enabling the strategy starts its local scheduled runner automatically.'}
        </div>
        {error && <p className="text-xs text-rose-300">{error}</p>}
      </CardContent>
    </Card>
  );
}
