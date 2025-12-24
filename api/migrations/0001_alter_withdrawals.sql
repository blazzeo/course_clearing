-- Добавляем поле updated_at если его еще нет
ALTER TABLE withdrawals 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Делаем его NOT NULL, но сначала заполняем существующие записи
UPDATE withdrawals 
SET updated_at = COALESCE(completed_at, approved_at, requested_at, NOW())
WHERE updated_at IS NULL;

-- Теперь можно сделать NOT NULL
ALTER TABLE withdrawals 
ALTER COLUMN updated_at SET NOT NULL;


-- Добавляем поле pda если его еще нет
ALTER TABLE withdrawals 
ADD COLUMN IF NOT EXISTS pda TEXT NOT NULL;

-- Добавляем комментарий к полю (опционально)
COMMENT ON COLUMN withdrawals.pda IS 'PDA (Program Derived Address) запроса участника на вывод';
