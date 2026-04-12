# Контекст: корень репозитория (docker-compose: context: .)
# Тот же тулчейн, что и clearing_solana/Dockerfile (см. clearing_solana/docker/install-anchor-toolchain.sh).
FROM rust:1.91-slim-bookworm AS anchor

COPY clearing_solana/docker/install-anchor-toolchain.sh /tmp/install-anchor-toolchain.sh
RUN bash /tmp/install-anchor-toolchain.sh && rm /tmp/install-anchor-toolchain.sh

WORKDIR /work
COPY clearing_solana/ ./
RUN anchor build \
    && test -f target/idl/clearing_solana.json \
    && test -f target/types/clearing_solana.ts

FROM node:20-bullseye AS builder

WORKDIR /app

ARG VITE_API_URL=/api
ARG VITE_SOLANA_RPC_URL=/solana

ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_SOLANA_RPC_URL=${VITE_SOLANA_RPC_URL}

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm config set registry https://registry.npmmirror.com
RUN npm install

COPY frontend/ ./

COPY --from=anchor /work/target/idl/clearing_solana.json ./src/clearing_solana.json
COPY --from=anchor /work/target/types/clearing_solana.ts ./src/clearing_solana.ts

RUN npm run build

FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

CMD ["nginx", "-g", "daemon off;"]
