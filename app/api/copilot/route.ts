import type { CopilotResponse } from '@/lib/agents/copilot/types';
import { getLocalRunnerProcess } from '@/lib/agents/orchestration/local-runner-process';
import { isLocalControlRequest } from '@/lib/security/local-control';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      sessionId?: unknown;
      message?: unknown;
    };
    if (typeof body.message !== 'string' || !body.message.trim()) {
      return Response.json(
        { error: 'Enter a message first.' },
        { status: 400 },
      );
    }
    const result = await getLocalRunnerProcess().copilot<CopilotResponse>({
      sessionId:
        typeof body.sessionId === 'string' ? body.sessionId : undefined,
      message: body.message.trim(),
      executionAllowed: isLocalControlRequest(request),
    });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : 'Trading copilot failed.',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
