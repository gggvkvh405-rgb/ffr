"""Долговременная память ассистента (JSON-файл в data/)."""
from __future__ import annotations

import json
import threading
import time
import uuid
from pathlib import Path

from .config import DATA_DIR

MEMORY_PATH = DATA_DIR / "memory.json"
_LOCK = threading.RLock()
_MAX_ITEMS = 300


def _load() -> list[dict]:
    if not MEMORY_PATH.exists():
        return []
    try:
        data = json.loads(MEMORY_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:  # noqa: BLE001
        return []


def _save(items: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = MEMORY_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(MEMORY_PATH)


def all_items() -> list[dict]:
    with _LOCK:
        return _load()


def add(text_value: str, category: str = "общее") -> dict:
    text_value = (text_value or "").strip()
    if not text_value:
        raise ValueError("Пустой факт")
    with _LOCK:
        items = _load()
        for item in items:
            if item["text"].lower() == text_value.lower():
                item["updated"] = time.time()
                _save(items)
                return item
        item = {
            "id": uuid.uuid4().hex[:8],
            "text": text_value,
            "category": (category or "общее").strip(),
            "created": time.time(),
            "updated": time.time(),
        }
        items.append(item)
        items = items[-_MAX_ITEMS:]
        _save(items)
        return item


def delete(item_id: str) -> bool:
    with _LOCK:
        items = _load()
        filtered = [item for item in items if item["id"] != item_id]
        if len(filtered) == len(items):
            return False
        _save(filtered)
        return True


def search(query: str = "") -> list[dict]:
    items = all_items()
    if not query:
        return items
    needle = query.lower()
    return [item for item in items if needle in item["text"].lower() or needle in item["category"].lower()]


def context_block(limit: int = 40) -> str:
    items = sorted(all_items(), key=lambda i: i.get("updated", 0), reverse=True)[:limit]
    if not items:
        return ""
    lines = [f"• [{item['category']}] {item['text']}" for item in items]
    return "Что ты знаешь об этом пользователе (используй, когда уместно):\n" + "\n".join(lines)
