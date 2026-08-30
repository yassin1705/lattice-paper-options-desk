import { getRiskPolicyProvider } from '@/lib/agents/risk-manager/policy-provider';

export const dynamic = 'force-dynamic';

export async function GET() {
  const snapshot = await getRiskPolicyProvider().getPolicy();
  return Response.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PUT(request: Request) {
  try {
    const policy = await request.json();
    const snapshot = await getRiskPolicyProvider().updatePolicy(policy);
    return Response.json(snapshot, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : 'Risk policy is invalid.',
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
