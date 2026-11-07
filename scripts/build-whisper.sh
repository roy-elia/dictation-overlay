#!/usr/bin/env bash
# Build whisper.cpp's HTTP server (Metal, Apple silicon + Intel) into vendor/whisper.cpp.
# The server keeps the model loaded, so each dictation only pays inference cost.
# Core ML: if <model>-encoder.mlmodelc sits next to the .bin, the encoder runs on
# the Neural Engine (~4x faster on M1); otherwise it falls back to Metal.
set -euo pipefail
TAG="${WHISPER_TAG:-v1.9.5}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/vendor/whisper.cpp"

if [ ! -d "$DEST/.git" ]; then
  git clone --depth 1 --branch "$TAG" https://github.com/ggml-org/whisper.cpp.git "$DEST"
fi

# Static libs so whisper-server is a single relocatable binary we can ship in the app.
cmake -S "$DEST" -B "$DEST/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64" \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=13.3 \
  -DBUILD_SHARED_LIBS=OFF \
  -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON \
  -DGGML_NATIVE=OFF \
  -DWHISPER_COREML=ON -DWHISPER_COREML_ALLOW_FALLBACK=ON \
  -DWHISPER_BUILD_EXAMPLES=ON -DWHISPER_BUILD_TESTS=OFF -DWHISPER_SDL2=OFF
cmake --build "$DEST/build" --config Release -j --target whisper-server

BIN="$DEST/build/bin/whisper-server"
lipo -archs "$BIN"
echo "Built $BIN"
