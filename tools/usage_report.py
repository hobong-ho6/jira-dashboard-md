#!/usr/bin/env python3
"""usage_report.py — 대시보드 사용 패턴 분석 (docs/15 관찰 계획).

큐를 거친 모든 대시보드 액션은 `data/.processed/commands.processed.jsonl` 와
`data/commands.jsonl` 에 full payload(전이 대상·duedate·코멘트 본문·jql 등)로 누적된다.
이 스크립트는 그걸 읽어, 헤드리스 워커(docs/15) 설계 보완에 쓸 패턴을 요약한다.

- Jira/네트워크 호출 없음. 로컬 로그만 읽는다.
- 시간 기준: 명령 id(`c_<epoch>_<hex>`)의 epoch → KST(UTC+9). 없으면 ts 파싱.

사용법:
  python3 tools/usage_report.py            # 전체 기간
  python3 tools/usage_report.py --days 30  # 최근 30일 (30일 리뷰용)
"""
import datetime as dt
import json
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

BASE = Path(__file__).parent.parent
PROCESSED = BASE / "data" / ".processed" / "commands.processed.jsonl"
LIVE = BASE / "data" / "commands.jsonl"

READ = {"load_comments", "load_transitions", "sync"}
MUTATION = {"set_duedate", "set_description", "set_labels", "add_comment", "transition", "create_link", "create_issue"}
LOCAL_UI = {"reorder_groups"}
TIER = {
    "sync": "구현됨", "load_comments": "구현됨", "load_transitions": "구현됨",
    "set_duedate": "P1", "set_description": "P1", "set_labels": "P1",
    "add_comment": "P2", "transition": "P2",
    "create_link": "P3",
    "create_issue": "신규(create)",
    "reorder_groups": "로컬(서버 ui-state)",
}
KST = dt.timezone(dt.timedelta(hours=9))


def epoch_of(rec):
    try:
        return int(rec.get("id", "").split("_")[1])
    except (IndexError, ValueError):
        pass
    ts = rec.get("ts")
    if ts:
        try:
            return int(dt.datetime.strptime(ts.replace("Z", "+0000"),
                                            "%Y-%m-%dT%H:%M:%S.%f%z").timestamp())
        except ValueError:
            pass
    return None


def kst(epoch):
    return dt.datetime.fromtimestamp(epoch, KST)


def load_records():
    """두 로그를 id 기준 dedupe(처리 로그 우선)해 시간순 리스트로."""
    by_id = {}
    for path in (LIVE, PROCESSED):  # PROCESSED 가 뒤 → 덮어써 우선권
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            cid = rec.get("id")
            if cid:
                by_id[cid] = rec
    recs = [r for r in by_id.values() if epoch_of(r) is not None]
    recs.sort(key=epoch_of)
    return recs


def bar(n, total, width=24):
    if not total:
        return ""
    return "#" * max(1, round(n / total * width)) if n else ""


def main():
    days = None
    if "--days" in sys.argv:
        days = int(sys.argv[sys.argv.index("--days") + 1])

    recs = load_records()
    if not recs:
        print("사용 기록이 없습니다 (data/.processed 가 비어있음).")
        return

    if days is not None:
        cutoff = time.time() - days * 86400
        recs = [r for r in recs if epoch_of(r) >= cutoff]
        window = "최근 %d일" % days
    else:
        window = "전체 기간"
    if not recs:
        print("해당 기간(%s)에 기록이 없습니다." % window)
        return

    first, last = kst(epoch_of(recs[0])), kst(epoch_of(recs[-1]))
    span_days = (last.date() - first.date()).days + 1
    days_active = len({kst(epoch_of(r)).date() for r in recs})
    actions = Counter(r.get("action") for r in recs)
    issues = Counter(r.get("issueKey") for r in recs if r.get("issueKey"))
    total = len(recs)

    print("=" * 60)
    print(" 대시보드 사용 패턴 리포트  (%s)" % window)
    print("=" * 60)
    print(" 기간     : %s  ~  %s  (KST)" % (first.strftime("%Y-%m-%d %H:%M"),
                                            last.strftime("%Y-%m-%d %H:%M")))
    print(" 액션 총계 : %d건 / %d일 범위 / 활동일 %d일 / 일평균 %.1f건"
          % (total, span_days, days_active, total / max(1, days_active)))
    print(" 대상 이슈 : %d개" % len(issues))

    print("\n── 액션 분포 ───────────────────────────────")
    for a, n in actions.most_common():
        cat = "읽기" if a in READ else "변경" if a in MUTATION else "로컬"
        print("  %-16s %3d  %5.1f%%  [%-4s|%-14s] %s"
              % (a, n, n / total * 100, cat, TIER.get(a, "?"), bar(n, total)))

    rd = sum(n for a, n in actions.items() if a in READ)
    mu = sum(n for a, n in actions.items() if a in MUTATION)
    lo = sum(n for a, n in actions.items() if a in LOCAL_UI)
    print("\n── 읽기 vs 변경 vs 로컬 ────────────────────")
    print("  읽기 %d (%.0f%%)  |  변경 %d (%.0f%%)  |  로컬 %d (%.0f%%)"
          % (rd, rd / total * 100, mu, mu / total * 100, lo, lo / total * 100))

    jira = rd + mu  # 워커가 다뤄야 할 Jira 액션 (로컬 ui 제외)
    now_h = sum(n for a, n in actions.items() if TIER.get(a) == "구현됨")
    p1 = sum(n for a, n in actions.items() if TIER.get(a) == "P1")
    p2 = sum(n for a, n in actions.items() if TIER.get(a) == "P2")
    p3 = sum(n for a, n in actions.items() if TIER.get(a) == "P3")
    print("\n── 헤드리스 워커 커버리지 (Jira 액션 %d건 기준) ──" % jira)
    if jira:
        print("  현재 worker.py 처리가능 : %d건 (%.0f%%)" % (now_h, now_h / jira * 100))
        print("  P1 필요 (duedate/desc/labels) : %d건 (%.0f%%)" % (p1, p1 / jira * 100))
        print("  P2 필요 (add_comment/transition): %d건 (%.0f%%)" % (p2, p2 / jira * 100))
        print("  P3 필요 (create_link)         : %d건 (%.0f%%)" % (p3, p3 / jira * 100))
        other = jira - now_h - p1 - p2 - p3
        if other:
            print("  신규/미설계 (create_issue 등) : %d건 (%.0f%%)" % (other, other / jira * 100))

    print("\n── 변경 액션 상세 ──────────────────────────")
    trans = [r for r in recs if r.get("action") == "transition"]
    if trans:
        tos = Counter(r.get("to") for r in trans)
        print("  transition %d건 → 대상: %s"
              % (len(trans), ", ".join("%s×%d" % (k, v) for k, v in tos.most_common())))
    dd = [r for r in recs if r.get("action") == "set_duedate"]
    if dd:
        vals = Counter(r.get("duedate") for r in dd)
        print("  set_duedate %d건 → 값 종류 %d개 (%s)"
              % (len(dd), len(vals), ", ".join("%s×%d" % (k, v) for k, v in vals.most_common(5))))
    ac = [r for r in recs if r.get("action") == "add_comment"]
    if ac:
        seen = Counter((r.get("issueKey"), r.get("body")) for r in ac)
        dups = sum(v - 1 for v in seen.values() if v > 1)
        print("  add_comment %d건 → 동일(이슈+본문) 중복 재요청 %d건 (헤드리스 중복-drop 가드 대상)"
              % (len(ac), dups))
    for a in ("set_description", "set_labels", "create_link"):
        if actions.get(a):
            print("  %s %d건" % (a, actions[a]))

    print("\n── 일자별 추이 (확장/안정화 신호) ──────────")
    by_day = defaultdict(Counter)
    first_seen = {}
    for r in recs:
        d = kst(epoch_of(r)).date()
        by_day[d][r.get("action")] += 1
        first_seen.setdefault(r.get("action"), d)
    for d in sorted(by_day):
        new = [a for a, fd in first_seen.items() if fd == d]
        tot = sum(by_day[d].values())
        tag = ("  ← 신규 액션: " + ", ".join(new)) if new else ""
        print("  %s  %3d건  %s%s" % (d, tot, bar(tot, max(sum(c.values()) for c in by_day.values())), tag))

    print("\n── 액션 어휘 확장 추적 ─────────────────────")
    last_new = max(first_seen.values())
    for a in sorted(first_seen, key=lambda x: first_seen[x]):
        print("  %-16s 최초 %s" % (a, first_seen[a]))
    stale_days = (last.date() - last_new).days
    print("  → 마지막 '신규 액션' 등장: %s (%d일 전).%s"
          % (last_new, stale_days,
             "  패턴 안정화 신호." if stale_days >= 14 else "  아직 확장 중일 수 있음."))

    print("\n── 최다 조작 이슈 (상위 8) ─────────────────")
    for k, n in issues.most_common(8):
        print("  %-12s %d건" % (k, n))
    print("=" * 60)


if __name__ == "__main__":
    main()
