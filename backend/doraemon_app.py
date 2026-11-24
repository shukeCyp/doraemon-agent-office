#!/usr/bin/env python3
"""
Doraemon Multi-Agent Secret Studio Server for Google Antigravity.
Supports:
  - Main Hub Plaza (/api/antigravity/hub): each character represents one Antigravity conversation/session.
  - Per-Session Unique Rooms (/api/antigravity/room/<cid>): host character + all their Subagents / Swarm workers
    inside their own distinct Doraemon-themed room, all working on computers!
"""

import os
import sys
from flask import Flask, jsonify, request, send_from_directory

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from antigravity_watcher import scan_antigravity_hub, scan_antigravity_room, scan_antigravity_teams

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="/static")


@app.after_request
def add_headers(resp):
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "doraemon.html")


@app.route("/assets/<path:filename>")
def serve_assets(filename):
    resp = send_from_directory(os.path.join(FRONTEND_DIR, "assets"), filename)
    resp.headers["Cache-Control"] = "public, max-age=3600"
    return resp


@app.route("/doraemon.css")
def serve_css():
    return send_from_directory(FRONTEND_DIR, "doraemon.css")


@app.route("/doraemon.js")
def serve_js():
    return send_from_directory(FRONTEND_DIR, "doraemon.js")


@app.route("/api/antigravity/hub")
def api_antigravity_hub():
    return jsonify(scan_antigravity_hub())


@app.route("/api/antigravity/room/<cid>")
def api_antigravity_room(cid):
    return jsonify(scan_antigravity_room(cid))


@app.route("/api/antigravity/state")
def api_antigravity_state():
    team_cid = request.args.get("team", "").strip() or None
    return jsonify(scan_antigravity_teams(selected_leader_cid=team_cid))


@app.route("/api/health")
def api_health():
    return jsonify({"ok": True, "app": "doraemon-agent-office"})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "19000"))
    host = os.environ.get("HOST", "127.0.0.1")
    print(f"✨ 哆啦A梦多Agent秘密社区启动中: http://{host}:{port}")
    app.run(host=host, port=port, debug=False, threaded=True)
