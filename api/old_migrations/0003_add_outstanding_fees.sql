-- =====================================================
-- Migration: Add outstanding fees tracking
-- =====================================================

-- Создание enum типа для статуса долга
CREATE TYPE fee_status AS ENUM ('outstanding', 'repaid', 'written_off');

-- Таблица для отслеживания долгов по комиссиям
CREATE TABLE outstanding_fees (
    id SERIAL PRIMARY KEY,
    participant_address VARCHAR NOT NULL,
    amount BIGINT NOT NULL CHECK (amount > 0),
    reason VARCHAR NOT NULL CHECK (reason IN ('clearing', 'deposit', 'withdrawal')),
    session_id INTEGER REFERENCES netting_sessions(id),
    settlement_id INTEGER REFERENCES settlements(id),
    created_at TIMESTAMP DEFAULT NOW(),
    repaid_at TIMESTAMP,
    status fee_status DEFAULT 'outstanding'
);

-- Индексы для быстрого поиска
CREATE INDEX idx_outstanding_fees_participant ON outstanding_fees(participant_address);
CREATE INDEX idx_outstanding_fees_status ON outstanding_fees(status);
CREATE INDEX idx_outstanding_fees_session ON outstanding_fees(session_id);
CREATE INDEX idx_outstanding_fees_created ON outstanding_fees(created_at);

-- Функция для автоматического обновления repaid_at
CREATE OR REPLACE FUNCTION update_repaid_at()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'repaid' AND OLD.status != 'repaid' THEN
        NEW.repaid_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Триггер для автоматического обновления repaid_at
CREATE TRIGGER trigger_update_repaid_at
    BEFORE UPDATE ON outstanding_fees
    FOR EACH ROW
    EXECUTE FUNCTION update_repaid_at();

-- Комментарии к таблице
COMMENT ON TABLE outstanding_fees IS 'Таблица для отслеживания долгов по комиссиям участников';
COMMENT ON COLUMN outstanding_fees.participant_address IS 'Адрес участника (Solana public key)';
COMMENT ON COLUMN outstanding_fees.amount IS 'Сумма долга в lamports';
COMMENT ON COLUMN outstanding_fees.reason IS 'Причина долга: clearing, deposit, withdrawal';
COMMENT ON COLUMN outstanding_fees.session_id IS 'Ссылка на сессию клиринга (если применимо)';
COMMENT ON COLUMN outstanding_fees.settlement_id IS 'Ссылка на settlement (если применимо)';
COMMENT ON COLUMN outstanding_fees.status IS 'Статус долга: outstanding, repaid, written_off';
