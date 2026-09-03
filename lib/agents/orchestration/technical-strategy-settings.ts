export type TechnicalStrategySettings = {
  enabled: boolean;
  revision: number;
  updatedAt: string;
};

class InMemoryTechnicalStrategySettings {
  private enabled = process.env.TECHNICAL_STRATEGY_ENABLED === 'true';
  private revision = 1;
  private updatedAt = new Date().toISOString();

  get(): TechnicalStrategySettings {
    return {
      enabled: this.enabled,
      revision: this.revision,
      updatedAt: this.updatedAt,
    };
  }

  setEnabled(enabled: boolean): TechnicalStrategySettings {
    if (this.enabled !== enabled) {
      this.enabled = enabled;
      this.revision += 1;
      this.updatedAt = new Date().toISOString();
    }
    return this.get();
  }
}

export class HttpTechnicalStrategySettingsProvider {
  constructor(
    private readonly baseUrl = 'http://localhost:3000',
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async getSettings(): Promise<TechnicalStrategySettings> {
    const response = await this.fetcher(`${this.baseUrl}/api/orchestrator`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(
        `Technical-settings service returned ${response.status}.`,
      );
    }
    const payload = (await response.json()) as {
      technicalStrategy?: TechnicalStrategySettings;
    };
    if (!payload.technicalStrategy) {
      throw new Error(
        'Technical-settings service returned an invalid response.',
      );
    }
    return payload.technicalStrategy;
  }
}

const settingsGlobal = globalThis as typeof globalThis & {
  __technicalStrategySettings?: InMemoryTechnicalStrategySettings;
};

export function getTechnicalStrategySettings(): InMemoryTechnicalStrategySettings {
  settingsGlobal.__technicalStrategySettings ??=
    new InMemoryTechnicalStrategySettings();
  return settingsGlobal.__technicalStrategySettings;
}
