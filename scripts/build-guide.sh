#!/usr/bin/env bash
# Build permission-guide (SwiftPM) and wrap it into PermissionGuide.app.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$ROOT/permission-guide"
OUT="$PKG/build/PermissionGuide.app"
SIGN_ID="${CODESIGN_IDENTITY:--}"   # "-" = ad-hoc

# Build each arch separately and lipo them (multi --arch needs full Xcode's xcbuild).
ARCHS="${ARCHS:-arm64 x86_64}"
SLICES=()
for a in $ARCHS; do
  swift build --package-path "$PKG" -c release --triple "$a-apple-macosx26.0"
  DIR="$(swift build --package-path "$PKG" -c release --triple "$a-apple-macosx26.0" --show-bin-path)"
  SLICES+=("$DIR/PermissionGuide")
done
BIN="$PKG/.build/PermissionGuide-universal"
lipo -create "${SLICES[@]}" -output "$BIN"
BIN_DIR="$(dirname "${SLICES[0]}")"

rm -rf "$OUT"
mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"
cp "$BIN" "$OUT/Contents/MacOS/PermissionGuide"
# SwiftPM resource bundles (if Permiso ships any) must sit next to the binary.
find "$BIN_DIR" -maxdepth 1 -name '*.bundle' -exec cp -R {} "$OUT/Contents/Resources/" \;

cat > "$OUT/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>dev.personal.dictation-overlay.permission-guide</string>
  <key>CFBundleName</key><string>PermissionGuide</string>
  <key>CFBundleExecutable</key><string>PermissionGuide</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>26.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

codesign --force --options runtime --sign "$SIGN_ID" "$OUT"
echo "Built $OUT"
