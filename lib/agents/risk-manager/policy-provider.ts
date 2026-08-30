import 'server-only';

import {
  defaultRiskPolicy,
  validateRiskPolicy,
  type RiskPolicy,
  type RiskPolicySnapshot,
} from '@/lib/agents/risk-manager/policy';

export interface RiskPolicyProvider {
  getPolicy(): Promise<RiskPolicySnapshot>;
  updatePolicy(policy: unknown): Promise<RiskPolicySnapshot>;
}

export class InMemoryRiskPolicyProvider implements RiskPolicyProvider {
  private revision = 1;
  private updatedAt = new Date().toISOString();
  private policy: RiskPolicy;

  constructor(initialPolicy: RiskPolicy = defaultRiskPolicy) {
    this.policy = validateRiskPolicy(initialPolicy);
  }

  async getPolicy(): Promise<RiskPolicySnapshot> {
    return this.snapshot();
  }

  async updatePolicy(policy: unknown): Promise<RiskPolicySnapshot> {
    this.policy = validateRiskPolicy(policy);
    this.revision += 1;
    this.updatedAt = new Date().toISOString();
    return this.snapshot();
  }

  private snapshot(): RiskPolicySnapshot {
    return {
      revision: this.revision,
      updatedAt: this.updatedAt,
      policy: structuredClone(this.policy),
    };
  }
}

const provider = new InMemoryRiskPolicyProvider();

export function getRiskPolicyProvider(): RiskPolicyProvider {
  return provider;
}
