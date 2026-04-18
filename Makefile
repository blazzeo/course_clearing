# Docker Compose: если указанный файл есть — передаём --env-file, иначе Compose сам читает окружение (без падения «Couldn't find env file»).
ENV_FILE ?= .env.demo
COMPOSE = docker compose $(if $(wildcard $(ENV_FILE)),--env-file $(ENV_FILE),)

# Локальный test-validator (chain-reset): не занимает TTY, лог и PID в корне репозитория.
VALIDATOR_RPC ?= http://127.0.0.1:8899
VALIDATOR_LOG ?= $(CURDIR)/.validator.log
VALIDATOR_PID ?= $(CURDIR)/.validator.pid
# Ledger вне clearing_solana/, чтобы anchor/solana не спорили с каталогом программы.
VALIDATOR_LEDGER ?= $(CURDIR)/.localnet-ledger

.PHONY: demo-up demo-down demo-logs demo-rebuild smoke chain-reset chain-validator-stop

demo-up:
	$(COMPOSE) --profile all up -d --build

demo-down:
	$(COMPOSE) --profile all down

demo-logs:
	$(COMPOSE) --profile all logs -f --tail=200

demo-rebuild:
	$(COMPOSE) --profile all build --no-cache
	$(COMPOSE) --profile all up -d

## Сброс Postgres (volume) + чистый solana-test-validator в фоне + anchor deploy + init.ts
chain-reset:
	@echo ">>> Postgres: down with volumes, then up"
	$(COMPOSE) --profile db down -v
	$(COMPOSE) --profile db up -d postgres
	@echo ">>> Останавливаем предыдущий test-validator (если был)"
	-@if [ -f "$(VALIDATOR_PID)" ]; then kill $$(cat "$(VALIDATOR_PID)") 2>/dev/null || true; rm -f "$(VALIDATOR_PID)"; fi
	-@pkill -f "solana-test-validator" 2>/dev/null || true
	-@lsof -ti :8899 2>/dev/null | xargs kill -9 2>/dev/null || true
	@sleep 1
	@echo ">>> Запуск solana-test-validator в фоне (лог: $(VALIDATOR_LOG))"
	@rm -f "$(VALIDATOR_LOG)"
	@rm -rf "$(VALIDATOR_LEDGER)"
	@mkdir -p "$(VALIDATOR_LEDGER)"
	@bash -c 'nohup solana-test-validator --reset --ledger "$(VALIDATOR_LEDGER)" \
		--bind-address 0.0.0.0 --rpc-port 8899 --dynamic-port-range 8900-8999 \
		> "$(VALIDATOR_LOG)" 2>&1 & echo $$! > "$(VALIDATOR_PID)"'
	@echo ">>> Ждём RPC $(VALIDATOR_RPC) (до 90 с)…"
	@bash -c 'for i in $$(seq 1 90); do \
		solana cluster-version -u "$(VALIDATOR_RPC)" >/dev/null 2>&1 && exit 0; \
		sleep 1; \
	done; echo "timeout: validator не поднялся, см. $(VALIDATOR_LOG)"; exit 1'
	@echo ">>> anchor deploy"
	@cd clearing_solana && anchor deploy
	@echo ">>> init.ts"
	@cd clearing_solana && npx ts-node scripts/init.ts
	@echo "Done. Validator PID: $$(cat $(VALIDATOR_PID) 2>/dev/null || echo ?), лог: $(VALIDATOR_LOG)"

## Остановить только локальный test-validator из chain-reset
chain-validator-stop:
	-@if [ -f "$(VALIDATOR_PID)" ]; then kill $$(cat "$(VALIDATOR_PID)") 2>/dev/null || true; rm -f "$(VALIDATOR_PID)"; fi
	-@pkill -f "solana-test-validator" 2>/dev/null || true

smoke:
	curl -k https://localhost:3000/
	curl http://localhost:3001/health || true
	curl -k https://localhost:3000/solana -X POST \
		-H "Content-Type: application/json" \
		-d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
