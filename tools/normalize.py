#!/usr/bin/env python3
"""
normalize.py — 원시 Jira JSON -> snapshot.json (docs/03, docs/04 의 결정적 부분)

사용 흐름 (docs/04):
  1) Claude Code 가 MCP(jira_search 등)로 이슈를 받아 data/raw_issues.json 에 저장
     (형태: {"issues":[...]} 또는 [ ...issue... ] 둘 다 허용)
  2) python3 tools/normalize.py
     -> data/config.json 을 읽고 data/snapshot.json 을 원자적으로 생성

이 스크립트는 Jira/네트워크를 호출하지 않는다. 입력 JSON만 변환한다.
프런트엔드(web/js/util.js)와 동일한 규칙을 파이썬으로 구현한 것이다.
"""
import json
import os
import re
import sys
import datetime as dt

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE, "data")
CONFIG = os.path.join(DATA_DIR, "config.json")
RAW = os.path.join(DATA_DIR, "raw_issues.json")
SNAPSHOT = os.path.join(DATA_DIR, "snapshot.json")

NO_LABEL = "(no label)"

WIKI_LINK_LABELED = re.compile(r"\[([^\]|]+)\|(https?://[^\]\s]+)\]")
WIKI_LINK_BARE = re.compile(r"\[(https?://[^\]\s]+)\]")
RAW_URL = re.compile(r"(?<![\(\[\|])https?://[^\s\)\]\|>]+")


def load_json(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


# --- MCP(jira_search) 평면 응답 → 표준 Jira v2 변환 (docs/02 §MCP 응답 형식) -------
# 이 환경의 MCP `jira_search`는 표준 v2와 다른 평면(flattened) 형식을 돌려준다:
#   - 필드가 `fields` 래퍼 없이 최상위에 위치
#   - status = {"name","category":"To Do","color"}  (v2는 status.statusCategory.key)
#   - assignee = {"display_name","avatar_url",...}   (snake_case)
#   - issuelinks[].inward_issue / outward_issue       (snake_case; 내부 이슈는 {key,fields})
#   - customfield_xxx = {"value": X}                  (v2는 값이 그대로)
# normalize_issue 가 기대하는 v2 형태로 맞춰 준다. 이미 v2면 customfield 래퍼만 정규화한다.
MCP_STATUS_CATEGORY = {"To Do": "new", "In Progress": "indeterminate", "Done": "done"}


def _unwrap_customfield(v):
    # MCP는 커스텀필드를 {"value": X}로 감싼다. v2는 X가 그대로. 언래핑은 멱등하다.
    if isinstance(v, dict) and set(v.keys()) == {"value"}:
        return v["value"]
    return v


def _conv_status(st):
    st = st or {}
    if "statusCategory" in st:            # 이미 v2
        return st
    cat = st.get("category")
    return {"name": st.get("name", ""),
            "statusCategory": {"key": MCP_STATUS_CATEGORY.get(cat, ""), "name": cat or ""}}


def _conv_assignee(a):
    if not a:
        return None
    if "displayName" in a or "avatarUrls" in a:   # 이미 v2
        return a
    return {
        "name": a.get("name"),
        "displayName": a.get("display_name", ""),
        "accountId": a.get("account_id"),
        "email": a.get("email"),
        "avatarUrls": {"48x48": a.get("avatar_url")},
    }


def _conv_links(links):
    out = []
    for l in links or []:
        l = dict(l)
        if "inward_issue" in l:
            l["inwardIssue"] = l.pop("inward_issue")
        if "outward_issue" in l:
            l["outwardIssue"] = l.pop("outward_issue")
        # 상대 이슈는 이미 {key, fields:{summary,status}} 구조다.
        # normalize_links 는 status.name 만 읽으므로 추가 변환 불필요.
        out.append(l)
    return out


def to_v2(issue):
    """MCP 평면 응답을 표준 v2(`fields` 래퍼)로 변환. 이미 v2면 customfield 래퍼만 정규화."""
    if "fields" in issue:
        f = issue.get("fields") or {}
        for k in list(f.keys()):
            if k.startswith("customfield_"):
                f[k] = _unwrap_customfield(f[k])
        return issue
    src = dict(issue)
    fields = {}
    for k in ("summary", "description", "labels", "duedate", "created", "updated",
              "issuetype", "parent", "priority"):
        if k in src:
            fields[k] = src[k]
    # get_issue 는 issuetype 을 snake_case `issue_type` 로 준다 (search 는 issuetype 자체를 누락)
    if "issue_type" in src and "issuetype" not in fields:
        fields["issuetype"] = src["issue_type"]
    if "status" in src:
        fields["status"] = _conv_status(src["status"])
    if "assignee" in src:
        fields["assignee"] = _conv_assignee(src["assignee"])
    if "issuelinks" in src:
        fields["issuelinks"] = _conv_links(src["issuelinks"])
    for k in src:
        if k.startswith("customfield_"):
            fields[k] = _unwrap_customfield(src[k])
    return {"id": issue.get("id"), "key": issue.get("key"), "fields": fields}


def week_range(today, week_start="monday"):
    # Monday=0 .. Sunday=6
    wd = today.weekday()
    if week_start.lower() == "sunday":
        start = today - dt.timedelta(days=(wd + 1) % 7)
    else:
        start = today - dt.timedelta(days=wd)
    end = start + dt.timedelta(days=6)
    return start, end


def bucket_of(duedate, today, week_start):
    if not duedate:
        return "none"
    try:
        d = dt.date.fromisoformat(duedate)
    except ValueError:
        return "none"
    if d < today:
        return "overdue"
    if d == today:
        return "today"
    ws, we = week_range(today, week_start)
    if ws <= d <= we:
        return "thisWeek"
    return "later"


def classify_link(url, rules):
    for rule in rules:
        for m in rule.get("match", []):
            if m == "*" or (m and m in url):
                return rule.get("category", "link"), rule.get("label", "Link")
    return "link", "Link"


def parse_description_links(text, rules):
    if not text:
        return []
    out, seen = [], set()

    def add(url, label_text):
        url = url.rstrip(".,);")
        if not url.startswith(("http://", "https://")):
            return
        if url in seen:
            return
        seen.add(url)
        cat, label = classify_link(url, rules)
        out.append({"url": url, "text": label_text or url, "category": cat, "label": label})

    for m in WIKI_LINK_LABELED.finditer(text):
        add(m.group(2), m.group(1))
    for m in WIKI_LINK_BARE.finditer(text):
        add(m.group(1), m.group(1))
    for m in RAW_URL.finditer(text):
        add(m.group(0), m.group(0))
    return out


def comment_links_from(comments, rules, exclude_urls=None):
    """코멘트 본문들에서 링크를 추출·분류(`descriptionLinks`와 동일 규칙).
    exclude_urls(보통 descriptionLinks의 url)에 있는 건 제외해 중복 표시를 막는다."""
    exclude = set(exclude_urls or ())
    out, seen = [], set()
    for c in comments or []:
        for ln in parse_description_links(c.get("body", ""), rules):
            u = ln["url"]
            if u in exclude or u in seen:
                continue
            seen.add(u)
            out.append(ln)
    return out


def normalize_links(issuelinks):
    out = []
    for l in issuelinks or []:
        ltype = (l.get("type") or {})
        if l.get("outwardIssue"):
            other = l["outwardIssue"]
            direction, relation = "outward", ltype.get("outward", "")
        elif l.get("inwardIssue"):
            other = l["inwardIssue"]
            direction, relation = "inward", ltype.get("inward", "")
        else:
            continue
        f = other.get("fields", {}) or {}
        out.append({
            "type": ltype.get("name", ""),
            "direction": direction,
            "relation": relation,
            "key": other.get("key"),
            "summary": f.get("summary", ""),
            "status": ((f.get("status") or {}).get("name", "")),
        })
    return out


def normalize_issue(issue, cfg, today):
    f = issue.get("fields", {}) or {}
    key = issue.get("key")
    base = cfg.get("jiraBaseUrl", "").rstrip("/")
    status = f.get("status") or {}
    assignee = f.get("assignee")
    week_start = cfg.get("weekStart", "monday")
    rules = cfg.get("descriptionLinkRules", [])

    duedate = f.get("duedate")
    created = f.get("created")
    start_field = cfg.get("startDateField")
    start_date = None
    if start_field and f.get(start_field):
        start_date = str(f.get(start_field))[:10]
    elif created:
        start_date = str(created)[:10]
    elif duedate:
        start_date = duedate

    desc = f.get("description") or ""
    parent = (f.get("parent") or {}).get("key") if f.get("parent") else None

    return {
        "key": key,
        "url": "%s/browse/%s" % (base, key) if base else key,
        "summary": f.get("summary", ""),
        "issuetype": (f.get("issuetype") or {}).get("name", ""),
        "status": {
            "name": status.get("name", ""),
            "category": (status.get("statusCategory") or {}).get("key", ""),
        },
        "priority": (f.get("priority") or {}).get("name", ""),
        "assignee": {
            "name": assignee.get("name") or assignee.get("accountId", ""),
            "displayName": assignee.get("displayName", ""),
            "avatar": (assignee.get("avatarUrls") or {}).get("48x48"),
        } if assignee else None,
        "labels": list(f.get("labels") or []),
        "duedate": duedate,
        "startDate": start_date,
        "created": created,
        "updated": f.get("updated"),
        "parent": parent,
        "bucket": bucket_of(duedate, today, week_start),
        "descriptionText": desc,
        "descriptionLinks": parse_description_links(desc, rules),
        "commentLinks": [],   # 코멘트 로드 시 apply_queue.py 가 채움 (지연)
        "links": normalize_links(f.get("issuelinks")),
        "comments": [],
        "commentsLoaded": False,
    }


def build_label_groups(issues, label_order):
    index = {}
    for it in issues:
        labels = it.get("labels") or []
        if not labels:
            index.setdefault(NO_LABEL, []).append(it["key"])
        for lb in labels:
            index.setdefault(lb, []).append(it["key"])

    def sort_key(name):
        if name == NO_LABEL:
            return (2, 0, name)
        if name in label_order:
            return (0, label_order.index(name), name)
        return (1, -len(index[name]), name)

    ordered = sorted(index.keys(), key=sort_key)
    return [{"name": n, "count": len(index[n]), "issueKeys": index[n]} for n in ordered]


def normalize_snapshot(raw, cfg, today=None):
    today = today or dt.date.today()
    if isinstance(raw, dict) and "issues" in raw:
        raw_issues = raw["issues"]
    elif isinstance(raw, list):
        raw_issues = raw
    else:
        raw_issues = []
    label_order = cfg.get("labelOrder", [])
    issues = [normalize_issue(to_v2(i), cfg, today) for i in raw_issues if i.get("key")]
    return {
        "generatedAt": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "jiraBaseUrl": cfg.get("jiraBaseUrl", ""),
        "query": cfg.get("jql", ""),
        "config": {
            "jiraBaseUrl": cfg.get("jiraBaseUrl", ""),
            "weekStart": cfg.get("weekStart", "monday"),
            "jql": cfg.get("jql", ""),
            "projects": cfg.get("projects", []),
            "currentUser": cfg.get("currentUser", ""),
            "ganttDependencyLinkTypes": cfg.get("ganttDependencyLinkTypes", []),
        },
        "issues": issues,
        "labelGroups": build_label_groups(issues, label_order),
        "transitions": {},
    }


def atomic_write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def main():
    cfg = load_json(CONFIG, {}) or {}
    raw = load_json(RAW)
    if raw is None:
        print("입력이 없습니다: %s 를 먼저 만들어 주세요 (MCP 결과 저장)." % RAW, file=sys.stderr)
        sys.exit(1)
    snap = normalize_snapshot(raw, cfg)
    atomic_write(SNAPSHOT, snap)
    print("snapshot 작성 완료: %s (issues=%d, labelGroups=%d)" %
          (SNAPSHOT, len(snap["issues"]), len(snap["labelGroups"])))


if __name__ == "__main__":
    main()
