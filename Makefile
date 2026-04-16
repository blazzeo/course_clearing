ENV_FILE ?= .env.demo

.PHONY: demo-up demo-down demo-logs demo-rebuild smoke

demo-up:
	docker compose --env-file $(ENV_FILE) --profile all up -d --build

demo-down:
	docker compose --env-file $(ENV_FILE) --profile all down

demo-logs:
	docker compose --env-file $(ENV_FILE) --profile all logs -f --tail=200

demo-rebuild:
	docker compose --env-file $(ENV_FILE) --profile all build --no-cache
	docker compose --env-file $(ENV_FILE) --profile all up -d

smoke:
	curl -k https://localhost:3000/
	curl http://localhost:3001/health || true
	curl -k https://localhost:3000/solana -X POST \
		-H "Content-Type: application/json" \
		-d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
