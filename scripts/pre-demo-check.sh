#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[1/3] cargo check (api)"
cargo check --manifest-path "${ROOT_DIR}/api/Cargo.toml"

echo "[2/3] cargo check (on-chain program)"
cargo check --manifest-path "${ROOT_DIR}/clearing_solana/programs/clearing_solana/Cargo.toml"

echo "[3/3] frontend build"
npm --prefix "${ROOT_DIR}/frontend" run build

echo "pre-demo-check: OK"
