-- =====================================================
-- Migration: Refactor system settings to separate columns
-- =====================================================

-- Создаем новую таблицу с нормальной структурой
CREATE TABLE system_settings_new (
    id SERIAL PRIMARY KEY,
    -- Правила клиринга
    clearing_min_participants INTEGER DEFAULT 2,
    clearing_max_amount BIGINT DEFAULT 1000000,
    -- Комиссии
    clearing_fee REAL DEFAULT 0.001,
    transaction_fee REAL DEFAULT 0.0001,
    deposit_fee REAL DEFAULT 0.0005,
    withdrawal_fee REAL DEFAULT 0.002,
    -- Лимиты
    daily_transaction_limit BIGINT DEFAULT 10000,
    monthly_volume_limit BIGINT DEFAULT 100000,
    -- Время обновления
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Переносим данные из старой таблицы (если она существует)
DO $$
DECLARE
    old_clearing_rules JSONB;
    old_fees JSONB;
    old_limits JSONB;
BEGIN
    -- Проверяем, существует ли старая таблица
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'system_settings') THEN
        -- Извлекаем старые значения
        SELECT value::jsonb INTO old_clearing_rules FROM system_settings WHERE key = 'clearing_rules';
        SELECT value::jsonb INTO old_fees FROM system_settings WHERE key = 'fees';
        SELECT value::jsonb INTO old_limits FROM system_settings WHERE key = 'limits';

        -- Вставляем данные в новую таблицу
        INSERT INTO system_settings_new (
            clearing_min_participants,
            clearing_max_amount,
            clearing_fee,
            transaction_fee,
            daily_transaction_limit,
            monthly_volume_limit
        ) VALUES (
            COALESCE((old_clearing_rules->>'min_participants')::integer, 2),
            COALESCE((old_clearing_rules->>'max_amount')::bigint, 1000000),
            COALESCE((old_fees->>'clearing_fee')::real, 0.001),
            COALESCE((old_fees->>'transaction_fee')::real, 0.0001),
            COALESCE((old_limits->>'daily_transaction_limit')::bigint, 10000),
            COALESCE((old_limits->>'monthly_volume_limit')::bigint, 100000)
        );
    ELSE
        -- Если старой таблицы нет, вставляем значения по умолчанию
        INSERT INTO system_settings_new DEFAULT VALUES;
    END IF;
END $$;

-- Заменяем старую таблицу на новую
DROP TABLE IF EXISTS system_settings CASCADE;
ALTER TABLE system_settings_new RENAME TO system_settings;

-- Создаем индексы
CREATE UNIQUE INDEX idx_system_settings_singleton ON system_settings ((id = 1));

-- Комментарии
COMMENT ON TABLE system_settings IS 'Системные настройки с отдельными столбцами для каждой настройки';
COMMENT ON COLUMN system_settings.clearing_min_participants IS 'Минимальное количество участников для клиринга';
COMMENT ON COLUMN system_settings.clearing_max_amount IS 'Максимальная сумма для одного клиринга';
COMMENT ON COLUMN system_settings.clearing_fee IS 'Комиссия за клиринг (доля от суммы)';
COMMENT ON COLUMN system_settings.transaction_fee IS 'Комиссия за транзакцию (фиксированная)';
COMMENT ON COLUMN system_settings.deposit_fee IS 'Комиссия за депозит (доля от суммы)';
COMMENT ON COLUMN system_settings.withdrawal_fee IS 'Комиссия за вывод (доля от суммы)';
COMMENT ON COLUMN system_settings.daily_transaction_limit IS 'Дневной лимит транзакций';
COMMENT ON COLUMN system_settings.monthly_volume_limit IS 'Месячный лимит объема';
