CREATE TABLE IF NOT EXISTS clearing_sessions (
    session_id BIGINT PRIMARY KEY,
    result_id TEXT NOT NULL,
    result_hash TEXT NOT NULL,
    merkle_root TEXT NOT NULL,
    external_count INTEGER NOT NULL,
    internal_count INTEGER NOT NULL,
    payload JSONB NOT NULL,
    created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clearing_sessions_created_at
    ON clearing_sessions(created_at DESC);
