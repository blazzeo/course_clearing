-- Добавление таблицы для запросов на вывод средств

CREATE TABLE withdrawals (
    id SERIAL PRIMARY KEY,              -- уникальный идентификатор
    participant TEXT NOT NULL,           -- адрес участника
    amount BIGINT NOT NULL,              -- сумма в lamports
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'completed', 'rejected')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- время запроса
    approved_at TIMESTAMPTZ NULL,        -- время одобрения администратором
    completed_at TIMESTAMPTZ NULL,       -- время выполнения вывода
    tx_signature TEXT NULL,              -- сигнатура транзакции approve_withdrawal
);

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_withdrawals_participant ON withdrawals(participant);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_requested_at ON withdrawals(requested_at);

-- Ограничение: один активный запрос на вывод на участника
-- (нельзя иметь несколько pending запросов одновременно)
CREATE UNIQUE INDEX IF NOT EXISTS idx_withdrawals_active_per_participant
ON withdrawals(participant)
WHERE status IN ('pending', 'approved');

-- Триггер для обновления created_at
CREATE TRIGGER update_withdrawals_created_at
    BEFORE UPDATE ON withdrawals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
