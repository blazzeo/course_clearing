-- =====================================================
-- Migration: Complete schema with all features
-- =====================================================
-- Эта миграция объединяет все изменения после базовой схемы
-- =====================================================

-- 1. Обновляем withdrawals (из 0001_alter_withdrawals.sql)
ALTER TABLE withdrawals
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Заполняем существующие записи
UPDATE withdrawals
SET updated_at = COALESCE(completed_at, approved_at, requested_at, NOW())
WHERE updated_at IS NULL;

-- Делаем NOT NULL
ALTER TABLE withdrawals
ALTER COLUMN updated_at SET NOT NULL;

-- Добавляем поле pda
ALTER TABLE withdrawals
ADD COLUMN IF NOT EXISTS pda TEXT;

-- 2. Создаем таблицу outstanding_fees (из 0003_add_outstanding_fees.sql)
DO $$ BEGIN
    CREATE TYPE fee_status AS ENUM ('outstanding', 'repaid', 'written_off');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS outstanding_fees (
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

-- Индексы для outstanding_fees
CREATE INDEX IF NOT EXISTS idx_outstanding_fees_participant ON outstanding_fees(participant_address);
CREATE INDEX IF NOT EXISTS idx_outstanding_fees_status ON outstanding_fees(status);
CREATE INDEX IF NOT EXISTS idx_outstanding_fees_session ON outstanding_fees(session_id);
CREATE INDEX IF NOT EXISTS idx_outstanding_fees_created ON outstanding_fees(created_at);

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

-- Триггер для outstanding_fees
DROP TRIGGER IF EXISTS trigger_update_repaid_at ON outstanding_fees;
CREATE TRIGGER trigger_update_repaid_at
    BEFORE UPDATE ON outstanding_fees
    FOR EACH ROW
    EXECUTE FUNCTION update_repaid_at();

-- Индекс для system_settings
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_settings_singleton ON system_settings ((id = 1));

-- 4. Функции и триггеры (уже есть в базовой миграции, но на всякий случай)

-- Создаем функцию обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Триггеры для обновления updated_at
DROP TRIGGER IF EXISTS update_participants_updated_at ON participants;
CREATE TRIGGER update_participants_updated_at
    BEFORE UPDATE ON participants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_system_settings_updated_at ON system_settings;
CREATE TRIGGER update_system_settings_updated_at
    BEFORE UPDATE ON system_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_withdrawals_updated_at ON withdrawals;
CREATE TRIGGER update_withdrawals_updated_at
    BEFORE UPDATE ON withdrawals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 5. Комментарии к таблицам
COMMENT ON TABLE participants IS 'Таблица участников системы с ролями и балансами';
COMMENT ON TABLE positions IS 'Финансовые позиции между участниками';
COMMENT ON TABLE netting_sessions IS 'Сессии клиринга (неттинга)';
COMMENT ON TABLE netting_results IS 'Результаты клиринга по участникам';
COMMENT ON TABLE settlements IS 'Выполненные расчеты между участниками';
COMMENT ON TABLE system_settings IS 'Системные настройки с отдельными столбцами для каждой настройки';
COMMENT ON TABLE audit_log IS 'Лог действий пользователей для аудита';
COMMENT ON TABLE withdrawals IS 'Запросы на вывод средств';
COMMENT ON TABLE outstanding_fees IS 'Таблица для отслеживания долгов по комиссиям участников';

-- Детальные комментарии к столбцам system_settings
COMMENT ON COLUMN system_settings.clearing_min_participants IS 'Минимальное количество участников для клиринга';
COMMENT ON COLUMN system_settings.clearing_max_amount IS 'Максимальная сумма для одного клиринга';
COMMENT ON COLUMN system_settings.clearing_fee IS 'Комиссия за клиринг (доля от суммы)';
COMMENT ON COLUMN system_settings.transaction_fee IS 'Комиссия за транзакцию (фиксированная)';
COMMENT ON COLUMN system_settings.deposit_fee IS 'Комиссия за депозит (доля от суммы)';
COMMENT ON COLUMN system_settings.withdrawal_fee IS 'Комиссия за вывод (доля от суммы)';
COMMENT ON COLUMN system_settings.daily_transaction_limit IS 'Дневной лимит транзакций';
COMMENT ON COLUMN system_settings.monthly_volume_limit IS 'Месячный лимит объема';

-- Комментарии к outstanding_fees
COMMENT ON COLUMN outstanding_fees.participant_address IS 'Адрес участника (Solana public key)';
COMMENT ON COLUMN outstanding_fees.amount IS 'Сумма долга в lamports';
COMMENT ON COLUMN outstanding_fees.reason IS 'Причина долга: clearing, deposit, withdrawal';
COMMENT ON COLUMN outstanding_fees.session_id IS 'Ссылка на сессию клиринга (если применимо)';
COMMENT ON COLUMN outstanding_fees.settlement_id IS 'Ссылка на settlement (если применимо)';
COMMENT ON COLUMN outstanding_fees.status IS 'Статус долга: outstanding, repaid, written_off';
