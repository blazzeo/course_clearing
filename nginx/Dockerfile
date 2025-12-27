FROM nginx:alpine

# Копируем конфигурацию
COPY nginx.conf /etc/nginx/nginx.conf
COPY conf.d/default.conf /etc/nginx/conf.d/default.conf

# Создаем директории для SSL
RUN mkdir -p /etc/nginx/ssl

# Копируем SSL сертификаты (или генерируем если не существуют)
COPY ssl/nginx.crt /etc/nginx/ssl/clearing.crt
COPY ssl/nginx.key /etc/nginx/ssl/clearing.key

# Если сертификаты не существуют, генерируем самоподписанные
RUN if [ ! -f /etc/nginx/ssl/clearing.crt ]; then \
        apk add --no-cache openssl && \
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout /etc/nginx/ssl/clearing.key \
        -out /etc/nginx/ssl/clearing.crt \
        -subj "/C=US/ST=State/L=City/O=Organization/CN=clearing.local"; \
    fi

# Права на сертификаты
RUN chmod 600 /etc/nginx/ssl/clearing.key && \
    chmod 644 /etc/nginx/ssl/clearing.crt

EXPOSE 80 443

CMD ["nginx", "-g", "daemon off;"]
