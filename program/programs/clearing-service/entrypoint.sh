#!/bin/bash
set -e

# -----------------------
# Настройка Solana Devnet
# -----------------------
mkdir -p /root/.config/solana

# Генерируем кошелёк, если его нет
if [ ! -f "$ANCHOR_WALLET" ]; then
    echo "Создаём кошелёк для Devnet..."
    solana-keygen new --outfile "$ANCHOR_WALLET" --no-passphrase
fi

# Указываем URL Devnet
solana config set --url https://api.devnet.solana.com
solana config set --keypair "$ANCHOR_WALLET"

# Проверяем баланс кошелька
BALANCE=$(solana balance)
echo "Баланс кошелька: $BALANCE SOL"

# -----------------------
# Собираем программу
# -----------------------
echo "Собираем программу..."
anchor build

# -----------------------
# Деплоим на Devnet
# -----------------------
echo "Деплоим программу на Devnet..."
anchor deploy

echo "✅ Деплой завершён!"
exec "$@"
