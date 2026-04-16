ALTER TABLE obligations
ADD COLUMN IF NOT EXISTS expecting_clearing_session BIGINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_obligations_expected_session
    ON obligations(expecting_clearing_session);
