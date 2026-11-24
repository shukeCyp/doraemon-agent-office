#!/bin/bash
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

APP_NAME="哆啦A梦秘密基地"
APP_BUNDLE="$DIR/${APP_NAME}.app"
CONTENTS="$APP_BUNDLE/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"

echo "🔨 正在编译原生 macOS 应用: $APP_BUNDLE ..."
rm -rf "$APP_BUNDLE"
mkdir -p "$MACOS" "$RESOURCES"

# 1. Generate rounded macOS App Icon (.icns) from Doraemon Leader sprite
ICONSET="/tmp/doraemon_app.iconset"
rm -rf "$ICONSET" && mkdir -p "$ICONSET"

"$DIR/.venv/bin/python" - << 'EOF'
from PIL import Image, ImageDraw

size = 1024
canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(canvas)

# Classic macOS squircle-like rounded background in Doraemon Sky Blue
pad = 64
draw.rounded_rectangle([pad, pad, size - pad, size - pad], radius=210, fill=(0, 159, 232, 255), outline=(31, 41, 55, 255), width=22)
# Soft sunny inner highlight circle
draw.ellipse([180, 150, size - 180, size - 210], fill=(125, 218, 255, 160))
# Classic red collar accent stripe at bottom
draw.rounded_rectangle([140, size - 215, size - 140, size - 145], radius=35, fill=(232, 56, 40, 255), outline=(31, 41, 55, 255), width=12)
# Golden bell dot
draw.ellipse([size // 2 - 44, size - 220, size // 2 + 44, size - 132], fill=(255, 212, 59, 255), outline=(31, 41, 55, 255), width=10)

# Paste Doraemon typing on laptop!
sprite = Image.open("frontend/assets/doraemon/sprites/leader_work.png").convert("RGBA")
bbox = sprite.getbbox()
if bbox:
    sprite = sprite.crop(bbox)
sw, sh = sprite.size
scale = min(720 / sw, 720 / sh)
nw, nh = int(sw * scale), int(sh * scale)
sprite = sprite.resize((nw, nh), Image.Resampling.LANCZOS)
canvas.paste(sprite, ((size - nw) // 2, (size - nh) // 2 - 20), sprite)
canvas.save("/tmp/doraemon_icon_1024.png", "PNG")
EOF

for sz in 16 32 128 256 512; do
  sips -z $sz $sz /tmp/doraemon_icon_1024.png --out "$ICONSET/icon_${sz}x${sz}.png" >/dev/null
  sz2=$((sz * 2))
  sips -z $sz2 $sz2 /tmp/doraemon_icon_1024.png --out "$ICONSET/icon_${sz}x${sz}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$RESOURCES/AppIcon.icns"

# 2. Compile native Objective-C WKWebView binary
clang -O2 -fobjc-arc -framework Cocoa -framework WebKit "$DIR/mac_app/DoraemonApp.m" -o "$MACOS/DoraemonOffice"

# 3. Write Info.plist
cat > "$CONTENTS/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleDisplayName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleIdentifier</key>
  <string>com.doraemon.antigravity.office</string>
  <key>CFBundleVersion</key>
  <string>2.0</string>
  <key>CFBundleShortVersionString</key>
  <string>2.0</string>
  <key>CFBundleExecutable</key>
  <string>DoraemonOffice</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>DoraemonProjectDir</key>
  <string>${DIR}</string>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
  </dict>
</dict>
</plist>
EOF

# Ad-hoc codesign so macOS Gatekeeper lets it run cleanly locally
codesign --force --deep --sign - "$APP_BUNDLE" 2>/dev/null || true

# Also copy a ready-to-click shortcut copy directly into ~/Downloads/哆啦A梦秘密基地.app
rm -rf "$HOME/Downloads/${APP_NAME}.app"
cp -R "$APP_BUNDLE" "$HOME/Downloads/${APP_NAME}.app"

echo "✅ 原生 macOS 应用构建完成!"
echo "   1. $APP_BUNDLE"
echo "   2. $HOME/Downloads/${APP_NAME}.app"
