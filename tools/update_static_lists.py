#!/usr/bin/env python3
"""
Скрипт для автоматического скачивания и компиляции полных списков:
- EasyList (мировая реклама)
- RU AdList / AdGuard Russian Filter (Яндекс, ВК, Рутуб, тизерки, онлайн-кинотеатры)
- Peter Lowe's Ad and Tracking Server List
в статический файл правил Chrome Manifest V3 DeclarativeNetRequest (rules/ads_core.json).
"""

import json
import re
import urllib.request
from pathlib import Path

SOURCES = [
    "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=nohtml&showintro=0&mimetype=plaintext",
    "https://easylist.to/easylist/easylist.txt",
    "https://easylist-downloads.adblockplus.org/ruadlist.txt",
]

DOMAIN_RULE_RE = re.compile(r"^\|\|([a-z0-9.-]+\.[a-z]{2,})\^(\$(third-party|all))?$")
PLAIN_DOMAIN_RE = re.compile(r"^([a-z0-9.-]+\.[a-z]{2,})$")


def fetch_domains() -> list[str]:
    domains = set()
    for url in SOURCES:
        print(f"[*] Загрузка: {url} ...")
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                text = resp.read().decode("utf-8", errors="ignore")
            for raw in text.splitlines():
                line = raw.strip().lower()
                if not line or line.startswith(("!", "#", "[")):
                    continue
                m1 = DOMAIN_RULE_RE.match(line)
                if m1:
                    domains.add(m1.group(1))
                    continue
                m2 = PLAIN_DOMAIN_RE.match(line)
                if m2:
                    domains.add(m2.group(1))
        except Exception as exc:
            print(f"[!] Ошибка загрузки {url}: {exc}")
    return sorted(domains)


def main() -> None:
    rules_path = Path(__file__).resolve().parent.parent / "rules" / "ads_core.json"
    existing_rules = json.loads(rules_path.read_text(encoding="utf-8"))

    # Сохраняем первые 30 базовых высокоприоритетных правил
    base_rules = [r for r in existing_rules if r.get("id", 0) <= 30]
    fetched_domains = fetch_domains()
    print(f"[+] Извлечено уникальных рекламных доменов: {len(fetched_domains)}")

    chunk_size = 500
    next_id = 31
    for i in range(0, len(fetched_domains), chunk_size):
        chunk = fetched_domains[i : i + chunk_size]
        base_rules.append(
            {
                "id": next_id,
                "priority": 85,
                "action": {"type": "block"},
                "condition": {
                    "requestDomains": chunk,
                    "excludedResourceTypes": ["main_frame"],
                },
            }
        )
        next_id += 1

    rules_path.write_text(json.dumps(base_rules, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[+] Успешно записано {len(base_rules)} правил в {rules_path}")


if __name__ == "__main__":
    main()
