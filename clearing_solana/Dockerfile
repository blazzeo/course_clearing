# Используем стабильную версию Rust
FROM rust:1.90-slim-bookworm

# Установка системных зависимостей
RUN apt-get update && apt-get install -y \
    curl \
    pkg-config \
    build-essential \
    libudev-dev \
    libssl-dev \
    git \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Установка Node.js (нужен для Anchor и Surfpool)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs

# Установка Solana CLI
RUN sh -c "$(curl -sSfL https://release.solana.com/v1.18.4/install)"
ENV PATH="/root/.local/share/solana/install/active_release/bin:$PATH"

# Установка Anchor CLI
RUN cargo install --vscode --git https://github.com/coral-xyz/anchor avm --locked --force && \
    avm install latest && \
    avm use latest

# Установка Surfpool глобально через NPM
RUN npm install -g @magicblock-labs/surfpool

# Рабочая директория
WORKDIR /app

# Создаем заглушку для ключей (чтобы solana-test-validator запускался)
RUN solana-keygen new --no-bip39-passphrase --outfile /root/.config/solana/id.json

# Открываем порты для RPC и Surfpool
EXPOSE 8899 8900 3000

CMD ["tail", "-f", "/dev/null"]
