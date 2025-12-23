CREATE TABLE participants (
    address TEXT UNIQUE PRIMARY KEY,   -- solana address
    user_type TEXT NOT NULL DEFAULT 'user' CHECK (user_type IN ('user', 'admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_participants_user_type ON participants(user_type);

CREATE TABLE positions (
    id SERIAL PRIMARY KEY,
    creator_address TEXT NOT NULL,
    counterparty_address TEXT NOT NULL,
    amount BIGINT NOT NULL,  -- положительное число, означает: counterparty должен creator
    status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'cleared')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ NULL,
    cleared_at TIMESTAMPTZ NULL,
    creator_signature TEXT NULL,
    counterparty_signature TEXT NULL
);

ALTER TABLE positions
    ALTER COLUMN created_at TYPE TIMESTAMPTZ
    USING created_at AT TIME ZONE 'UTC';

ALTER TABLE positions
    ALTER COLUMN confirmed_at TYPE TIMESTAMPTZ
    USING confirmed_at AT TIME ZONE 'UTC';

ALTER TABLE positions
    ALTER COLUMN cleared_at TYPE TIMESTAMPTZ
    USING cleared_at AT TIME ZONE 'UTC';

CREATE TABLE netting_sessions (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL CHECK (status IN ('calculated', 'settled'))
);

CREATE TABLE netting_results (
    id SERIAL PRIMARY KEY,
    session_id INT NOT NULL REFERENCES netting_sessions(id),
    participant_address TEXT NOT NULL,
    net_amount BIGINT NOT NULL  -- может быть + или -
);

CREATE TABLE settlements (
    id SERIAL PRIMARY KEY,
    session_id INT NOT NULL REFERENCES netting_sessions(id),
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    amount BIGINT NOT NULL,
    tx_signature TEXT NOT NULL,  -- сигнатура solana-транзакции
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE settlements
    ALTER COLUMN created_at TYPE TIMESTAMPTZ
    USING created_at AT TIME ZONE 'UTC';

CREATE INDEX IF NOT EXISTS idx_positions_creator ON positions(creator_address);
CREATE INDEX IF NOT EXISTS idx_positions_counterparty ON positions(counterparty_address);
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
