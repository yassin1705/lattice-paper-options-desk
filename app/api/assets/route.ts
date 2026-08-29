import { getDashboardProvider } from '@/lib/dashboard/provider';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q') ?? '';

  try {
    const assets = await getDashboardProvider().searchAssets(query);
    return Response.json({ assets }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ assets: [] }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
