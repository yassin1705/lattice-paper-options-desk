const localHostnames = new Set(['localhost', '127.0.0.1', '::1']);

export function isLocalControlRequest(request: Request): boolean {
  // Cloudflare Tunnel forwards to localhost, so the origin URL alone looks
  // local. Its edge headers identify requests that came through the tunnel.
  if (
    request.headers.has('cf-connecting-ip') ||
    request.headers.has('cf-ray')
  ) {
    return false;
  }
  try {
    const forwardedHost = request.headers.get('x-forwarded-host');
    if (forwardedHost) {
      const hostname = forwardedHost.split(':')[0]?.trim().toLowerCase() ?? '';
      if (!localHostnames.has(hostname)) return false;
    }
    return localHostnames.has(new URL(request.url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function localControlRequiredResponse(
  request: Request,
): Response | null {
  if (isLocalControlRequest(request)) return null;
  return Response.json(
    {
      error:
        'This public demo is read-only. Open the dashboard on localhost to change agent settings.',
    },
    { status: 403, headers: { 'Cache-Control': 'no-store' } },
  );
}
