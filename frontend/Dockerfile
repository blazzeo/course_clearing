FROM node:20-bullseye AS builder

WORKDIR /app

ARG VITE_API_URL=/api
ARG VITE_SOLANA_RPC_URL=/solana

ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_SOLANA_RPC_URL=${VITE_SOLANA_RPC_URL}

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm config set registry https://registry.npmmirror.com
RUN npm install

COPY frontend/ ./

RUN npm run build

FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

CMD ["nginx", "-g", "daemon off;"]
