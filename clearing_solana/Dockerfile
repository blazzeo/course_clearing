FROM ubuntu:22.04

# Базовые зависимости
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    build-essential \
    libssl-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Установка Solana через официальный скрипт
RUN curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash

# Добавляем Solana в PATH
ENV PATH="/root/.local/share/solana/install/active_release/bin:$PATH"

# Проверка (необязательно, но полезно)
# RUN solana --version

WORKDIR /app

COPY . .

CMD ["sleep", "infinity"]
# CMD ["anchor", "build"]
