#!/usr/bin/env bash
# Fetch and build ungive/mediaremote-adapter (BSD-3-Clause) into vendor/.
set -euo pipefail
TAG="${MEDIAREMOTE_TAG:-v0.7.7}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/vendor/mediaremote-adapter"

if [ ! -d "$DEST/.git" ]; then
  git clone --depth 1 --branch "$TAG" https://github.com/ungive/mediaremote-adapter.git "$DEST"
fi
# Universal: /usr/bin/perl runs native on both Apple silicon and Intel, so the
# framework it loads must contain both slices.
cmake -S "$DEST" -B "$DEST/build" -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64"
cmake --build "$DEST/build" --config Release

# Quarantine on the framework makes dyld refuse to load it inside perl.
xattr -dr com.apple.quarantine "$DEST/build/MediaRemoteAdapter.framework" 2>/dev/null || true

echo "Smoke test (prints now-playing JSON or null):"
/usr/bin/perl "$DEST/bin/mediaremote-adapter.pl" "$DEST/build/MediaRemoteAdapter.framework" get || true
