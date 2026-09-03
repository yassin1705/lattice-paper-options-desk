CREATE TABLE IF NOT EXISTS copilot_sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  context_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS copilot_proposals (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('awaiting_confirmation', 'superseded', 'cancelled', 'submitted', 'failed')
  ),
  proposal_json TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES copilot_sessions(id)
);

CREATE INDEX IF NOT EXISTS copilot_proposals_session_status
  ON copilot_proposals(session_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS copilot_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES copilot_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_copilot_messages_session_created
  ON copilot_messages(session_id, created_at DESC);
