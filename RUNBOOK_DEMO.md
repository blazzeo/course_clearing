# Demo Runbook

## 1) Подготовка окружения

- Заполнить `.env` для `api`:
  - `SOLANA_RPC_URL`
  - `PORT=3001`
  - `ADMIN_PUBKEY`
  - `FRONTEND_ORIGIN` (например, `http://localhost:3000`)
- Убедиться, что локальная Solana нода доступна.

## 2) Сборка и базовая валидация

- Запустить:
  - `./scripts/pre-demo-check.sh`
- Скрипт проверяет:
  - сборку Rust backend;
  - сборку frontend;
  - базовую компиляцию on-chain программы.

## 3) Подъем сервисов

- Запустить:
  - `docker compose up -d --build`
- Проверить:
  - `GET /live`
  - `GET /ready`
  - `GET /metrics`
  - доступность UI на `http://localhost:3000`.

## 4) Демо-сценарий

- Подключить два кошелька (контрагенты).
- Зарегистрировать участников.
- Создать и подтвердить обязательство.
- Запустить клиринг из админ панели.
- Проверить обновление статусов и счетов.

## 5) Быстрый rollback

- Если сервис деградировал:
  - `docker compose restart api nginx`
- Если проблема после пересборки:
  - `docker compose down`
  - `docker compose up -d --build`
