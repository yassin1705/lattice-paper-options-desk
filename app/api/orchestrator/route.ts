import { getAutonomousOrchestratorService } from '@/lib/agents/orchestration/autonomous-orchestrator-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const service = getAutonomousOrchestratorService();
  return Response.json(
    service
      ? { configured: true, ...service.status() }
      : {
          configured: false,
          busy: false,
          mode: 'dashboard_analysis',
          executionMode: 'alpaca_cli_runner',
          error: 'Alpaca paper credentials are not configured.',
        },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  const service = getAutonomousOrchestratorService();
  if (!service) {
    return Response.json(
      { error: 'Alpaca paper credentials are not configured.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  try {
    const body = (await request.json()) as { action?: unknown };
    if (body.action !== 'test') {
      return Response.json(
        {
          error:
            'Dashboard execution is disabled. Start and stop the standalone Alpaca CLI runner outside the dashboard.',
        },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const status = await service.runSafeTest();
    return Response.json(status, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Action failed.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
