import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

import type {
  LocalRunnerState,
  LocalRunnerStatus,
} from '@/lib/agents/orchestration/local-runner-process';

export class RunnerChildProcess {
  private child: ChildProcessWithoutNullStreams | null = null;
  private state: LocalRunnerState = 'stopped';
  private startedAt: string | null = null;
  private stoppedAt: string | null = null;
  private error: string | null = null;
  private requestedStop = false;

  status(): LocalRunnerStatus {
    return {
      state: this.state,
      pid: this.child?.pid ?? null,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      error: this.error,
    };
  }

  async start(): Promise<LocalRunnerStatus> {
    if (this.child && (this.state === 'starting' || this.state === 'running')) {
      return this.status();
    }
    const projectDirectory = process.cwd();
    const tsxCli = join(
      projectDirectory,
      'node_modules',
      'tsx',
      'dist',
      'cli.mjs',
    );
    const runnerScript = join(
      projectDirectory,
      'scripts',
      'run-autonomous-agents.ts',
    );
    this.state = 'starting';
    this.error = null;
    this.requestedStop = false;

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(process.execPath, [tsxCli, runnerScript], {
        cwd: projectDirectory,
        env: process.env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      this.state = 'failed';
      this.error =
        error instanceof Error ? error.message : 'Could not start the runner.';
      throw error;
    }
    this.child = child;
    child.stdout.resume();
    child.stderr.on('data', (chunk: Buffer) => {
      const message = chunk.toString('utf8').trim();
      if (message) this.error = message.slice(-500);
    });
    child.once('exit', (code) => {
      this.child = null;
      this.stoppedAt = new Date().toISOString();
      if (this.requestedStop || code === 0) {
        this.state = 'stopped';
        this.error = null;
      } else {
        this.state = 'failed';
        this.error ??= `The local runner stopped with exit code ${code ?? 'unknown'}.`;
      }
    });
    return await new Promise((resolve, reject) => {
      child.once('spawn', () => {
        this.state = 'running';
        this.startedAt = new Date().toISOString();
        this.stoppedAt = null;
        resolve(this.status());
      });
      child.once('error', (error) => {
        this.child = null;
        this.state = 'failed';
        this.error = error.message;
        reject(error);
      });
    });
  }

  stop(): LocalRunnerStatus {
    if (!this.child) {
      this.state = 'stopped';
      return this.status();
    }
    this.state = 'stopping';
    this.requestedStop = true;
    this.child.kill('SIGTERM');
    return this.status();
  }
}
