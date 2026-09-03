import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { CopilotProposal } from '@/lib/agents/copilot/types';

export type CopilotSessionContext = {
  symbol: string | null;
  instrument: 'stock' | 'option' | null;
  direction: 'bullish' | 'bearish' | null;
  investmentDollars: number | null;
  maximumRiskDollars: number | null;
  holdingDays: number | null;
  tradeRequested: boolean;
  defaultedFields: Array<
    'investmentDollars' | 'maximumRiskDollars' | 'holdingDays'
  >;
};

export type StoredCopilotMessage = {
  role: 'user' | 'assistant';
  content: string;
};

const emptyContext: CopilotSessionContext = {
  symbol: null,
  instrument: null,
  direction: null,
  investmentDollars: null,
  maximumRiskDollars: null,
  holdingDays: null,
  tradeRequested: false,
  defaultedFields: [],
};

export class LocalCopilotStore {
  private readonly database: DatabaseSync;

  constructor(
    databasePath = join(process.cwd(), '.data', 'agent-decisions.sqlite'),
    schemaPath = join(
      process.cwd(),
      'db',
      'local',
      '002_copilot_proposals.sql',
    ),
  ) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec('PRAGMA journal_mode = WAL;');
    this.database.exec('PRAGMA foreign_keys = ON;');
    this.database.exec(readFileSync(schemaPath, 'utf8'));
  }

  getSession(id: string): CopilotSessionContext {
    const row = this.database
      .prepare('SELECT context_json FROM copilot_sessions WHERE id = ?')
      .get(id) as { context_json: string } | undefined;
    if (!row) return { ...emptyContext, defaultedFields: [] };
    const parsed = JSON.parse(row.context_json) as Partial<CopilotSessionContext>;
    return {
      ...emptyContext,
      ...parsed,
      defaultedFields: Array.isArray(parsed.defaultedFields)
        ? parsed.defaultedFields
        : [],
    };
  }

  saveSession(id: string, context: CopilotSessionContext): void {
    const now = new Date().toISOString();
    this.database
      .prepare(`
        INSERT INTO copilot_sessions (id, created_at, updated_at, context_json)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at,
          context_json = excluded.context_json
      `)
      .run(id, now, now, JSON.stringify(context));
  }

  saveProposal(proposal: CopilotProposal): void {
    this.database
      .prepare(`
        INSERT INTO copilot_proposals
          (id, session_id, created_at, expires_at, status, proposal_json)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status,
          proposal_json = excluded.proposal_json
      `)
      .run(
        proposal.id,
        proposal.sessionId,
        proposal.createdAt,
        proposal.expiresAt,
        proposal.status,
        JSON.stringify(proposal),
      );
  }

  latestPending(sessionId: string): CopilotProposal | null {
    const row = this.database
      .prepare(`
        SELECT proposal_json FROM copilot_proposals
        WHERE session_id = ? AND status = 'awaiting_confirmation'
        ORDER BY created_at DESC LIMIT 1
      `)
      .get(sessionId) as { proposal_json: string } | undefined;
    return row ? (JSON.parse(row.proposal_json) as CopilotProposal) : null;
  }

  updateProposal(proposal: CopilotProposal): void {
    this.database
      .prepare(
        'UPDATE copilot_proposals SET status = ?, proposal_json = ? WHERE id = ?',
      )
      .run(proposal.status, JSON.stringify(proposal), proposal.id);
  }

  appendMessage(
    sessionId: string,
    role: StoredCopilotMessage['role'],
    content: string,
  ): void {
    this.database
      .prepare(`
        INSERT INTO copilot_messages (id, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        crypto.randomUUID(),
        sessionId,
        role,
        content.slice(0, 8_000),
        new Date().toISOString(),
      );
  }

  recentMessages(sessionId: string, limit = 12): StoredCopilotMessage[] {
    const rows = this.database
      .prepare(`
        SELECT role, content FROM copilot_messages
        WHERE session_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(
        sessionId,
        Math.max(1, Math.min(20, Math.trunc(limit))),
      ) as unknown as StoredCopilotMessage[];
    return rows.reverse();
  }
}
