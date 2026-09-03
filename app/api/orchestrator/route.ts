import { getAutonomousOrchestratorService } from '@/lib/agents/orchestration/autonomous-orchestrator-service';
import { getLocalRunnerProcess } from '@/lib/agents/orchestration/local-runner-process';
import { getTechnicalStrategySettings } from '@/lib/agents/orchestration/technical-strategy-settings';
import { getNewsStrategySettingsProvider } from '@/lib/agents/news/settings';
import { localControlRequiredResponse } from '@/lib/security/local-control';

export const dynamic = 'force-dynamic';

export async function GET() {
  const service = getAutonomousOrchestratorService();
  const runner = await getLocalRunnerProcess().status();
  const technicalStrategy = getTechnicalStrategySettings().get();
  return Response.json(
    service
      ? { configured: true, ...service.status(), runner, technicalStrategy }
      : {
          configured: false,
          busy: false,
          mode: 'dashboard_analysis',
          executionMode: 'alpaca_cli_runner',
          runner,
          technicalStrategy,
          error: 'Alpaca paper credentials are not configured.',
        },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  const controlError = localControlRequiredResponse(request);
  if (controlError) return controlError;
  const service = getAutonomousOrchestratorService();
  if (!service) {
    return Response.json(
      { error: 'Alpaca paper credentials are not configured.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  try {
    const body = (await request.json()) as { action?: unknown };
    if (body.action === 'start' || body.action === 'stop') {
      const runner = getLocalRunnerProcess();
      const technicalSettings = getTechnicalStrategySettings();
      const technicalStrategy = technicalSettings.setEnabled(
        body.action === 'start',
      );
      let runnerStatus;
      if (body.action === 'start') {
        runnerStatus = await runner.start();
      } else {
        const news = await getNewsStrategySettingsProvider().getSettings();
        runnerStatus = news.settings.enabled
          ? await runner.status()
          : await runner.stop();
      }
      return Response.json(
        {
          configured: true,
          ...service.status(),
          runner: runnerStatus,
          technicalStrategy,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (body.action !== 'test') {
      return Response.json(
        {
          error: 'Unknown agent action.',
        },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const status = await service.runSafeTest();
    return Response.json(
      {
        ...status,
        runner: await getLocalRunnerProcess().status(),
        technicalStrategy: getTechnicalStrategySettings().get(),
      },
      {
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Action failed.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
