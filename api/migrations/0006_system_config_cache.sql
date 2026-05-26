CREATE TABLE IF NOT EXISTS system_config_cache (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE,
    total_sessions BIGINT NOT NULL,
    session_interval_time BIGINT NOT NULL,
    last_clearing_operational_day BIGINT NOT NULL,
    operational_day BIGINT NOT NULL,
    fee_rate_bps BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
);
