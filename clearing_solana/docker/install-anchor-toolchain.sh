#!/usr/bin/env bash
# Актуальный Rust + Solana + anchor-cli 0.32.1 (образ solanafoundation/anchor:v0.32.1 даёт Cargo 1.84 и падает на edition2024 у зависимостей).
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  pkg-config build-essential libudev-dev libssl-dev git ca-certificates curl
rm -rf /var/lib/apt/lists/*

SOLANA_VERSION="${SOLANA_VERSION:-1.18.26}"
curl -sSfL "https://release.solana.com/v${SOLANA_VERSION}/install" | sh
export PATH="/root/.local/share/solana/install/active_release/bin:${PATH}"

cargo install anchor-cli --version 0.32.1 --locked --force
