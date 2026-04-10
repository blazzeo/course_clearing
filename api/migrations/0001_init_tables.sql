CREATE TABLE obligations (
    pda TEXT PRIMARY KEY, -- Pubkey
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    original_amount BIGINT NOT NULL,
    remaining_amount BIGINT NOT NULL,
    status TEXT NOT NULL,

    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    closed_at BIGINT
);

CREATE TABLE settlements (
    id SERIAL PRIMARY KEY,

    obligation_id TEXT NOT NULL,
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    amount BIGINT NOT NULL,

    session_id BIGINT NOT NULL,
    created_at BIGINT NOT NULL,

    FOREIGN KEY (obligation_id) REFERENCES obligations(pda)
);

CREATE TABLE events (
    id SERIAL PRIMARY KEY,

    tx_signature TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    data JSONB NOT NULL,

    created_at BIGINT NOT NULL
);

-- INDEXES
CREATE INDEX idx_obligations_from ON obligations(from_address);
CREATE INDEX idx_obligations_to ON obligations(to_address);
CREATE INDEX idx_obligations_status ON obligations(status);

CREATE INDEX idx_settlements_obligation ON settlements(obligation_id);
CREATE INDEX idx_settlements_session ON settlements(session_id);

CREATE INDEX idx_events_type ON events(event_type);
