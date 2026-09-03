export type LocalRunnerState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'failed';

export type LocalRunnerStatus = {
  state: LocalRunnerState;
  pid: number | null;
  startedAt: string | null;
  stoppedAt: string | null;
  error: string | null;
};

export type LocalCopilotRequest = {
  sessionId?: string;
  message: string;
  executionAllowed: boolean;
};

const unavailableStatus = (error: string): LocalRunnerStatus => ({
  state: 'failed',
  pid: null,
  startedAt: null,
  stoppedAt: null,
  error,
});

class LocalRunnerProcessClient {
  constructor(
    private readonly baseUrl = process.env.LOCAL_RUNNER_CONTROL_URL ??
      'http://127.0.0.1:4318',
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async status(): Promise<LocalRunnerStatus> {
    try {
      const response = await this.fetcher(`${this.baseUrl}/status`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        return unavailableStatus(
          `Local runner controller returned ${response.status}.`,
        );
      }
      return (await response.json()) as LocalRunnerStatus;
    } catch {
      return unavailableStatus(
        'Local runner controller is unavailable. Restart the local dashboard.',
      );
    }
  }

  async start(): Promise<LocalRunnerStatus> {
    return this.control('start');
  }

  async stop(): Promise<LocalRunnerStatus> {
    return this.control('stop');
  }

  async copilot<T>(request: LocalCopilotRequest): Promise<T> {
    try {
      const response = await this.fetcher(`${this.baseUrl}/copilot`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });
      const payload = (await response.json()) as T & { error?: string };
      if (!response.ok)
        throw new Error(payload.error ?? 'Trading copilot failed.');
      return payload;
    } catch (error) {
      throw new Error(
        error instanceof Error && !error.message.includes('fetch')
          ? error.message
          : 'The local trading-copilot service is unavailable. Restart the local dashboard.',
      );
    }
  }

  private async control(action: 'start' | 'stop'): Promise<LocalRunnerStatus> {
    const response = await this.fetcher(`${this.baseUrl}/${action}`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    const payload = (await response.json()) as LocalRunnerStatus & {
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error ?? `Could not ${action} the local runner.`);
    }
    return payload;
  }
}

const runnerGlobal = globalThis as typeof globalThis & {
  __localRunnerProcess?: LocalRunnerProcessClient;
};

export function getLocalRunnerProcess(): LocalRunnerProcessClient {
  runnerGlobal.__localRunnerProcess ??= new LocalRunnerProcessClient();
  return runnerGlobal.__localRunnerProcess;
}
