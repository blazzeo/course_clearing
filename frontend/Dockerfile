FROM node:20-bullseye AS builder

WORKDIR /app

ARG VITE_API_URL=/api
ARG VITE_SOLANA_RPC_URL=/solana

COPY package.json package-lock.json* ./
RUN npm config set registry https://registry.npmmirror.com
RUN npm install

COPY . .
RUN npm run build

FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

CMD ["nginx", "-g", "daemon off;"]


