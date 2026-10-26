"""Сессии диалога: хранение, история, ожидание подтверждений."""
from __future__ import annotations

import asyncio
import json
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .config import DATA_DIR

SESSIONS_PATH = DATA_DIR / "sessions.json"
MAX_SESSIONS = 200


@dataclass
class Session:
    id: str
    title: str = "Новый диалог"
    created: float = field(default_factory=time.time)
    updated: float = field(default_factory=time.time)
    display: list[dict] = field(default_factory=list)
    history: list[dict] = field(default_factory=list)
    pending: dict | None = None
    pending_future: asyncio.Future | None = None
    stop: bool = False
    busy: bool = False

    def to_public(self, with_messages: bool = True) -> dict:
        data = {
            "id": self.id,
            "title": self.title,
            "created": self.created,
            "updated": self.updated,
            "busy": self.busy,
            "message_count": len(self.display),
        }
        if with_messages:
            data["messages"] = self.display
        return data

    def to_storage(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "created": self.created,
            "updated": self.updated,
            "display": self.display[-400:],
            "history": self.history[-60:],
        }

    @classmethod
    def from_storage(cls, raw: dict) -> "Session":
        session = cls(
            id=raw.get("id") or uuid.uuid4().hex[:12],
            title=raw.get("title") or "Диалог",
            created=raw.get("created", time.time()),
            updated=raw.get("updated", time.time()),
        )
        session.display = raw.get("display", [])
        session.history = raw.get("history", [])
        return session

    def stop_turn(self) -> None:
        self.stop = True
        if self.pending_future and not self.pending_future.done():
            self.pending_future.set_result(False)

    def ask_confirmation(self, request: dict) -> asyncio.Future:
        loop = asyncio.get_running_loop()
        self.pending = request
        self.pending_future = loop.create_future()
        return self.pending_future

    def resolve_confirmation(self, approved: bool) -> bool:
        if not self.pending or not self.pending_future or self.pending_future.done():
            return False
        self.pending_future.set_result(bool(approved))
        return True

    def clear_pending(self) -> None:
        self.pending = None
        self.pending_future = None


class SessionStore:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.items: dict[str, Session] = {}
        self._load()

    def _load(self) -> None:
        if not SESSIONS_PATH.exists():
            return
        try:
            raw = json.loads(SESSIONS_PATH.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            return
        if not isinstance(raw, list):
            return
        for item in raw[:MAX_SESSIONS]:
            session = Session.from_storage(item)
            self.items[session.id] = session

    def save(self) -> None:
        with self._lock:
            data = [s.to_storage() for s in sorted(self.items.values(), key=lambda s: s.updated)[-MAX_SESSIONS:]]
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            tmp = SESSIONS_PATH.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            tmp.replace(SESSIONS_PATH)
        except Exception as exc:  # noqa: BLE001
            print(f"[sessions] не удалось сохранить: {exc}")

    def create(self, title: str = "Новый диалог") -> Session:
        session = Session(id=uuid.uuid4().hex[:12], title=title)
        with self._lock:
            self.items[session.id] = session
        self.save()
        return session

    def get(self, session_id: str) -> Session | None:
        return self.items.get(session_id)

    def get_or_create(self, session_id: str | None) -> Session:
        if session_id:
            session = self.get(session_id)
            if session:
                return session
        last = self.recent(1)
        return last[0] if last else self.create()

    def recent(self, limit: int = 30) -> list[Session]:
        with self._lock:
            sessions = sorted(self.items.values(), key=lambda s: s.updated, reverse=True)
        return sessions[:limit]

    def delete(self, session_id: str) -> bool:
        with self._lock:
            existed = self.items.pop(session_id, None) is not None
        if existed:
            self.save()
        return existed

    def touch(self, session: Session) -> None:
        session.updated = time.time()
        if session.display:
            first_user = next((m for m in session.display if m.get("role") == "user"), None)
            if first_user and session.title in {"Новый диалог", "Диалог"}:
                text_value = (first_user.get("content") or "").strip().replace("\n", " ")
                session.title = (text_value[:48] + "…") if len(text_value) > 48 else text_value
        self.save()


STORE = SessionStore()


def trim_history(history: list[dict], max_chars: int = 18000) -> list[dict]:
    """Обрезаем историю до разумного размера, сохраняя целостность tool-пар."""
    total = 0
    kept: list[dict] = []
    for message in reversed(history):
        size = len(str(message.get("content") or "")) + 200
        if total + size > max_chars and kept:
            break
        kept.append(message)
        total += size
    kept.reverse()
    # не начинаем историю с результата инструмента
    while kept and kept[0].get("role") == "tool":
        kept.pop(0)
    return kept
