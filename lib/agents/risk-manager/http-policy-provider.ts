import {
  validateRiskPolicy,
  type RiskPolicySnapshot,
} from '@/lib/agents/risk-manager/policy';
import type { RiskPolicyProvider } from '@/lib/agents/risk-manager/policy-provider';

export class HttpRiskPolicyProvider implements RiskPolicyProvider {
  constructor(
    private readonly baseUrl = 'http://localhost:3000',
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async getPolicy(): Promise<RiskPolicySnapshot> {
    const response = await this.fetcher(`${this.baseUrl}/api/risk-policy`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Risk-policy service returned ${response.status}.`);
    }
    const snapshot = (await response.json()) as RiskPolicySnapshot;
    return {
      revision: snapshot.revision,
      updatedAt: snapshot.updatedAt,
      policy: validateRiskPolicy(snapshot.policy),
    };
  }

  async updatePolicy(policy: unknown): Promise<RiskPolicySnapshot> {
    const response = await this.fetcher(`${this.baseUrl}/api/risk-policy`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(policy),
    });
    if (!response.ok) {
      throw new Error(`Risk-policy service returned ${response.status}.`);
    }
    return response.json() as Promise<RiskPolicySnapshot>;
  }
}
