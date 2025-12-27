# Клиринговый сервис на блокчейне Solana

Децентрализованный клиринговый сервис для выполнения расчетов между участниками на блокчейне Solana.

## Описание проекта

Проект представляет собой полнофункциональный клиринговый сервис, состоящий из:

- **Solana Program (Anchor)** - смарт-контракт для клиринговых операций
- **Rust Web API** - REST API для взаимодействия с программой и базой данных
- **React + TypeScript фронтенд** - веб-интерфейс для пользователей
- **PostgreSQL** - база данных для истории и аналитики
- **Docker Compose** - оркестрация всех сервисов
- **Nginx** - reverse proxy и статический сервер
- **Локальная Solana нода** - для тестирования

## Функциональность

### Основные возможности:

1. **Двусторонний клиринг**
   - Создание клиринговых позиций между двумя участниками
   - Подтверждение позиций контрагентом
   - Выполнение расчетов и обновление балансов

2. **Многосторонний клиринг**
   - Создание клиринговых операций для нескольких участников
   - Автоматический расчет чистых позиций (netting)
   - Выполнение многосторонних расчетов

3. **Управление залогами**
   - Внесение залогов (маржи)
   - Вывод залогов
   - Отслеживание балансов участников

4. **Децентрализация**
   - Все критические операции выполняются в смарт-контракте Solana
   - Аутентификация через кошельки Solana (Phantom, Solflare)
   - Прозрачность всех операций в блокчейне

## Требования

- Docker и Docker Compose
- Rust (для локальной разработки)
- Node.js 20+ (для локальной разработки фронтенда)
- Anchor CLI (для работы с Solana программой)
- Make (для удобного управления проектом)

## Установка и запуск

### 1. Клонирование репозитория

```bash
git clone <repository-url>
cd course
```

### 2. Настройка домена и SSL (опционально для HTTPS)

#### Настройка домена:
```bash
sudo ./setup-hosts.sh
```

#### Настройка SSL сертификатов:
```bash
# Для локальной разработки (самоподписанные)
./setup-ssl.sh

# Для продакшена с реальным доменом
# Измените DOMAIN в setup-ssl.sh и запустите с sudo
```

#### Решение проблем с SSL:
Если браузер показывает "Not Secure", добавьте исключение:
1. Нажмите на замочек 🔒 в адресной строке
2. Выберите "Not Secure" → "Advanced"
3. Нажмите "Proceed to clearing.local (unsafe)"

Или переключитесь на HTTP для тестирования:
```bash
make http  # Переключает на HTTP режим
```

Если API запросы не работают после изменений переменных окружения:
```bash
# Пересоберите frontend с новыми переменными
docker-compose build frontend
docker-compose up -d
```

Или используйте make:
```bash
make setup  # Настройка hosts
```

### 3. Запуск через Docker Compose или Make

#### Через Make (рекомендуется):
```bash
make up        # Продакшен с HTTPS
make up-dev    # Разработка с HTTP
make down      # Остановить
make logs      # Логи всех сервисов
make clean     # Полная очистка
```

#### Через Docker Compose:
```bash
docker-compose --profile web up -d     # Продакшен с HTTPS
docker-compose --profile all up -d     # Разработка с HTTP
```

### 4. Доступ к сервисам

#### HTTPS (продакшен):
- **Веб-интерфейс**: https://clearing.local
- **API**: https://clearing.local/api

#### HTTP (разработка):
- **Веб-интерфейс**: http://localhost:80 или http://localhost:3000
- **API**: http://localhost:8001/api
- **PostgreSQL**: localhost:5432

### 4. Инициализация базы данных

База данных инициализируется автоматически при первом запуске API.

## Разработка

### Локальная разработка API

```bash
cd api
cargo run
```

Убедитесь, что PostgreSQL запущен и доступен по адресу из `DATABASE_URL`.

### Локальная разработка фронтенда

```bash
cd frontend
npm install
npm run dev
```

### Работа с Solana программой

```bash
cd program

# Установка Anchor (если еще не установлен)
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest
avm use latest

# Сборка программы
anchor build

# Развертывание на локальной ноде
anchor deploy
```

## Структура проекта

```
course/
├── program/              # Solana Anchor программа
│   ├── Cargo.toml
│   ├── Anchor.toml
│   └── src/
│       └── lib.rs
├── api/                  # Rust Web API
│   ├── Cargo.toml
│   ├── Dockerfile
│   └── src/
│       ├── main.rs
│       ├── handlers.rs
│       ├── models.rs
│       └── db.rs
├── frontend/             # React + TypeScript
│   ├── package.json
│   ├── Dockerfile
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/
│       └── pages/
├── nginx/                # Nginx reverse proxy + SSL
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── conf.d/
│   │   └── default.conf
│   └── ssl/
│       ├── nginx.crt
│       └── nginx.key
├── docker-compose.yml
├── docker-compose.override.yml
├── setup-hosts.sh        # Настройка домена
├── setup-ssl.sh          # Настройка SSL
├── Makefile             # Удобное управление
└── README.md
```

## API Endpoints

### Позиции

- `GET /api/positions` - Получить все позиции
- `GET /api/positions/{id}` - Получить позицию по ID
- `POST /api/positions` - Создать новую позицию
- `PUT /api/positions/{id}` - Обновить позицию
- `DELETE /api/positions/{id}` - Удалить позицию
- `POST /api/positions/{id}/confirm` - Подтвердить позицию
- `POST /api/positions/{id}/clear` - Выполнить клиринг

### Участники

- `GET /api/participants` - Получить всех участников
- `GET /api/participants/{address}` - Получить участника по адресу
- `GET /api/participants/{address}/balance` - Получить баланс участника

### Клиринг

- `POST /api/clearing/multi-party` - Создать многосторонний клиринг

### Залоги

- `POST /api/margin/deposit` - Внести залог
- `POST /api/margin/withdraw` - Вывести залог

## Использование

1. **Подключение кошелька**
   - Откройте веб-интерфейс
   - Нажмите "Select Wallet" и выберите Phantom или Solflare
   - Подтвердите подключение

2. **Создание позиции**
   - Перейдите в "Создать позицию"
   - Введите адрес контрагента
   - Укажите сумму
   - Нажмите "Создать позицию"

3. **Подтверждение позиции**
   - Контрагент должен перейти в список позиций
   - Найти позицию со статусом "Ожидает"
   - Нажать "Подтвердить"

4. **Выполнение клиринга**
   - После подтверждения любая сторона может выполнить клиринг
   - Нажать "Выполнить" в списке позиций
   - Балансы обновятся автоматически

## Технологический стек

- **Blockchain**: Solana (Anchor framework 0.29.0)
- **Backend**: Rust (Actix-web 4.4)
- **Frontend**: React 18 + TypeScript 5 + Vite
- **Database**: PostgreSQL 15
- **Wallet**: @solana/wallet-adapter
- **Containerization**: Docker + Docker Compose
- **Web Server**: Nginx

## Быстрый старт

```bash
# 1. Настройка домена и SSL
make setup

# 2. Запуск сервисов
make up          # Продакшен с HTTPS
make up-dev      # Разработка с HTTP
make http        # HTTP режим (без SSL)

# 3. Доступ к сайту
# HTTPS: https://clearing.local (добавьте исключение для сертификата)
# HTTP:  http://localhost:80
```

## Примечания

- Проект использует локальную тестовую ноду Solana для разработки
- Все транзакции выполняются в тестовой сети
- Для продакшена необходимо настроить подключение к основной сети Solana
- Валидация подписей транзакций должна быть реализована для полной безопасности
- SSL сертификаты самоподписанные для разработки. Для продакшена используйте Let's Encrypt

## Лицензия

Этот проект создан в образовательных целях для курсовой работы.

## Автор

Создано для курсовой работы по теме "Клиринговый сервис на блокчейне"






