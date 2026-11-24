#!/bin/bash
# Install macOS background service + WebViewScreenSaver so Doraemon Agent Office
# runs directly as a real macOS System Settings -> Screen Saver!
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.doraemon.agent-office.plist"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.doraemon.agent-office</string>
  <key>ProgramArguments</key>
  <array>
    <string>$DIR/.venv/bin/python</string>
    <string>$DIR/backend/doraemon_app.py</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$DIR/doraemon_server.log</string>
  <key>StandardErrorPath</key>
  <string>$DIR/doraemon_server.log</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "✅ 已配置后台常驻服务 (http://127.0.0.1:19000)"

if command -v brew >/dev/null 2>&1; then
  echo "正在通过 Homebrew 安装开源 macOS 网页屏保插件 WebViewScreenSaver..."
  brew install --cask webviewscreensaver || true
  echo ""
  echo "🎉 安装完成！最后一步（macOS 系统设置）："
  echo "1. 打开「系统设置」→「屏幕保护程序」"
  echo "2. 选择「WebViewScreenSaver」→ 点击「选项…」"
  echo "3. 将网址设置为: http://127.0.0.1:19000/?screensaver=1"
else
  echo "⚠️ 未检测到 Homebrew。请手动下载 https://github.com/liquidx/webviewscreensaver/releases 并双击 .saver 安装，"
  echo "   然后在「系统设置 → 屏幕保护程序 → WebViewScreenSaver 选项」填入: http://127.0.0.1:19000/?screensaver=1"
fi
