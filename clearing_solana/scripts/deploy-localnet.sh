#!/usr/bin/env sh
set -eu

RPC="${SOLANA_URL:-http://localnet:8899}"
SO="/app/target/deploy/clearing_solana.so"
KEYPAIR="/app/target/deploy/clearing_solana-keypair.json"

solana config set --url "${RPC}"

i=0
while [ "$i" -lt 90 ]; do
  if solana cluster-version >/dev/null 2>&1; then
    break
  fi
  i=$((i + 1))
  sleep 1
done

if ! solana cluster-version >/dev/null 2>&1; then
  echo "deploy-localnet: RPC недоступен: ${RPC}" >&2
  exit 1
fi

solana airdrop 100 "$(solana address)" || true

if [ ! -f "${SO}" ]; then
  echo "deploy-localnet: нет ${SO}. Соберите образ со стадией artifacts." >&2
  exit 1
fi

if [ -f "${KEYPAIR}" ]; then
  solana program deploy "${SO}" --program-id "${KEYPAIR}" --url "${RPC}"
else
  solana program deploy "${SO}" --url "${RPC}"
fi

echo "deploy-localnet: готово."
