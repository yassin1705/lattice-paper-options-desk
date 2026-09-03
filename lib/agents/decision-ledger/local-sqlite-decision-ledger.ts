import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { ScanSymbolResult } from '@/lib/agents/communication/agent-scan-coordinator';
import type { NewsSymbolResult } from '@/lib/agents/news/news-strategy-coordinator';

export type StoredAgentDecision = {
  id: string;
  runId: string;
  createdAt: string;
  strategyId: 'technical' | 'news_llm';
  symbol: string;
  decisionKind: 'opportunity' | 'no_opportunity' | 'failed';
  direction: string | null;
  confidence: number | null;
  riskOutcome: string | null;
  executionStatus: string | null;
  executionError: string | null;
  orderClientId: string | null;
  decisionJson: string | null;
  riskJson: string | null;
  why: string;
};

type AgentResult = ScanSymbolResult | NewsSymbolResult;

type SqliteDecisionRow = {
  id: string;
  run_id: string;
  created_at: string;
  strategy_id: StoredAgentDecision['strategyId'];
  symbol: string;
  decision_kind: StoredAgentDecision['decisionKind'];
  direction: string | null;
  confidence: number | null;
  risk_outcome: string | null;
  execution_status: string | null;
  execution_error: string | null;
  order_client_id: string | null;
  decision_json: string | null;
  risk_json: string | null;
  why: string;
};

function storedDecision(
  strategyId: StoredAgentDecision['strategyId'],
  runId: string,
  result: AgentResult,
  recordedAt: string,
): StoredAgentDecision {
  if (result.kind === 'failed') {
    return {
      id: `${runId}:${strategyId}:${result.symbol}:failed`,
      runId,
      createdAt: recordedAt,
      strategyId,
      symbol: result.symbol,
      decisionKind: 'failed',
      direction: null,
      confidence: null,
      riskOutcome: null,
      executionStatus: null,
      executionError: null,
      orderClientId: null,
      decisionJson: JSON.stringify({ error: result.error }),
      riskJson: null,
      why: result.error,
    };
  }

  const decision = result.decision;
  return {
    id: decision.messageId,
    runId,
    createdAt: decision.generatedAt,
    strategyId,
    symbol: result.symbol,
    decisionKind: decision.kind,
    direction: decision.kind === 'opportunity' ? decision.direction : null,
    confidence: decision.analysis.signalStrength,
    riskOutcome:
      result.kind === 'risk_reviewed' ? result.riskDecision.kind : null,
    executionStatus:
      result.kind === 'risk_reviewed'
        ? (result.executionProposal?.status ?? null)
        : null,
    executionError:
      result.kind === 'risk_reviewed'
        ? (result.executionError ?? result.executionProposal?.error ?? null)
        : null,
    orderClientId:
      result.kind === 'risk_reviewed'
        ? (result.executionProposal?.order.clientOrderId ?? null)
        : null,
    decisionJson: JSON.stringify(decision),
    riskJson:
      result.kind === 'risk_reviewed'
        ? JSON.stringify(result.riskDecision)
        : null,
    why:
      result.kind === 'no_opportunity'
        ? result.decision.explanation.join(' ') ||
          `No opportunity: ${result.decision.reason.replaceAll('_', ' ')}.`
        : result.riskDecision.kind === 'rejected_trade'
          ? [
              ...result.decision.explanation,
              ...result.riskDecision.reasons,
            ].join(' ')
          : [
              ...result.decision.explanation,
              ...result.riskDecision.explanation,
            ].join(' '),
  };
}

export class LocalSqliteDecisionLedger {
  private readonly database: DatabaseSync;

  constructor(
    databasePath = join(process.cwd(), '.data', 'agent-decisions.sqlite'),
    schemaPath = join(process.cwd(), 'db', 'local', '001_agent_decisions.sql'),
    executionErrorMigrationPath = join(
      process.cwd(),
      'db',
      'local',
      '003_agent_decision_execution_error.sql',
    ),
  ) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec('PRAGMA journal_mode = WAL;');
    this.database.exec(readFileSync(schemaPath, 'utf8'));
    const columns = this.database
      .prepare('PRAGMA table_info(agent_decisions)')
      .all() as unknown as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'execution_error')) {
      this.database.exec(readFileSync(executionErrorMigrationPath, 'utf8'));
    }
    this.database.exec('PRAGMA optimize;');
  }

  recordResults(
    strategyId: StoredAgentDecision['strategyId'],
    runId: string,
    results: AgentResult[],
  ): number {
    const insert = this.database.prepare(`
      INSERT OR IGNORE INTO agent_decisions (
        id, run_id, created_at, strategy_id, symbol, decision_kind,
        direction, confidence, risk_outcome, execution_status,
        execution_error, order_client_id, decision_json, risk_json, why
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const recordedAt = new Date().toISOString();
    let inserted = 0;
    for (const result of results) {
      const decision = storedDecision(strategyId, runId, result, recordedAt);
      const outcome = insert.run(
        decision.id,
        decision.runId,
        decision.createdAt,
        decision.strategyId,
        decision.symbol,
        decision.decisionKind,
        decision.direction,
        decision.confidence,
        decision.riskOutcome,
        decision.executionStatus,
        decision.executionError,
        decision.orderClientId,
        decision.decisionJson,
        decision.riskJson,
        decision.why,
      );
      inserted += Number(outcome.changes);
    }
    return inserted;
  }

  list(limit = 100): StoredAgentDecision[] {
    const rows = this.database
      .prepare(
        `SELECT
          id, run_id, created_at, strategy_id, symbol, decision_kind,
          direction, confidence, risk_outcome, execution_status,
          execution_error, order_client_id, decision_json, risk_json, why
        FROM agent_decisions
        ORDER BY created_at DESC
        LIMIT ?`,
      )
      .all(
        Math.max(1, Math.min(500, Math.trunc(limit))),
      ) as unknown as SqliteDecisionRow[];
    return rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      createdAt: row.created_at,
      strategyId: row.strategy_id,
      symbol: row.symbol,
      decisionKind: row.decision_kind,
      direction: row.direction,
      confidence: row.confidence,
      riskOutcome: row.risk_outcome,
      executionStatus: row.execution_status,
      executionError: row.execution_error,
      orderClientId: row.order_client_id,
      decisionJson: row.decision_json,
      riskJson: row.risk_json,
      why: row.why,
    }));
  }

  close(): void {
    this.database.close();
  }
}
