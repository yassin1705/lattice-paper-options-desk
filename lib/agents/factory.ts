import 'server-only';

import { AgentDataCoordinator } from '@/lib/agents/agent-data-coordinator';
import { createAlpacaReadGatewayFromEnvironment } from '@/lib/alpaca/factory';

export function createAgentDataCoordinatorFromEnvironment(): AgentDataCoordinator | null {
  const alpaca = createAlpacaReadGatewayFromEnvironment();
  return alpaca ? new AgentDataCoordinator(alpaca) : null;
}
