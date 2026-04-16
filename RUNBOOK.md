## Local Demo Runbook

### 1) Prepare env

```bash
cp .env.demo.example .env.demo
```

Fill in:
- `ADMIN_SECRET_KEY_JSON` (admin wallet secret key array)
- `ADMIN_PUBKEY` (public key of the same wallet)

### 2) Start full stack

```bash
make demo-up
```

This starts:
- `localnet` (`solana-test-validator`)
- `anchor-deploy` one-shot bootstrap (`build -> deploy -> migrate -> init.ts -> frontend IDL sync`)
- `postgres`
- `api`
- `nginx` with HTTPS termination

### 3) URLs

- Frontend (HTTPS): `https://localhost:3000`
- API (direct): `http://localhost:3001`
- Solana RPC (direct): `http://localhost:8899`
- Solana via nginx proxy: `https://localhost:3000/solana`

Browser will warn about self-signed cert on first open; this is expected for local demo.

### 4) Smoke-check before defense

```bash
make smoke
```

Expected:
- frontend returns HTML over HTTPS
- API responds (health may be optional depending on route config)
- Solana RPC proxy returns JSON-RPC response

### 5) Logs / stop

```bash
make demo-logs
make demo-down
```
