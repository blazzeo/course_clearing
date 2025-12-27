#!/bin/bash

# Script to setup SSL certificates for development and production
# For local domains (.local, .localhost) generates self-signed certificates
# For production domains uses Let's Encrypt

DOMAIN="clearing.local"

echo "Setting up SSL certificates for $DOMAIN..."

# Check if it's a local domain
if [[ "$DOMAIN" == *".local" ]] || [[ "$DOMAIN" == *".localhost" ]] || [[ "$DOMAIN" == "localhost" ]]; then
    echo "Local domain detected. Generating self-signed SSL certificates..."

    # Force regenerate certificates
    echo "Regenerating SSL certificates..."

    # Remove old certificates
    rm -f ./nginx/ssl/nginx.crt ./nginx/ssl/nginx.key

    # Try to use mkcert first (better for local development)
    if command -v mkcert &> /dev/null; then
        echo "Using mkcert for trusted local certificates..."

        # Create SSL directory if it doesn't exist
        mkdir -p ./nginx/ssl

        # Generate certificates with mkcert
        cd ./nginx/ssl
        mkcert -cert-file nginx.crt -key-file nginx.key "$DOMAIN" "*.${DOMAIN}" localhost 127.0.0.1
        cd ../..

        echo "mkcert certificates generated successfully!"
        echo "These certificates are automatically trusted by your system."

    else
        echo "mkcert not found. Installing mkcert..."
        echo "For macOS: brew install mkcert nss"
        echo "For Linux: https://github.com/FiloSottile/mkcert#installation"
        echo ""

        # Fallback to self-signed certificates
        echo "Falling back to self-signed certificates..."

        # Remove old certificates if they exist
        rm -f ./nginx/ssl/nginx.crt ./nginx/ssl/nginx.key

        # Create SSL directory if it doesn't exist
        mkdir -p ./nginx/ssl

        # Generate self-signed certificate with proper SAN
        cat > ./nginx/ssl/cert.conf << EOF
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
C = US
ST = State
L = City
O = Organization
CN = $DOMAIN

[v3_req]
keyUsage = keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = $DOMAIN
DNS.2 = *.$DOMAIN
DNS.3 = localhost
IP.1 = 127.0.0.1
EOF

        # Generate self-signed certificate with SAN
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout ./nginx/ssl/nginx.key \
            -out ./nginx/ssl/nginx.crt \
            -config ./nginx/ssl/cert.conf \
            -extensions v3_req

        # Clean up
        rm ./nginx/ssl/cert.conf

        # Set proper permissions
        chmod 644 ./nginx/ssl/nginx.crt
        chmod 600 ./nginx/ssl/nginx.key

        echo "Self-signed SSL certificates generated successfully!"
        echo "Note: Browser will show security warning - this is normal for self-signed certificates"
        echo "To avoid warnings, either:"
        echo "1. Add certificate to browser trusted certificates"
        echo "2. Install mkcert: https://github.com/FiloSottile/mkcert"
    fi

else
    echo "Production domain detected. Setting up Let's Encrypt certificates..."

    # Install certbot if not installed
    if ! command -v certbot &> /dev/null; then
        echo "Installing certbot..."
        # For macOS with Homebrew
        if command -v brew &> /dev/null; then
            brew install certbot
        else
            echo "Please install certbot manually: https://certbot.eff.org/"
            exit 1
        fi
    fi

    # Generate certificates using standalone mode (stops nginx temporarily)
    echo "Generating SSL certificates..."
    sudo certbot certonly --standalone -d $DOMAIN --agree-tos --email admin@$DOMAIN --no-eff-email

    # Copy certificates to nginx/ssl directory
    if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
        echo "Copying certificates to nginx/ssl..."
        sudo cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem ./nginx/ssl/clearing.crt
        sudo cp /etc/letsencrypt/live/$DOMAIN/privkey.pem ./nginx/ssl/clearing.key

        # Set proper permissions
        sudo chmod 644 ./nginx/ssl/clearing.crt
        sudo chmod 600 ./nginx/ssl/clearing.key

        echo "SSL certificates configured successfully!"
        echo "Certificate will auto-renew. Run 'sudo certbot renew' periodically."
    else
        echo "Failed to generate certificates. Check certbot output above."
        exit 1
    fi
fi
