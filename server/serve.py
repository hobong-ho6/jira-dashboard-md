#!/usr/bin/env python3
"""
serve.py — Jira MCP Dashboard 로컬 서버 (mailbox + 정적 파일)

역할 (docs/13):
  - web/ 정적 파일 제공
  - GET  /api/snapshot            -> data/snapshot.json
  - POST /api/commands           -> data/commands.jsonl 에 한 줄 append (pending)
  - GET  /api/commands?status=.. -> 큐 목록 (Claude Code 드레인용)
  - POST /api/commands/ack       -> {ids:[...], status, note?} 로 상태 표시 + .processed 이동
  - GET  /api/ui-state            -> data/ui-state.json (로컬 보기 설정: 그룹 순서 등)
  - POST /api/ui-state           -> data/ui-state.json 덮어쓰기 (로컬 파일 I/O, Jira 무관)

절대 규칙:
  - 이 서버는 Jira 를 호출하지 않는다. 비밀키를 다루지 않는다.
  - 127.0.0.1 에만 바인딩한다.
모든 Jira 읽기/쓰기는 Claude Code 가 MCP 로 수행한다 (docs/01 신뢰 경계).
"""
import json
import os
import re
import sys
import time
import random
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(ROOT)                      # 프로젝트 루트
WEB_DIR = os.path.join(BASE, "web")
DATA_DIR = os.path.join(BASE, "data")
SNAPSHOT = os.path.join(DATA_DIR, "snapshot.json")
COMMANDS = os.path.join(DATA_DIR, "commands.jsonl")
PROCESSED_DIR = os.path.join(DATA_DIR, ".processed")
UI_STATE = os.path.join(DATA_DIR, "ui-state.json")

_LOCK = threading.Lock()

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".map": "application/json; charset=utf-8",
}

EMPTY_SNAPSHOT = {
    "generatedAt": None,
    "jiraBaseUrl": "",
    "config": {},
    "issues": [],
    "labelGroups": [],
    "transitions": {},
}


def _new_id():
    return "c_%d_%04x" % (int(time.time()), random.randint(0, 0xFFFF))


def _read_commands():
    if not os.path.exists(COMMANDS):
        return []
    out = []
    with open(COMMANDS, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def _write_commands(rows):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = COMMANDS + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    os.replace(tmp, COMMANDS)


def _append_command(cmd):
    with _LOCK:
        cmd.setdefault("id", _new_id())
        cmd.setdefault("ts", time.strftime("%Y-%m-%dT%H:%M:%S%z"))
        cmd["status"] = "pending"
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(COMMANDS, "a", encoding="utf-8") as f:
            f.write(json.dumps(cmd, ensure_ascii=False) + "\n")
        return cmd


def _ack(ids, status, note=None):
    with _LOCK:
        rows = _read_commands()
        ids = set(ids or [])
        moved, kept = [], []
        for r in rows:
            if r.get("id") in ids:
                r["status"] = status
                if note:
                    r["note"] = note
                moved.append(r)
            else:
                kept.append(r)
        _write_commands(kept)
        if moved:
            os.makedirs(PROCESSED_DIR, exist_ok=True)
            with open(os.path.join(PROCESSED_DIR, "commands.processed.jsonl"), "a", encoding="utf-8") as f:
                for r in moved:
                    f.write(json.dumps(r, ensure_ascii=False) + "\n")
        return len(moved)


def _read_ui_state():
    if not os.path.exists(UI_STATE):
        return {}
    try:
        with open(UI_STATE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def _write_ui_state(obj):
    with _LOCK:
        os.makedirs(DATA_DIR, exist_ok=True)
        tmp = UI_STATE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)
        os.replace(tmp, UI_STATE)


def _safe_static_path(url_path):
    """web/ 밖으로 못 나가게 정규화. 디렉터리면 index.html."""
    rel = url_path.lstrip("/")
    if rel == "":
        rel = "index.html"
    full = os.path.normpath(os.path.join(WEB_DIR, rel))
    if not full.startswith(os.path.abspath(WEB_DIR)):
        return None
    if os.path.isdir(full):
        full = os.path.join(full, "index.html")
    return full


class Handler(BaseHTTPRequestHandler):
    server_version = "JiraDashMailbox/1.0"

    def _send(self, code, body=b"", ctype="application/json; charset=utf-8"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        # localhost 전용. 동일 출처라 CORS 불필요하지만 명시적으로 제한.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    # ---- GET ----
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/snapshot":
            return self._get_snapshot()
        if path == "/api/commands":
            return self._get_commands(parse_qs(parsed.query))
        if path == "/api/ui-state":
            return self._send(200, _read_ui_state())
        if path == "/api/health":
            return self._send(200, {"ok": True})
        return self._get_static(path)

    def _get_snapshot(self):
        if os.path.exists(SNAPSHOT):
            try:
                with open(SNAPSHOT, "r", encoding="utf-8") as f:
                    return self._send(200, f.read(), "application/json; charset=utf-8")
            except OSError:
                pass
        return self._send(200, EMPTY_SNAPSHOT)

    def _get_commands(self, qs):
        rows = _read_commands()
        status = (qs.get("status") or [None])[0]
        if status:
            rows = [r for r in rows if r.get("status") == status]
        return self._send(200, {"commands": rows})

    def _get_static(self, path):
        full = _safe_static_path(path)
        if not full or not os.path.isfile(full):
            return self._send(404, {"error": "not found", "path": path})
        ext = os.path.splitext(full)[1].lower()
        ctype = CONTENT_TYPES.get(ext, "application/octet-stream")
        try:
            with open(full, "rb") as f:
                data = f.read()
        except OSError:
            return self._send(500, {"error": "read failed"})
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def do_HEAD(self):
        self.do_GET()

    # ---- POST ----
    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        body = self._read_body()
        if path == "/api/commands":
            if not isinstance(body, dict) or not body.get("action"):
                return self._send(400, {"error": "command must be an object with 'action'"})
            cmd = _append_command(body)
            return self._send(201, {"ok": True, "command": cmd})
        if path == "/api/commands/ack":
            ids = (body or {}).get("ids", [])
            status = (body or {}).get("status", "done")
            note = (body or {}).get("note")
            n = _ack(ids, status, note)
            return self._send(200, {"ok": True, "updated": n})
        if path == "/api/ui-state":
            # 로컬 보기 설정(그룹 순서 등) 영속화. 로컬 파일 I/O만, Jira 호출 없음.
            if not isinstance(body, dict):
                return self._send(400, {"error": "ui-state must be a JSON object"})
            _write_ui_state(body)
            return self._send(200, {"ok": True})
        return self._send(404, {"error": "unknown endpoint", "path": path})

    def _read_body(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except (TypeError, ValueError):
            length = 0
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {}

    def log_message(self, fmt, *args):
        sys.stderr.write("[serve] " + (fmt % args) + "\n")


def main():
    port = 5173
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
    os.makedirs(DATA_DIR, exist_ok=True)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = "http://localhost:%d" % port
    print("Jira MCP Dashboard")
    print("  대시보드:  %s" % url)
    print("  스냅샷:    GET  %s/api/snapshot" % url)
    print("  명령 큐:   POST %s/api/commands" % url)
    print("  (Ctrl+C 로 종료)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n종료합니다.")
        httpd.shutdown()


if __name__ == "__main__":
    main()
