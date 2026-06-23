#!/usr/bin/env python3
"""
reorder_groups.py — 그룹 순서 재정렬

config.json의 labelOrder를 업데이트하고 snapshot을 재생성합니다.
"""
import json
import sys
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
CONFIG_FILE = DATA_DIR / "config.json"

def reorder_groups(label_order):
    """
    그룹 순서 변경

    Args:
        label_order: 새로운 라벨 순서 (리스트)

    Returns:
        bool: 성공 여부
    """
    if not isinstance(label_order, list):
        print(f"❌ labelOrder는 배열이어야 합니다: {type(label_order)}", file=sys.stderr)
        return False

    # config.json 로드
    if not CONFIG_FILE.exists():
        print(f"❌ config.json이 없습니다: {CONFIG_FILE}", file=sys.stderr)
        return False

    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        config = json.load(f)

    # labelOrder 업데이트
    old_order = config.get('labelOrder', [])
    config['labelOrder'] = label_order

    # 저장
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
        f.write('\n')  # 마지막 줄바꿈

    print(f"✅ labelOrder 업데이트 완료")
    print(f"\n변경 전 ({len(old_order)}개):")
    for idx, label in enumerate(old_order[:5], 1):
        print(f"  {idx}. {label}")
    if len(old_order) > 5:
        print(f"  ... 외 {len(old_order) - 5}개")

    print(f"\n변경 후 ({len(label_order)}개):")
    for idx, label in enumerate(label_order[:5], 1):
        print(f"  {idx}. {label}")
    if len(label_order) > 5:
        print(f"  ... 외 {len(label_order) - 5}개")

    return True

def main():
    if len(sys.argv) < 2:
        print("사용법: python3 reorder_groups.py '[\"label1\", \"label2\", ...]'", file=sys.stderr)
        sys.exit(1)

    try:
        label_order = json.loads(sys.argv[1])
    except json.JSONDecodeError as e:
        print(f"❌ JSON 파싱 실패: {e}", file=sys.stderr)
        sys.exit(1)

    success = reorder_groups(label_order)
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
