import {
  getNewsStrategySettingsProvider,
  type NewsSourceStatus,
  type NewsStrategySettingsSnapshot,
  type NewsStrategySettingsView,
  type OllamaConnectionStatus,
} from '@/lib/agents/news/settings';
import { getLocalRunnerProcess } from '@/lib/agents/orchestration/local-runner-process';
import { getTechnicalStrategySettings } from '@/lib/agents/orchestration/technical-strategy-settings';
import { localControlRequiredResponse } from '@/lib/security/local-control';

export const dynamic = 'force-dynamic';

async function ollamaStatus(
  modelName: string,
): Promise<OllamaConnectionStatus> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_500);
  try {
    const baseUrl = (
      process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'
    ).replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/api/tags`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = (await response.json()) as {
      models?: Array<{ name?: string; model?: string }>;
    };
    const available = (payload.models ?? []).some(
      (model) => model.name === modelName || model.model === modelName,
    );
    return available
      ? {
          status: 'connected',
          modelName,
          detail: 'Local Ollama is ready for automatic news analysis.',
        }
      : {
          status: 'model_missing',
          modelName,
          detail: `Ollama is connected, but ${modelName} is not installed.`,
        };
  } catch {
    return {
      status: 'unavailable',
      modelName,
      detail: 'Local Ollama is not reachable.',
    };
  } finally {
    clearTimeout(timeout);
  }
}

function sourceStatus(): NewsSourceStatus[] {
  return [
    {
      sourceId: 'alpaca',
      label: 'Alpaca News',
      configured: Boolean(
        process.env.ALPACA_API_KEY && process.env.ALPACA_SECRET_KEY,
      ),
      detail: 'Uses the existing Alpaca credentials.',
    },
    {
      sourceId: 'google_news',
      label: 'Google News RSS',
      configured: true,
      detail: 'Public ticker and company search feed.',
    },
    {
      sourceId: 'official_company',
      label: 'Company newsroom',
      configured: true,
      detail: 'Official feeds are used when configured for a stock.',
    },
    {
      sourceId: 'finnhub',
      label: 'Finnhub',
      configured: Boolean(process.env.FINNHUB_API_KEY),
      detail: process.env.FINNHUB_API_KEY
        ? 'API key configured.'
        : 'Optional API key not configured.',
    },
    {
      sourceId: 'alpha_vantage',
      label: 'Alpha Vantage',
      configured: Boolean(process.env.ALPHA_VANTAGE_API_KEY),
      detail: process.env.ALPHA_VANTAGE_API_KEY
        ? 'API key configured.'
        : 'Optional API key not configured.',
    },
    {
      sourceId: 'gdelt',
      label: 'GDELT',
      configured: process.env.GDELT_NEWS_ENABLED === 'true',
      detail:
        process.env.GDELT_NEWS_ENABLED === 'true'
          ? 'Public global-news endpoint enabled.'
          : 'Disabled because the public endpoint can be slow.',
    },
  ];
}

async function view(
  snapshot: NewsStrategySettingsSnapshot,
): Promise<NewsStrategySettingsView> {
  return {
    ...snapshot,
    ollama: await ollamaStatus(snapshot.settings.modelName),
    sources: sourceStatus(),
  };
}

export async function GET() {
  const snapshot = await getNewsStrategySettingsProvider().getSettings();
  return Response.json(await view(snapshot), {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function PUT(request: Request) {
  const controlError = localControlRequiredResponse(request);
  if (controlError) return controlError;
  try {
    const settings = await request.json();
    const snapshot =
      await getNewsStrategySettingsProvider().updateSettings(settings);
    const runner = getLocalRunnerProcess();
    if (
      snapshot.settings.enabled &&
      process.env.ALPACA_API_KEY &&
      process.env.ALPACA_SECRET_KEY
    ) {
      await runner.start();
    } else if (
      !snapshot.settings.enabled &&
      !getTechnicalStrategySettings().get().enabled
    ) {
      await runner.stop();
    }
    return Response.json(await view(snapshot), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'News strategy settings are invalid.',
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
