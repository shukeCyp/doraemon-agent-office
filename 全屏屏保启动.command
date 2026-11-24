#!/bin/bash
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

if ! lsof -iTCP:19000 -sTCP:LISTEN >/dev/null 2>&1; then
  nohup "$DIR/.venv/bin/python" "$DIR/backend/doraemon_app.py" > "$DIR/doraemon_server.log" 2>&1 &
  sleep 1.2
fi

URL="http://127.0.0.1:19000/?screensaver=1"
if [ -d "/Applications/Google Chrome.app" ]; then
  open -na "Google Chrome" --args --kiosk --app="$URL"
elif [ -d "/Applications/Arc.app" ]; then
  open -a "Arc" "$URL"
else
  open "$URL"
fi
