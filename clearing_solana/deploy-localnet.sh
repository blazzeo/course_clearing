#!/bin/sh
set -e

export PATH="/root/.local/share/solana/install/active_release/bin:$PATH"
mkdir -p /root/.config/solana

echo "🤖 Настройка конфигурации Solana..."
# Используем ключ, который лежит в корне проекта
solana config set --url "$SOLANA_URL" --keypair /app/id.json

echo "⏳ Ожидание готовности валидатора Solana..."
until solana leader-schedule -u "$SOLANA_URL" >/dev/null 2>&1; do
    sleep 2
