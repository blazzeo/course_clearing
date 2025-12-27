#!/bin/bash

# Script to temporarily switch to HTTP mode for testing
# This modifies docker-compose.override.yml to disable HTTPS

echo "Switching to HTTP mode for testing..."

# Backup original override file
cp docker-compose.override.yml docker-compose.override.yml.backup 2>/dev/null || true

# Modify override to disable HTTPS
cat > docker-compose.override.yml << 'EOF'
# Override for HTTP-only mode
version: '3.8'

services:
  nginx:
    ports:
      - "80:80"   # Only HTTP
    # HTTPS port commented out

    build:
      args:
        VITE_API_URL: http://localhost:8001/api
        VITE_SOLANA_RPC_URL: https://api.devnet.solana.com
  frontend:
    environment:
      VITE_API_URL: http://localhost:8001/api
      VITE_SOLANA_RPC_URL: https://api.devnet.solana.com
    ports:
      - "3000:80"  # Direct access to frontend
EOF

echo "Switched to HTTP mode."
echo "Run: docker-compose up -d"
echo "Access: http://localhost:80 or http://localhost:3000"
echo ""
echo "To switch back to HTTPS: ./switch-to-https.sh"
