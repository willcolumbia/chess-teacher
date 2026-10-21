#!/usr/bin/env bash
# Downloads a Stockfish binary into ./bin/stockfish (Linux x86-64).
set -euo pipefail

# sf_16 is the newest release whose binary runs on Ubuntu 20.04 (older libstdc++).
VERSION="${STOCKFISH_VERSION:-sf_16}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if grep -qw avx2 /proc/cpuinfo 2>/dev/null; then
  BUILD="stockfish-ubuntu-x86-64-avx2"
else
  BUILD="stockfish-ubuntu-x86-64-sse41-popcnt"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading Stockfish $VERSION ($BUILD)..."
curl -fsSL -o "$TMP/sf.tar" \
  "https://github.com/official-stockfish/Stockfish/releases/download/$VERSION/$BUILD.tar"
tar -xf "$TMP/sf.tar" -C "$TMP"

mkdir -p "$ROOT/bin"
cp "$TMP/stockfish/$BUILD" "$ROOT/bin/stockfish"
chmod +x "$ROOT/bin/stockfish"
echo "Installed: $ROOT/bin/stockfish"
