FROM rust:1.91 as builder

WORKDIR /app

# Копируем workspace файлы и зависимости
COPY api/Cargo.toml ./api/Cargo.toml
COPY api/Cargo.lock* ./api/
COPY program ./program

# Создаем фиктивный src для кеширования зависимостей
RUN mkdir -p api/src && echo "fn main() {println!(\"Hello\");}" > api/src/main.rs

# Собираем зависимости (кешируется)
WORKDIR /app/api
RUN cargo build --release
RUN rm src/main.rs

# Копируем реальный код API
COPY api .

# Финальная сборка
RUN touch src/main.rs
RUN cargo build --release

# Собираем приложение
RUN cargo build --release

# Финальный образ
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# COPY --from=builder /app/target/release/clearing-api /app/clearing-api
COPY --from=builder /app/api/target/release/clearing-api /app/clearing-api

RUN ls -la /app

EXPOSE 8080

CMD ["./clearing-api"]


