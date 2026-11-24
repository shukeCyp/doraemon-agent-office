#!/bin/bash
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Start server if not already listening on 19000
if ! lsof -iTCP:19000 -sTCP:LISTEN >/dev/null 2>&1; then
  nohup "$DIR/.venv/bin/python" "$DIR/backend/doraemon_app.py" > "$DIR/doraemon_server.log" 2>&1 &
  sleep 1.2
fi

open "http://127.0.0.1:19000"
echo "✨ 哆啦A梦秘密基地已启动: http://127.0.0.1:19000"
