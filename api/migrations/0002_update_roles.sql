-- Обновление системы ролей с user/admin на guest/counterparty/auditor/administrator

-- Добавляем новые колонки для расширенной информации о пользователях
ALTER TABLE participants
ADD COLUMN IF NOT EXISTS email TEXT,
ADD COLUMN IF NOT EXISTS first_name TEXT,
ADD COLUMN IF NOT EXISTS last_name TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS company TEXT,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS balance BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Обновляем constraint для ролей
ALTER TABLE participants
DROP CONSTRAINT IF EXISTS participants_user_type_check;

ALTER TABLE participants
DROP CONSTRAINT IF EXISTS participants_user_type_check;

ALTER TABLE participants
ADD CONSTRAINT participants_user_type_check
CHECK (user_type IN ('guest', 'counterparty', 'auditor', 'administrator'));

-- Изменяем значение по умолчанию на 'guest'
ALTER TABLE participants
ALTER COLUMN user_type SET DEFAULT 'guest';

-- Обновляем существующих пользователей
UPDATE participants SET user_type = 'administrator' WHERE user_type = 'admin';
UPDATE participants SET user_type = 'counterparty' WHERE user_type = 'user';

-- Создаем таблицу для системных настроек
CREATE TABLE IF NOT EXISTS system_settings (
    id SERIAL PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Добавляем индексы для новых полей
CREATE INDEX IF NOT EXISTS idx_participants_is_active ON participants(is_active);
CREATE INDEX IF NOT EXISTS idx_participants_balance ON participants(balance);

-- Добавляем индекс для обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_participants_updated_at
    BEFORE UPDATE ON participants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_system_settings_updated_at
    BEFORE UPDATE ON system_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Добавляем базовые системные настройки
INSERT INTO system_settings (key, value, description) VALUES
('clearing_rules', '{"min_participants": 2, "max_amount": 1000000}', 'Правила клиринга'),
('fees', '{"clearing_fee": 0.001, "transaction_fee": 0.0001}', 'Комиссии системы'),
('limits', '{"daily_transaction_limit": 10000, "monthly_volume_limit": 100000}', 'Лимиты системы')
ON CONFLICT (key) DO NOTHING;

-- Создаем таблицу для аудита действий пользователей
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
