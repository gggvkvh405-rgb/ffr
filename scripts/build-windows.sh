#!/usr/bin/env bash
# Build the Windows executable of ByAzen.
#
# Requires the zig toolchain (pip install ziglang). Produces a self-contained
# x86-64 PE executable with the whole UI embedded as resources.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ZIG="${ZIG:-$(command -v zig || true)}"
if [ -z "$ZIG" ]; then
  ZIG="$(ls -1 "$HOME"/.zbuild/lib/python*/site-packages/ziglang/zig 2>/dev/null | head -1 || true)"
fi
if [ -z "$ZIG" ]; then
  echo "zig not found: pip install ziglang" >&2
  exit 1
fi

OUT="$ROOT/dist-win"
BUILD="$ROOT/build/desktop"
mkdir -p "$BUILD" "$OUT"

echo "==> 1/4 desktop bundle"
npx vite build --config vite.config.desktop.ts
cp "$ROOT/dist-desktop/index.html" "$BUILD/index.html"
cp "$ROOT/public/favicon.svg" "$BUILD/favicon.svg"

echo "==> 2/4 icon"
if [ ! -f "$ROOT/assets/byazen.ico" ]; then
  python3 "$ROOT/scripts/make-icon.py"
fi
cp "$ROOT/assets/byazen.ico" "$BUILD/byazen.ico"

echo "==> 3/4 resources"
cd "$BUILD"
"$ZIG" rc byazen.rc byazen.res

echo "==> 4/4 executable"
"$ZIG" cc -target x86_64-windows-gnu -O2 -s \
  -Wl,--subsystem,windows \
  -o "$OUT/ByAzen.exe" \
  "$ROOT/native/byazen.c" \
  "$ROOT/native/http.c" \
  byazen.res \
  -luser32 -lgdi32 -lshell32 -lole32 -ladvapi32 -lws2_32

ls -lh "$OUT/ByAzen.exe"
