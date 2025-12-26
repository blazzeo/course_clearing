BEGIN;

-- =====================================================
-- 1. Создание базовых таблиц
-- =====================================================

-- Таблица участников
CREATE TABLE IF NOT EXISTS participants (
    address TEXT UNIQUE PRIMARY KEY,   -- solana address
    user_type TEXT NOT NULL DEFAULT 'guest'
        CHECK (user_type IN ('guest', 'counterparty', 'auditor', 'administrator')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Дополнительные поля
    email TEXT,
    first_name TEXT,
    last_name TEXT,
    phone TEXT,
    company TEXT,
    is_active BOOLEAN DEFAULT true,
    balance BIGINT DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_participants_user_type ON participants(user_type);
CREATE INDEX IF NOT EXISTS idx_participants_is_active ON participants(is_active);
CREATE INDEX IF NOT EXISTS idx_participants_balance ON participants(balance);

-- Таблица позиций
CREATE TABLE IF NOT EXISTS positions (
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

-- Приведение timestamp к UTC (если уже были данные)
ALTER TABLE positions
    ALTER COLUMN created_at TYPE TIMESTAMPTZ
    USING COALESCE(created_at AT TIME ZONE 'UTC', NOW());

ALTER TABLE positions
    ALTER COLUMN confirmed_at TYPE TIMESTAMPTZ
    USING confirmed_at AT TIME ZONE 'UTC';

ALTER TABLE positions
    ALTER COLUMN cleared_at TYPE TIMESTAMPTZ
    USING cleared_at AT TIME ZONE 'UTC';

CREATE INDEX IF NOT EXISTS idx_positions_creator ON positions(creator_address);
CREATE INDEX IF NOT EXISTS idx_positions_counterparty ON positions(counterparty_address);
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);

-- Таблица клиринговых сессий
CREATE TABLE IF NOT EXISTS netting_sessions (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL CHECK (status IN ('calculated', 'settled'))
);

-- Таблица результатов клиринга
CREATE TABLE IF NOT EXISTS netting_results (
    id SERIAL PRIMARY KEY,
    session_id INT NOT NULL REFERENCES netting_sessions(id),
    participant_address TEXT NOT NULL,
    net_amount BIGINT NOT NULL  -- может быть + или -
);

-- Таблица расчетов
CREATE TABLE IF NOT EXISTS settlements (
    id SERIAL PRIMARY KEY,
    session_id INT NOT NULL REFERENCES netting_sessions(id),
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    amount BIGINT NOT NULL,
	fee_paid BOOLEAN NOT NULL DEFAULT FALSE,
    tx_signature TEXT NOT NULL,  -- сигнатура solana-транзакции
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE settlements
    ALTER COLUMN created_at TYPE TIMESTAMPTZ
    USING COALESCE(created_at AT TIME ZONE 'UTC', NOW());

-- =====================================================
-- 2. Системные настройки и аудит
-- =====================================================

-- Таблица системных настроек
CREATE TABLE IF NOT EXISTS system_settings (
    id SERIAL PRIMARY KEY,
    -- Комиссии
    clearing_fee REAL DEFAULT 0.001,
    transaction_fee REAL DEFAULT 0.0001,
    deposit_fee REAL DEFAULT 0.0005,
    withdrawal_fee REAL DEFAULT 0.002,
    -- Время обновления
    updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE system_settings
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ
    USING COALESCE(updated_at AT TIME ZONE 'UTC', NOW());

-- Вставляем базовые настройки
INSERT INTO system_settings (
    clearing_fee,
    transaction_fee,
    deposit_fee,
    withdrawal_fee
) VALUES (
    0.001,      -- clearing_fee
    0.0001,     -- transaction_fee
    0.0005,     -- deposit_fee
    0.002       -- withdrawal_fee
) ON CONFLICT DO NOTHING;


-- Таблица аудита действий пользователей
CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    user_address TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_address);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);

-- =====================================================
-- 3. Таблица выводов средств
-- =====================================================

CREATE TABLE IF NOT EXISTS withdrawals (
    id SERIAL PRIMARY KEY,              -- уникальный идентификатор
    participant TEXT NOT NULL,           -- адрес участника
    amount BIGINT NOT NULL,              -- сумма в lamports
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'completed', 'rejected')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- время запроса
    approved_at TIMESTAMPTZ NULL,        -- время одобрения администратором
    completed_at TIMESTAMPTZ NULL,       -- время выполнения вывода
    tx_signature TEXT NULL,              -- сигнатура транзакции approve_withdrawal
    nonce BIGINT DEFAULT 0,              -- порядковый номер для предотвращения replay-атак
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    pda TEXT
);

ALTER TABLE withdrawals
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_withdrawals_participant ON withdrawals(participant);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_requested_at ON withdrawals(requested_at);
CREATE INDEX IF NOT EXISTS idx_withdrawals_nonce ON withdrawals(nonce);

-- Ограничение: один активный запрос на вывод на участника
CREATE UNIQUE INDEX IF NOT EXISTS idx_withdrawals_active_per_participant
ON withdrawals(participant)
WHERE status IN ('pending', 'approved');

-- =====================================================
-- 4. Функции и триггеры для обновления timestamp
-- =====================================================

-- Создаем функцию обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Триггер для participants
DROP TRIGGER IF EXISTS update_participants_updated_at ON participants;
CREATE TRIGGER update_participants_updated_at
    BEFORE UPDATE ON participants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Триггер для system_settings
DROP TRIGGER IF EXISTS update_system_settings_updated_at ON system_settings;
CREATE TRIGGER update_system_settings_updated_at
    BEFORE UPDATE ON system_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Триггер для withdrawals
DROP TRIGGER IF EXISTS update_withdrawals_updated_at ON withdrawals;
CREATE TRIGGER update_withdrawals_updated_at
    BEFORE UPDATE ON withdrawals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 6. Комментарии к таблицам
-- =====================================================

COMMENT ON TABLE participants IS 'Таблица участников системы с ролями и балансами';
COMMENT ON TABLE positions IS 'Финансовые позиции между участниками';
COMMENT ON TABLE netting_sessions IS 'Сессии клиринга (неттинга)';
COMMENT ON TABLE netting_results IS 'Результаты клиринга по участникам';
COMMENT ON TABLE settlements IS 'Выполненные расчеты между участниками';
COMMENT ON TABLE system_settings IS 'Системные настройки с отдельными столбцами для каждой настройки';
COMMENT ON TABLE audit_log IS 'Лог действий пользователей для аудита';
COMMENT ON TABLE withdrawals IS 'Запросы на вывод средств';

-- Детальные комментарии к столбцам system_settings
COMMENT ON COLUMN system_settings.clearing_fee IS 'Комиссия за клиринг (доля от суммы)';
COMMENT ON COLUMN system_settings.transaction_fee IS 'Комиссия за транзакцию (фиксированная)';
COMMENT ON COLUMN system_settings.deposit_fee IS 'Комиссия за депозит (доля от суммы)';
COMMENT ON COLUMN system_settings.withdrawal_fee IS 'Комиссия за вывод (доля от суммы)';

COMMIT;
