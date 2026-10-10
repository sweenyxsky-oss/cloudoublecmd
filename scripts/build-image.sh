#!/usr/bin/env sh
# Builds the complete NAS image on any Linux/macOS machine with Docker and Bun installed.
# Usage: sh scripts/build-image.sh [image-name]
set -eu
IMAGE="${1:-cloudoublecmd:local}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "1/3 Building the web interface"
bun install --frozen-lockfile
bunx vite build -c vite.nas.config.ts

echo "2/3 Downloading and verifying 7-Zip"
VENDOR=services/truenas-access/vendor/7zip
if [ ! -x "$VENDOR/7zzs" ]; then
  TMP="$(mktemp -d)"
  curl -fsSL https://www.7-zip.org/a/7z2600-linux-x64.tar.xz -o "$TMP/7zip.tar.xz"
  echo "c74dc4a48492cde43f5fec10d53fb2a66f520e4a62a69d630c44cb22c477edc6  $TMP/7zip.tar.xz" | sha256sum -c -
  tar -xJf "$TMP/7zip.tar.xz" -C "$TMP"
  mkdir -p "$VENDOR"
  install -m 755 "$TMP/7zzs" "$VENDOR/7zzs"
  cp "$TMP/License.txt" "$VENDOR/License.txt"
  rm -rf "$TMP"
fi

echo "3/3 Building the Docker image $IMAGE"
docker build --platform linux/amd64 -t "$IMAGE" services/truenas-access
echo "Done. Image: $IMAGE"
