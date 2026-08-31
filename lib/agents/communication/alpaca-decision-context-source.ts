import { AgentDataCoordinator } from '@/lib/agents/agent-data-coordinator';
import type {
  DecisionContextSource,
  DecisionContextSourceRequest,
} from '@/lib/agents/ports';
import type { DecisionContext } from '@/lib/agents/types';

const BARS_PER_TRADING_DAY = {
  '1Day': 1,
  '1Hour': 7,
  '15Min': 26,
} as const;

export class AlpacaDecisionContextSource implements DecisionContextSource {
  constructor(private readonly dataCoordinator: AgentDataCoordinator) {}

  getDecisionContext(
    request: DecisionContextSourceRequest,
  ): Promise<DecisionContext> {
    const barsPerDay = BARS_PER_TRADING_DAY[request.scan.timeframe];
    const warmupDays = Math.ceil(
      (request.scan.lookbackBars / barsPerDay) * 2.2 + 10,
    );
    const end = new Date(request.scan.scheduledAt);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - warmupDays);
    return this.dataCoordinator.buildDecisionContext({
      underlyingSymbol: request.symbol,
      historyStart: start.toISOString(),
      historyEnd: end.toISOString(),
      historyTimeframe: request.scan.timeframe,
      historyFeed: 'iex',
      includeOptionChain: false,
    });
  }
}
