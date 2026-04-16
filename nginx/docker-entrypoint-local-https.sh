#!/bin/sh
set -eu

CERT_DIR="/etc/nginx/certs"
CERT_PATH="${CERT_DIR}/tls.crt"
KEY_PATH="${CERT_DIR}/tls.key"

mkdir -p "${CERT_DIR}"

if [ ! -f "${CERT_PATH}" ] || [ ! -f "${KEY_PATH}" ]; then
  echo "[nginx] generating self-signed certificate for localhost"
  openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout "${KEY_PATH}" \
    -out "${CERT_PATH}" \
    -subj "/CN=localhost"
fi

exec nginx -g "daemon off;"
