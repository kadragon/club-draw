-- Preference draw mode: one collection session per event.
-- Tokens are never stored in clear; only their SHA-256 hex digests.

CREATE TABLE session (
  id TEXT PRIMARY KEY,
  admin_token_hash TEXT NOT NULL,
  closed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE session_participant (
  session_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (session_id, participant_id)
);

CREATE TABLE session_prize (
  session_id TEXT NOT NULL,
  prize_id TEXT NOT NULL,
  name TEXT NOT NULL,
  ord INTEGER NOT NULL,
  PRIMARY KEY (session_id, prize_id)
);

CREATE TABLE pick (
  session_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  prize_id TEXT NOT NULL,
  claim_hash TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (session_id, participant_id, prize_id)
);
