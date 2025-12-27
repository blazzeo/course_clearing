#!/bin/bash

# Script to switch back to HTTPS mode

echo "Switching back to HTTPS mode..."

# Restore original override file if backup exists
if [ -f "docker-compose.override.yml.backup" ]; then
    mv docker-compose.override.yml.backup docker-compose.override.yml
    echo "Restored original HTTPS configuration."
else
    # Recreate default HTTPS override
    cat > docker-compose.override.yml << 'EOF'
# Override for local development
version: '3.8'

services:
  # Для локальной разработки можно использовать HTTP
  nginx:
    ports:
      - "80:80"
      - "443:443"
    environment:
      - NGINX_PORT=80

    build:
      args:
        VITE_API_URL: https://clearing.local/api
        VITE_SOLANA_RPC_URL: https://api.devnet.solana.com
  frontend:
    environment:
      VITE_API_URL: https://clearing.local/api
      VITE_SOLANA_RPC_URL: https://api.devnet.solana.com
    ports:
      - "3000:80"  # Для прямого доступа к frontend
EOF
    echo "Recreated HTTPS configuration."
fi

echo "Switched to HTTPS mode."
echo "Make sure SSL certificates are generated: ./setup-ssl.sh"
echo "Run: docker-compose up -d"
echo "Access: https://clearing.local"
