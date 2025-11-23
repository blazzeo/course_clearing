FROM rust:1.91 as builder

WORKDIR /app

# Копируем файлы зависимостей
COPY Cargo.toml ./
COPY Cargo.lock* ./

# Создаем фиктивный src для кеширования зависимостей
RUN mkdir src && echo "fn main() {println!(\"Hello\");}" > src/main.rs

# Собираем зависимости (кешируется)
RUN cargo build --release
RUN rm src/main.rs

# Копируем реальный код
COPY . .

RUN touch src/main.rs

# Собираем приложение
RUN cargo build --release

# Финальный образ
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/target/release/clearing-api /app/clearing-api

RUN ls -la /app

EXPOSE 8080

CMD ["./clearing-api"]
