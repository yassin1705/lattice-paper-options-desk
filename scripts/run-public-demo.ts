import { spawn, type ChildProcess } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { config as loadEnvironment } from 'dotenv';

loadEnvironment({ path: '.env', quiet: true });
loadEnvironment({ path: '.env.local', override: true, quiet: true });

const isWindows = process.platform === 'win32';
const npmCli = process.env.npm_execpath;
const defaultCloudflared = isWindows
  ? join(process.cwd(), '.tools', 'cloudflared', 'cloudflared.exe')
  : 'cloudflared';
const cloudflaredCommand = process.env.CLOUDFLARED_PATH ?? defaultCloudflared;
const dashboardOrigin = 'http://127.0.0.1:3000';
const healthUrl = 'http://127.0.0.1:3000/api/orchestrator';
const lockPath = join(process.cwd(), '.data', 'public-demo.lock');
let closing = false;
let dashboard: ChildProcess | null = null;
let tunnel: ChildProcess | null = null;
let dashboardRestart: NodeJS.Timeout | null = null;
let tunnelRestart: NodeJS.Timeout | null = null;
let healthMonitor: NodeJS.Timeout | null = null;

function processIsRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'EPERM'
    );
  }
}

function acquireInstanceLock(): () => void {
  mkdirSync(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = openSync(lockPath, 'wx');
      try {
        writeFileSync(
          descriptor,
          JSON.stringify({
            pid: process.pid,
            startedAt: new Date().toISOString(),
          }),
          'utf8',
        );
      } finally {
        closeSync(descriptor);
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        try {
          const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
            pid?: unknown;
          };
          if (lock.pid === process.pid) unlinkSync(lockPath);
        } catch {
          // The lock was already removed or replaced.
        }
      };
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        (error as NodeJS.ErrnoException).code !== 'EEXIST'
      ) {
        throw error;
      }
      let ownerPid = 0;
      try {
        const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
          pid?: unknown;
        };
        ownerPid = Number(lock.pid);
      } catch {
        // An unreadable lock is treated as stale.
      }
      if (processIsRunning(ownerPid)) {
        throw new Error(
          `The public demo is already running in process ${ownerPid}. Stop it before starting another instance.`,
        );
      }
      try {
        unlinkSync(lockPath);
      } catch {
        // A concurrent process may have replaced the stale lock.
      }
    }
  }
  throw new Error('The public demo lock could not be acquired.');
}

function startDashboard(): void {
  const command = npmCli ? process.execPath : 'npm';
  const arguments_ = npmCli ? [npmCli, 'run', 'dev'] : ['run', 'dev'];
  dashboardRestart = null;
  dashboard = spawn(command, arguments_, {
    cwd: process.cwd(),
    env: process.env,
    windowsHide: true,
    stdio: 'inherit',
  });
  dashboard.once('exit', (code) => {
    dashboard = null;
    if (closing) return;
    process.stderr.write(
      `Dashboard exited with code ${code ?? 'unknown'}; restarting in 3 seconds.\n`,
    );
    dashboardRestart = setTimeout(startDashboard, 3_000);
  });
}

async function waitForDashboard(): Promise<boolean> {
  for (let attempt = 1; attempt <= 90 && !closing; attempt += 1) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return true;
    } catch {
      // The local dashboard is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}

async function dashboardIsHealthy(): Promise<boolean> {
  try {
    const response = await fetch(healthUrl);
    return response.ok;
  } catch {
    return false;
  }
}

async function validateDashboardAssets(): Promise<void> {
  const assetUrls = new Set<string>();
  for (const path of ['/account', '/trades']) {
    const response = await fetch(`${dashboardOrigin}${path}`, {
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(
        `Dashboard validation failed: ${path} returned ${response.status}.`,
      );
    }
    const html = await response.text();
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const asset = new URL(match[1]!, dashboardOrigin);
      if (
        asset.origin === dashboardOrigin &&
        asset.pathname.startsWith('/_next/static/') &&
        /\.(?:css|js)$/.test(asset.pathname)
      ) {
        assetUrls.add(asset.toString());
      }
    }
  }
  const assets = [...assetUrls];
  if (
    !assets.some((asset) => new URL(asset).pathname.endsWith('.css')) ||
    !assets.some((asset) => new URL(asset).pathname.endsWith('.js'))
  ) {
    throw new Error(
      'Dashboard validation failed: the rendered pages did not reference both CSS and JavaScript assets.',
    );
  }
  const checks = await Promise.all(
    assets.map(async (asset) => ({
      asset,
      response: await fetch(asset, { cache: 'no-store' }),
    })),
  );
  const missing = checks.filter(({ response }) => !response.ok);
  if (missing.length > 0) {
    const details = missing
      .slice(0, 5)
      .map(
        ({ asset, response }) =>
          `${new URL(asset).pathname} (${response.status})`,
      )
      .join(', ');
    throw new Error(
      `Dashboard validation failed because built assets are missing: ${details}. Run a clean build before opening the tunnel.`,
    );
  }
}

function tunnelArguments(): string[] {
  const token = process.env.CLOUDFLARED_TUNNEL_TOKEN?.trim();
  return token
    ? ['--no-autoupdate', 'tunnel', 'run', '--token', token]
    : ['--no-autoupdate', 'tunnel', '--url', 'http://127.0.0.1:3000'];
}

async function startTunnel(): Promise<void> {
  if (!(await waitForDashboard()) || closing) {
    if (!closing) process.stderr.write('Dashboard health check timed out.\n');
    return;
  }
  await validateDashboardAssets();
  tunnel = spawn(cloudflaredCommand, tunnelArguments(), {
    cwd: process.cwd(),
    env: process.env,
    windowsHide: true,
    stdio: 'inherit',
  });
  tunnel.once('error', (error) => {
    process.stderr.write(
      `Cloudflare Tunnel could not start: ${error.message}\n`,
    );
  });
  tunnel.once('exit', (code) => {
    tunnel = null;
    if (closing) return;
    process.stderr.write(
      `Cloudflare Tunnel exited with code ${code ?? 'unknown'}; restarting in 5 seconds.\n`,
    );
    tunnelRestart = setTimeout(() => void startTunnel(), 5_000);
  });
}

function close(): void {
  if (closing) return;
  closing = true;
  if (dashboardRestart) clearTimeout(dashboardRestart);
  if (tunnelRestart) clearTimeout(tunnelRestart);
  if (healthMonitor) clearInterval(healthMonitor);
  tunnel?.kill('SIGTERM');
  dashboard?.kill('SIGTERM');
  releaseInstanceLock();
}

async function main(): Promise<void> {
  if (await dashboardIsHealthy()) {
    process.stdout.write(
      'Using the healthy dashboard that is already running on localhost:3000.\n',
    );
  } else {
    startDashboard();
  }
  healthMonitor = setInterval(() => {
    void dashboardIsHealthy().then((healthy) => {
      if (!healthy && !dashboard && !closing && !dashboardRestart) {
        process.stderr.write(
          'Dashboard health check failed; starting the local stack.\n',
        );
        startDashboard();
      }
    });
  }, 15_000);
  await startTunnel();
}

if (isWindows && !existsSync(cloudflaredCommand)) {
  throw new Error(
    `cloudflared is missing at ${cloudflaredCommand}. Run npm run public:install-tunnel first.`,
  );
}
if (!existsSync(join(process.cwd(), 'dist', 'server', 'wrangler.json'))) {
  throw new Error('The dashboard has not been built. Run npm run build first.');
}

const releaseInstanceLock = acquireInstanceLock();

process.once('SIGINT', close);
process.once('SIGTERM', close);
process.once('exit', releaseInstanceLock);
void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'The public demo failed to start.'}\n`,
  );
  close();
  process.exitCode = 1;
});
