#!/usr/bin/env sh
set -eu

export PATH="/root/.local/share/solana/install/active_release/bin:${PATH}"
SOLANA_URL="${SOLANA_URL:-http://localnet:8899}"
WALLET_PATH="/root/.config/solana/id.json"

mkdir -p /root/.config/solana
if [ -n "${ADMIN_SECRET_KEY_JSON:-}" ]; then
  printf '%s' "${ADMIN_SECRET_KEY_JSON}" > "${WALLET_PATH}"
else
  solana-keygen new --force --no-bip39-passphrase --silent -o "${WALLET_PATH}"
fi

solana config set --url "${SOLANA_URL}" --keypair "${WALLET_PATH}"
until solana leader-schedule -u "${SOLANA_URL}" >/dev/null 2>&1; do
  echo "Waiting for validator leader schedule..."
  sleep 2
done

solana airdrop 200 "$(solana-keygen pubkey "${WALLET_PATH}")" || true

# Дополнительные адреса для airdrop (через запятую), если заданы в compose env.
if [ -n "${AIRDROP_ADDRESSES:-}" ]; then
  OLD_IFS="${IFS}"
  IFS=','
  for addr in ${AIRDROP_ADDRESSES}; do
    if [ -n "${addr}" ]; then
      solana airdrop "${AIRDROP_SOL:-2}" "${addr}" || true
    fi
  done
  IFS="${OLD_IFS}"
fi

# Артефакты уже собраны на этапе image build (anchor build в Dockerfile).
anchor deploy --provider.cluster "${SOLANA_URL}" --provider.wallet "${WALLET_PATH}" -- --use-rpc
if [ -f migrations/deploy.ts ]; then
  anchor migrate --provider.cluster "${SOLANA_URL}" --provider.wallet "${WALLET_PATH}"
else
  echo "migrations/deploy.ts not found, skipping anchor migrate"
fi

npm install
ANCHOR_PROVIDER_URL="${SOLANA_URL}" ANCHOR_WALLET="${WALLET_PATH}" npx ts-node scripts/init.ts

cp target/idl/clearing_solana.json /frontend-src/clearing_solana.json
cp target/types/clearing_solana.ts /frontend-src/clearing_solana.ts
echo "Anchor bootstrap completed (deploy/migrate/init + frontend IDL sync)."
