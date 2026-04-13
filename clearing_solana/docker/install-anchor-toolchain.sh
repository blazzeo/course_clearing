#!/usr/bin/env bash
# Актуальный Rust + Solana + anchor-cli 0.32.1 (образ solanafoundation/anchor:v0.32.1 даёт Cargo 1.84 и падает на edition2024 у зависимостей).
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  pkg-config build-essential libudev-dev libssl-dev git ca-certificates curl
rm -rf /var/lib/apt/lists/*

SOLANA_VERSION="${SOLANA_VERSION:-1.18.26}"
if ! curl --retry 5 --retry-delay 2 --retry-connrefused -sSfL \
  "https://release.solana.com/v${SOLANA_VERSION}/install" | sh; then
  echo "[toolchain] release.solana.com unavailable, trying fallback installer"
  curl --retry 5 --retry-delay 2 --retry-connrefused --proto '=https' --tlsv1.2 -sSfL \
    "https://solana-install.solana.workers.dev" | bash -s -- "v${SOLANA_VERSION}"
fi
export PATH="/root/.local/share/solana/install/active_release/bin:${PATH}"

if ! cargo build-sbf --version >/dev/null 2>&1; then
  echo "[toolchain] cargo-build-sbf not found, installing from crates.io"
  cargo install cargo-build-sbf --locked --force
fi

cargo install anchor-cli --version 0.32.1 --locked --force
