import { getDashboardProvider, snapshotWithConnectionError } from '@/lib/dashboard/provider';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const snapshot = await getDashboardProvider().getSnapshot();
    return Response.json(snapshot, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return Response.json(snapshotWithConnectionError('Check the paper account credentials.'), {
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
