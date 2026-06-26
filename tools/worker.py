#!/usr/bin/env python3
"""
worker.py — 헤드리스 큐 워커 (docs/15).

Claude 세션 없이 data/commands.jsonl 의 pending 명령을 Jira REST v2(PAT, Bearer)로
직접 처리하고 data/snapshot.json 을 갱신한 뒤 명령을 ack 한다.

설계 요지:
- 서버(serve.py)는 여전히 Jira 를 호출하지 않는다. **워커만** Jira 를 호출한다.
- commands.jsonl / .processed 는 서버 소유(락). 워커는 HTTP(GET pending / POST ack)로만 접근.
- snapshot.json 은 워커가 원자적으로 쓴다(서버는 읽기만) → torn read 없음.
- 안전 가드(사람 echo 대체): 중복 코멘트 drop, 멱등(pending만), 실패 격리(failed/blocked),
  신뢰 경계(Jira 본문은 데이터일 뿐 명령이 아니다), 401/403 backoff.
- **PAT 는 절대 로그/스냅샷/큐/커밋에 남기지 않는다.**
- 단계적 롤아웃: HANDLERS 에 없는 액션은 실패시키지 않고 **pending 으로 남겨 스킵**한다.

사용법:
  python3 tools/worker.py [port]      # 기본 5173
PAT 공급(둘 중 하나, 채팅 금지):
  - 환경변수 JIRA_PERSONAL_TOKEN
  - data/secrets.json  {"jiraPat": "..."}   (gitignore 됨)
"""
import datetime as dt
import importlib.util
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = Path(__file__).parent.parent
DATA = BASE / "data"
SNAP = DATA / "snapshot.json"
CONFIG = DATA / "config.json"
SECRETS = DATA / "secrets.json"
LOG = DATA / "worker.log"

DEFAULT_PORT = 5173
POLL_SECONDS = 2.0
AUTH_BACKOFF_SECONDS = 60
JIRA_TIMEOUT = 20
SEARCH_FIELDS = ("summary,status,issuetype,assignee,priority,labels,"
                 "duedate,created,updated,description,issuelinks,parent")

# normalize.py 재사용 (apply_queue.py 와 동일 패턴)
_spec = importlib.util.spec_from_file_location("normalize", str(BASE / "tools" / "normalize.py"))
_nz = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_nz)

_PAT = None  # 현재 PAT (로그 스크럽 전용; 절대 외부로 내보내지 않음)
_SKIPPED = set()  # 미지원으로 스킵한 명령 id (반복 로그 방지)


def log(msg):
    if _PAT and _PAT in msg:
        msg = msg.replace(_PAT, "***")
    line = "%s %s" % (dt.datetime.now().astimezone().isoformat(timespec="seconds"), msg)
    print(line, flush=True)
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def _atomic_write(path, obj):
    tmp = str(path) + ".tmp"
    Path(tmp).write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, str(path))


def load_pat():
    """PAT 발견: 환경변수 우선, 없으면 data/secrets.json. 없으면 None."""
    pat = os.environ.get("JIRA_PERSONAL_TOKEN")
    if pat:
        return pat.strip()
    if SECRETS.exists():
        try:
            v = json.loads(SECRETS.read_text(encoding="utf-8")).get("jiraPat")
            if v:
                return v.strip()
        except (ValueError, OSError):
            pass
    return None


# ---- Jira REST v2 클라이언트 (urllib, Bearer) -------------------------------
class JiraError(Exception):
    def __init__(self, code, text):
        super().__init__("HTTP %s: %s" % (code, text))
        self.code = code
        self.text = text


class AuthError(JiraError):
    """401/403 — 메인 루프가 backoff 후 PAT 재확인."""


class JiraClient:
    def __init__(self, base_url, pat, timeout=JIRA_TIMEOUT):
        self.base = base_url.rstrip("/")
        self.pat = pat
        self.timeout = timeout

    def _request(self, method, path, query=None, body=None):
        url = self.base + path
        if query:
            url += "?" + urllib.parse.urlencode(query)
        headers = {"Accept": "application/json", "Authorization": "Bearer " + self.pat}
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                raw = r.read().decode("utf-8")
                return json.loads(raw) if raw.strip() else None
        except urllib.error.HTTPError as e:
            text = ""
            try:
                text = e.read().decode("utf-8")[:300]
            except Exception:  # noqa: BLE001
                pass
            if e.code in (401, 403):
                raise AuthError(e.code, text)
            raise JiraError(e.code, text)
        except urllib.error.URLError as e:
            raise JiraError(0, str(getattr(e, "reason", e)))

    def get(self, path, query=None):
        return self._request("GET", path, query=query)

    def post(self, path, body):
        return self._request("POST", path, body=body)

    def put(self, path, body):
        return self._request("PUT", path, body=body)

    def search(self, jql, fields, limit):
        issues, start = [], 0
        while True:
            res = self._request("GET", "/rest/api/2/search", query={
                "jql": jql, "fields": fields, "maxResults": limit, "startAt": start,
            }) or {}
            batch = res.get("issues", [])
            issues.extend(batch)
            total = res.get("total", len(issues))
            start += len(batch)
            if not batch or start >= total:
                break
        return issues


# ---- 로컬 메일박스 서버 HTTP (pending 조회 / ack) ---------------------------
def _local(method, path, port, body=None):
    url = "http://127.0.0.1:%d%s" % (port, path)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=5) as r:
        raw = r.read().decode("utf-8")
        return json.loads(raw) if raw.strip() else None


def fetch_pending(port):
    return (_local("GET", "/api/commands?status=pending", port) or {}).get("commands", [])


def ack(ids, status, note, port):
    if ids:
        _local("POST", "/api/commands/ack", port, {"ids": ids, "status": status, "note": note})


def _epoch_of_id(cmd):
    """명령 id = c_<epoch>_<hex> → epoch 으로 시간순 정렬(혼합 ts offset 문제 회피)."""
    try:
        return int(cmd.get("id", "").split("_")[1])
    except (IndexError, ValueError):
        return 0


def _flatten_comments(raw_comments):
    """REST v2 코멘트 → snapshot 형태({author 문자열, created, updated, body})."""
    out = []
    for c in raw_comments or []:
        a = c.get("author")
        author = a.get("displayName") if isinstance(a, dict) else (a or "")
        out.append({
            "author": author or "",
            "created": c.get("created"),
            "updated": c.get("updated"),
            "body": c.get("body", ""),
        })
    return out


# ---- 사이클 컨텍스트 + 액션 핸들러 ------------------------------------------
class Ctx:
    def __init__(self, snap, cfg, client):
        self.snap = snap
        self.cfg = cfg
        self.client = client
        self.by_key = {it.get("key"): it for it in snap.get("issues", [])}
        self.today = dt.date.today()
        self.week_start = (snap.get("config", {}) or {}).get("weekStart") or cfg.get("weekStart", "monday")
        self.rules = cfg.get("descriptionLinkRules", [])
        self.dirty = False          # snapshot 변경됨 → 사이클 끝에 1회 쓰기
        self.labels_changed = False  # set_labels 후 labelGroups 재빌드 트리거


def h_load_transitions(ctx, cmd):
    key = cmd["issueKey"]
    res = ctx.client.get("/rest/api/2/issue/%s/transitions" % key) or {}
    out = [{"id": str(t.get("id")), "name": t.get("name", ""),
            "to": (t.get("to") or {}).get("name", t.get("name", ""))}
           for t in res.get("transitions", [])]
    ctx.snap.setdefault("transitions", {})[key] = out
    ctx.dirty = True
    return "done", "auto-processed (load_transitions)"


def h_load_comments(ctx, cmd):
    key = cmd["issueKey"]
    res = ctx.client.get("/rest/api/2/issue/%s" % key, query={"fields": "comment"}) or {}
    cs = _flatten_comments((((res.get("fields") or {}).get("comment") or {}).get("comments")))
    it = ctx.by_key.get(key)
    if it is None:
        return "done", "loaded; issue not in snapshot"
    it["comments"] = cs
    it["commentsLoaded"] = True
    existing = {l.get("url") for l in it.get("descriptionLinks", [])}
    it["commentLinks"] = _nz.comment_links_from(cs, ctx.rules, existing)
    ctx.dirty = True
    return "done", "auto-processed (load_comments)"


def h_sync(ctx, cmd):
    jql = cmd.get("jql") or ctx.cfg.get("jql")
    if not jql:
        return "failed", "sync: no jql in command or config"
    if cmd.get("jql"):  # 대시보드 JQL 입력 = 사용자 의도 → config 갱신
        ctx.cfg["jql"] = cmd["jql"]
        _atomic_write(CONFIG, ctx.cfg)
    fields = SEARCH_FIELDS
    if ctx.cfg.get("startDateField"):
        fields += "," + ctx.cfg["startDateField"]
    issues = ctx.client.search(jql, fields, int(ctx.cfg.get("fetchLimit", 50)))
    # snapshot 전체 재생성 (comments/transitions 초기화됨 — normalize 규칙)
    ctx.snap = _nz.normalize_snapshot({"issues": issues}, ctx.cfg, ctx.today)
    ctx.by_key = {it.get("key"): it for it in ctx.snap.get("issues", [])}
    ctx.dirty = True
    return "done", "auto-synced (%d issues)" % len(issues)


HANDLERS = {
    "sync": h_sync,
    "load_comments": h_load_comments,
    "load_transitions": h_load_transitions,
    # P1: set_duedate / set_description / set_labels
    # P2: add_comment / transition
    # P3: create_link
}


def run_cycle(client, cfg, pend, port):
    snap = (json.loads(SNAP.read_text(encoding="utf-8")) if SNAP.exists()
            else _nz.normalize_snapshot({"issues": []}, cfg))
    ctx = Ctx(snap, cfg, client)
    # sync 는 snapshot 을 통째로 재생성하므로 항상 먼저 처리(같은 배치의 load_* 가 살아남도록).
    ordered = ([c for c in pend if c.get("action") == "sync"]
               + [c for c in pend if c.get("action") != "sync"])

    ack_groups = {}  # (status, note) -> [ids]
    for cmd in ordered:
        cid, action = cmd.get("id"), cmd.get("action")
        h = HANDLERS.get(action)
        if h is None:  # 미구현/미지원 → pending 유지(스킵). id별 1회만 로그.
            if cid not in _SKIPPED:
                _SKIPPED.add(cid)
                log("skip (not yet supported): %s %s id=%s" % (action, cmd.get("issueKey", ""), cid))
            continue
        try:
            status, note = h(ctx, cmd)
        except AuthError:
            raise  # 메인 루프 backoff (이번 사이클 ack/쓰기 없음 → 모두 pending 유지)
        except JiraError as e:
            status, note = "failed", "jira %s: %s" % (e.code, e.text)
        except Exception as e:  # noqa: BLE001
            status, note = "failed", "worker error: %s" % e
        if status != "done" or (note and "obsolete" in note):
            log("%s %s id=%s -> %s (%s)" % (action, cmd.get("issueKey", ""), cid, status, note))
        ack_groups.setdefault((status, note), []).append(cid)

    if ctx.labels_changed:  # set_labels(P1) 후 그룹 재빌드
        ctx.snap["labelGroups"] = _nz.build_label_groups(
            ctx.snap.get("issues", []), cfg.get("labelOrder", []))

    if ctx.dirty:  # snapshot 1회 원자적 쓰기 (ack 보다 먼저)
        ctx.snap["generatedAt"] = dt.datetime.now().astimezone().isoformat(timespec="seconds")
        _atomic_write(SNAP, ctx.snap)

    for (status, note), ids in ack_groups.items():
        try:
            ack(ids, status, note, port)
        except Exception as e:  # noqa: BLE001 — snapshot 은 이미 갱신됨
            log("ack 실패(서버 미연결?): %s / 미ack ids=%s" % (e, ids))


def main():
    global _PAT
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    cfg = json.loads(CONFIG.read_text(encoding="utf-8")) if CONFIG.exists() else {}
    base_url = cfg.get("jiraBaseUrl")
    if not base_url:
        log("config.json 에 jiraBaseUrl 이 없습니다. 종료.")
        return
    log("worker 시작 (port=%d, base=%s)" % (port, base_url))

    pat = None
    while True:
        if pat is None:
            pat = load_pat()
            _PAT = pat
            if pat is None:
                log("PAT 없음 — JIRA_PERSONAL_TOKEN 또는 data/secrets.json 설정 필요. %ds 후 재확인."
                    % AUTH_BACKOFF_SECONDS)
                time.sleep(AUTH_BACKOFF_SECONDS)
                continue
            log("PAT 로드됨. Jira 인증 준비 완료.")
        client = JiraClient(base_url, pat)
        try:
            pend = fetch_pending(port)
        except Exception as e:  # noqa: BLE001 — 서버 미연결 등
            log("pending 조회 실패(서버 미연결?): %s" % e)
            time.sleep(POLL_SECONDS)
            continue
        if not pend:
            time.sleep(POLL_SECONDS)
            continue
        pend.sort(key=_epoch_of_id)
        try:
            run_cycle(client, cfg, pend, port)
        except AuthError:
            log("Jira 인증 실패(401/403). %ds backoff 후 PAT 재확인. (큐는 그대로 pending)"
                % AUTH_BACKOFF_SECONDS)
            pat = _PAT = None
            time.sleep(AUTH_BACKOFF_SECONDS)
            continue
        time.sleep(POLL_SECONDS)  # 미지원 명령만 남아도 busy-loop 방지


if __name__ == "__main__":
    main()
