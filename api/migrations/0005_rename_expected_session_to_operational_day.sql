DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'obligations'
          AND column_name = 'expecting_clearing_session'
    ) THEN
        ALTER TABLE obligations
            RENAME COLUMN expecting_clearing_session TO expecting_operational_day;
    END IF;
END $$;

DROP INDEX IF EXISTS idx_obligations_expected_session;

CREATE INDEX IF NOT EXISTS idx_obligations_expected_operational_day
    ON obligations(expecting_operational_day);
