#!/bin/sh
# Writes a certificate for localhost into infra/dev/certs, once: existing files are kept.
# mkcert, when installed, makes one the browser already trusts; otherwise openssl makes a
# self-signed one. Chrome refuses a certificate without the digitalSignature key usage even
# when certificate errors are ignored, so the openssl variant sets it explicitly.
set -eu
dir="$(cd "$(dirname "$0")" && pwd)/certs"
if [ -f "$dir/localhost.pem" ] && [ -f "$dir/localhost-key.pem" ]; then
  exit 0
fi
mkdir -p "$dir"
if command -v mkcert >/dev/null 2>&1; then
  mkcert -cert-file "$dir/localhost.pem" -key-file "$dir/localhost-key.pem" localhost 127.0.0.1 ::1
else
  openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
    -keyout "$dir/localhost-key.pem" -out "$dir/localhost.pem" -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1" \
    -addext "keyUsage=digitalSignature,keyEncipherment" \
    -addext "extendedKeyUsage=serverAuth"
fi
