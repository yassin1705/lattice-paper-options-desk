export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(
    {
      enabled: false,
      environment: 'paper',
      method: 'alpaca_cli',
      managedBy: 'standalone_cli_runner',
      proposals: [],
      configured: true,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
