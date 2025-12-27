# Клиринговый сервис - Makefile для управления проектом

.PHONY: help setup up up-dev down logs clean build rebuild

help: ## Показать эту справку
	@echo "Доступные команды:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

setup: ## Настроить домен и SSL сертификаты
	@echo "Настройка домена clearing.local..."
	@sudo ./setup-hosts.sh
	@echo "Генерация SSL сертификатов..."
	@./setup-ssl.sh

up: ## Запустить все сервисы (продакшен с HTTPS)
	@echo "Запуск сервисов с HTTPS..."
	docker-compose --profile web up -d

up-dev: ## Запустить все сервисы (разработка с HTTP)
	@echo "Запуск сервисов для разработки..."
	docker-compose --profile all up -d

down: ## Остановить все сервисы
	@echo "Остановка сервисов..."
	docker-compose down

logs: ## Показать логи всех сервисов
	docker-compose logs -f

logs-nginx: ## Показать логи nginx
	docker-compose logs -f nginx

logs-api: ## Показать логи API
	docker-compose logs -f api

logs-frontend: ## Показать логи frontend
	docker-compose logs -f frontend

clean: ## Очистить все данные и контейнеры
	@echo "Остановка и очистка..."
	docker-compose down -v --remove-orphans
	docker system prune -f

build: ## Пересобрать все образы
	@echo "Пересборка образов..."
	docker-compose build --no-cache

http: ## Переключить на HTTP режим (без SSL)
	@echo "Переключение на HTTP режим..."
	./switch-to-http.sh
	$(MAKE) up

https: ## Переключить на HTTPS режим (с SSL)
	@echo "Переключение на HTTPS режим..."
	./switch-to-https.sh
	$(MAKE) up

rebuild: ## Полная пересборка и запуск
	@echo "Полная пересборка..."
	$(MAKE) down
	$(MAKE) clean
	$(MAKE) build
	$(MAKE) up

dev-frontend: ## Запустить только frontend для разработки
	@echo "Запуск frontend для разработки..."
	cd frontend && npm run dev

dev-api: ## Запустить только API для разработки
	@echo "Запуск API для разработки..."
	cd api && cargo run
