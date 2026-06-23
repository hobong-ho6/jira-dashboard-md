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
    issues = [normalize_issue(i, cfg, today) for i in raw_issues if i.get("key")]
    return {
        "generatedAt": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "jiraBaseUrl": cfg.get("jiraBaseUrl", ""),
        "query": cfg.get("jql", ""),
        "config": {
            "jiraBaseUrl": cfg.get("jiraBaseUrl", ""),
            "weekStart": cfg.get("weekStart", "monday"),
            "jql": cfg.get("jql", ""),
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
