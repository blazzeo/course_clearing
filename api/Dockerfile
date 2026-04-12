# Тот же коммит clearing_solana, что и при anchor build в frontend/Dockerfile и clearing_solana/Dockerfile —
# типы и layout аккаунтов в бэке совпадают с on-chain программой.
FROM rust:1.91 as builder

WORKDIR /app

# Build with repository root as context:
# - /app/api
# - /app/clearing_solana
COPY api ./api
COPY clearing_solana ./clearing_solana

WORKDIR /app/api
RUN cargo build --release

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/api/target/release/clearing-api /app/clearing-api

EXPOSE 3001
CMD ["./clearing-api"]


