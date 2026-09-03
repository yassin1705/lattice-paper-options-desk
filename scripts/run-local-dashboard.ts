import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { join } from 'node:path';

import { config as loadEnvironment } from 'dotenv';

import { RunnerChildProcess } from '@/lib/agents/orchestration/runner-child-process';
import { getConversationalTradingService } from '@/lib/agents/copilot/conversational-trading-service';

loadEnvironment({ path: '.env', quiet: true });
loadEnvironment({ path: '.env.local', override: true, quiet: true });

const host = '127.0.0.1';
const port = Number(process.env.LOCAL_RUNNER_CONTROL_PORT ?? 4318);
const runner = new RunnerChildProcess();

function json(response: ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

async function jsonBody(
  request: import('node:http').IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 32_768) throw new Error('Request is too large.');
    chunks.push(buffer);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Request body must be an object.');
  }
  return value as Record<string, unknown>;
}

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/status') {
    json(response, runner.status());
    return;
  }
  if (request.method === 'POST' && request.url === '/start') {
    try {
      json(response, await runner.start());
    } catch (error) {
      json(
        response,
        {
          ...runner.status(),
          error: error instanceof Error ? error.message : 'Start failed.',
        },
        500,
      );
    }
    return;
  }
  if (request.method === 'POST' && request.url === '/stop') {
    json(response, runner.stop());
    return;
  }
  if (request.method === 'POST' && request.url === '/copilot') {
    try {
      const body = await jsonBody(request);
      const message =
        typeof body.message === 'string' ? body.message.trim() : '';
      if (!message || message.length > 2_000) {
        json(
          response,
          { error: 'Message must contain between 1 and 2,000 characters.' },
          400,
        );
        return;
      }
      json(
        response,
        await getConversationalTradingService().handle(
          typeof body.sessionId === 'string' ? body.sessionId : undefined,
          message,
          body.executionAllowed === true,
        ),
      );
    } catch (error) {
      json(
        response,
        {
          error:
            error instanceof Error ? error.message : 'Copilot request failed.',
        },
        500,
      );
    }
    return;
  }
  json(response, { error: 'Not found.' }, 404);
});

server.listen(port, host);

const environmentSource = join(process.cwd(), '.env.local');
const devVariablesPath = join(process.cwd(), 'dist', 'server', '.dev.vars');
const createdDevVariables =
  existsSync(environmentSource) && !existsSync(devVariablesPath);
if (createdDevVariables) {
  copyFileSync(environmentSource, devVariablesPath);
}

function removeTemporaryDevVariables(): void {
  if (createdDevVariables && existsSync(devVariablesPath)) {
    unlinkSync(devVariablesPath);
  }
}

const wranglerCli = join(
  process.cwd(),
  'node_modules',
  'wrangler',
  'bin',
  'wrangler.js',
);
const dashboard = spawn(
  process.execPath,
  [
    wranglerCli,
    'dev',
    '--config',
    'dist/server/wrangler.json',
    '--port',
    '3000',
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    windowsHide: true,
    stdio: 'inherit',
  },
);

async function autoStartRunnerWhenReady(): Promise<void> {
  if (process.env.AUTONOMOUS_RUNNER_AUTO_START !== 'true') return;
  for (let attempt = 1; attempt <= 60 && !closing; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:3000/api/orchestrator');
      if (response.ok) {
        const status = await runner.start();
        process.stdout.write(
          `${JSON.stringify({ event: 'runner_auto_start', status })}\n`,
        );
        return;
      }
    } catch {
      // The dashboard is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (!closing) {
    process.stderr.write(
      'The dashboard did not become ready, so the autonomous runner was not started.\n',
    );
  }
}

let closing = false;
void autoStartRunnerWhenReady();
function close(): void {
  if (closing) return;
  closing = true;
  runner.stop();
  dashboard.kill('SIGTERM');
  server.close(() => {
    removeTemporaryDevVariables();
    process.exit(0);
  });
}

process.once('SIGINT', close);
process.once('SIGTERM', close);
dashboard.once('exit', (code) => {
  if (!closing) {
    runner.stop();
    server.close(() => {
      removeTemporaryDevVariables();
      process.exitCode = code ?? 1;
    });
  }
});
