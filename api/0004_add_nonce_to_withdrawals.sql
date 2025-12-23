-- Добавление поля nonce для учета последовательности withdrawals

ALTER TABLE withdrawals
ADD COLUMN nonce BIGINT DEFAULT 0;

-- Индекс для nonce
CREATE INDEX IF NOT EXISTS idx_withdrawals_nonce ON withdrawals(nonce);
