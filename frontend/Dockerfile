# === Этап 1: Сборка фронтенда ===
FROM node:20-bullseye AS builder

WORKDIR /app

# 1. Сначала копируем ТОЛЬКО файлы зависимостей (для идеального кеширования)
COPY frontend/package.json frontend/package-lock.json* ./

# 2. Ставим зеркало (если нужно) и устанавливаем пакеты
RUN npm config set registry https://registry.npmmirror.com && npm install

# 3. Передаем ARG и ENV переменные ПОСЛЕ npm install, чтобы не ломать кеш пакетов
ARG VITE_API_URL=/api
ARG VITE_SOLANA_RPC_URL=/solana

ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_SOLANA_RPC_URL=${VITE_SOLANA_RPC_URL}

# 4. Копируем исходники фронтенда
COPY frontend/ ./

# 5. Собираем статику (Vite создаст папку /app/dist)
RUN npm run build


# === Этап 2: Финальный образ Nginx ===
FROM nginx:alpine

# Копируем скомпилированный HTML/JS из папки /app/dist сборщика
COPY --from=builder /app/dist /usr/share/nginx/html

# Порты, которые слушает Nginx
EXPOSE 80
EXPOSE 443

# Оставляем дефолтный запуск Nginx, он сам подхватит конфигурацию
CMD ["nginx", "-g", "daemon off;"]
