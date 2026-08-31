import 'server-only';

import { ExecutionManager } from '@/lib/agents/execution/execution-manager';
import { createAlpacaPaperExecutionGatewayFromEnvironment } from '@/lib/alpaca/factory';

let executionManager: ExecutionManager | null | undefined;

export function getExecutionManagerFromEnvironment(): ExecutionManager | null {
  if (executionManager !== undefined) return executionManager;
  const gateway = createAlpacaPaperExecutionGatewayFromEnvironment();
  executionManager = gateway
    ? new ExecutionManager(
        gateway,
        process.env.ALPACA_EXECUTION_ENABLED === 'true',
      )
    : null;
  return executionManager;
}
