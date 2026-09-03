CREATE TABLE IF NOT EXISTS agent_decisions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  strategy_id TEXT NOT NULL CHECK (strategy_id IN ('technical', 'news_llm')),
  symbol TEXT NOT NULL,
  decision_kind TEXT NOT NULL CHECK (decision_kind IN ('opportunity', 'no_opportunity', 'failed')),
  direction TEXT,
  confidence REAL,
  risk_outcome TEXT,
  execution_status TEXT,
  order_client_id TEXT,
  decision_json TEXT,
  risk_json TEXT,
  why TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_agent_decisions_strategy_created
ON agent_decisions(strategy_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_decisions_symbol_created
ON agent_decisions(symbol, created_at DESC);
