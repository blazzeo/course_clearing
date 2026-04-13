FROM rust:1.91-slim-bookworm AS base

COPY docker/install-anchor-toolchain.sh /tmp/install-anchor-toolchain.sh
RUN bash /tmp/install-anchor-toolchain.sh && rm /tmp/install-anchor-toolchain.sh

WORKDIR /app
COPY . .

FROM base AS build
RUN anchor build

FROM build AS deploy
# Anchor migrate = deploy + execute migrations/deploy.ts
CMD ["sh", "-c", "anchor migrate --provider.cluster ${SOLANA_URL:-http://localnet:8899}"]
